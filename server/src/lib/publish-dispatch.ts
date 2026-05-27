/**
 * dispatchPublish — single point of truth for publishing one post to one
 * platform connection. Called from:
 *
 *   - server/src/workers/publish.worker.ts   (manual publish, via /api/.../publish)
 *   - server/src/workers/scheduler.worker.ts (auto-publish at scheduledAt)
 *
 * Handles:
 *   - Proactive OAuth refresh when token is within 24h of expiry
 *   - Marking the PlatformConnection 'needs_reauth' on refresh failure
 *   - Calling the platform module's publishImage()
 *   - Writing per-platform success/error into CalendarPost.platformPublishStatus
 *   - Flipping CalendarPost.status to 'published' on success
 *
 * Returns { success, externalId?, error? } — never throws. Callers decide
 * how to surface the failure (job error, scheduler error column, etc).
 */
import { db } from '../db/prisma.js';
import { decrypt, decryptOpt, encrypt, encryptOpt } from './secrets.js';
import { getPlatformModule } from '../integrations/registry.js';
import { withRefreshLock } from './refresh-lock.js';

const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // refresh when <24h to expiry

export interface DispatchResult {
  success: boolean;
  externalId?: string;
  url?: string;
  error?: string;
}

export interface DispatchPostInput {
  id: string;
  caption: string | null;
  hashtags: unknown;
  /** First attached asset URL — the image to publish. */
  assetUrl: string;
}

export interface PlatformConnectionLike {
  id: string;
  orgId: string;
  platform: string;
  externalAccountId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  expiresAt: Date | null;
  metadata: unknown;
}

/**
 * Dispatch a single post to a single platform connection.
 *
 * The `post` argument is intentionally a narrow interface (not the full
 * Prisma CalendarPost) so callers can build it from whatever shape they
 * have. The worker passes its job-data; the scheduler builds it from the
 * Prisma row + its first asset.
 */
export async function dispatchPublish(
  post: DispatchPostInput,
  conn: PlatformConnectionLike,
  opts?: { onProgress?: (pct: number) => void },
): Promise<DispatchResult> {
  const onProgress = opts?.onProgress ?? (() => {});
  const mod = getPlatformModule(conn.platform);
  const hashtags = Array.isArray(post.hashtags) ? (post.hashtags as string[]) : [];
  const caption = post.caption ?? '';

  // ── Token refresh ───────────────────────────────────────────────────
  let accessToken = decrypt(conn.accessTokenEnc);
  let refreshToken = decryptOpt(conn.refreshTokenEnc);
  const needsRefresh = conn.expiresAt && (conn.expiresAt.getTime() - Date.now()) < REFRESH_THRESHOLD_MS;

  if (needsRefresh) {
    onProgress(25);
    try {
      // withRefreshLock returns null if a sibling worker (tokenHealth sweep,
      // another scheduler tick) is already refreshing this connection — re-
      // read the row so we pick up the new tokens they just wrote.
      const lockResult = await withRefreshLock(conn.id, async () => {
        const fresh = await mod.oauth.refresh({ refreshToken, accessToken });
        const newExpiresAt = fresh.expiresInSec ? new Date(Date.now() + fresh.expiresInSec * 1000) : null;
        await db.platformConnection.updateMany({
          where: { id: conn.id, orgId: conn.orgId },
          data: {
            accessTokenEnc: encrypt(fresh.accessToken),
            refreshTokenEnc: encryptOpt(fresh.refreshToken ?? refreshToken),
            expiresAt: newExpiresAt,
            status: 'connected',
            lastError: null,
          },
        });
        return { accessToken: fresh.accessToken, refreshToken: fresh.refreshToken ?? refreshToken };
      });

      if (lockResult === null) {
        // Sibling did the refresh — reload from DB to get the rotated tokens.
        const refreshed = await db.platformConnection.findFirst({
          where: { id: conn.id, orgId: conn.orgId },
          select: { accessTokenEnc: true, refreshTokenEnc: true },
        });
        if (refreshed) {
          accessToken = decrypt(refreshed.accessTokenEnc);
          refreshToken = decryptOpt(refreshed.refreshTokenEnc);
        }
      } else {
        accessToken = lockResult.accessToken;
        refreshToken = lockResult.refreshToken;
      }
    } catch (err: any) {
      const msg = err?.message?.slice(0, 500) || 'token refresh failed';
      await db.platformConnection.updateMany({
        where: { id: conn.id, orgId: conn.orgId },
        data: { status: 'needs_reauth', lastError: msg },
      });
      const wrapped = `Token refresh failed — please reconnect ${conn.platform}: ${msg}`;
      await recordError(post.id, conn.orgId, conn.platform, wrapped);
      return { success: false, error: wrapped };
    }
  }

  // ── Publish ─────────────────────────────────────────────────────────
  onProgress(50);
  let result: { externalId: string; url?: string };
  try {
    result = await mod.publish.publishImage({
      accessToken,
      externalAccountId: conn.externalAccountId,
      metadata: (conn.metadata as Record<string, any>) || {},
      imageUrl: post.assetUrl,
      caption,
      hashtags,
    });
  } catch (err: any) {
    const msg = err?.message?.slice(0, 500) || 'publish failed';
    await recordError(post.id, conn.orgId, conn.platform, msg);
    return { success: false, error: msg };
  }

  // ── Success ─────────────────────────────────────────────────────────
  onProgress(90);
  await recordSuccess(post.id, conn.orgId, conn.platform, result);
  return { success: true, externalId: result.externalId, url: result.url };
}

async function recordSuccess(
  postId: string,
  orgId: string,
  platform: string,
  result: { externalId: string; url?: string },
): Promise<void> {
  const existing = await db.calendarPost.findFirst({
    where: { id: postId, orgId },
    select: { platformPublishStatus: true },
  });
  const next = { ...((existing?.platformPublishStatus as any) || {}) };
  next[platform] = {
    status: 'published',
    externalId: result.externalId,
    url: result.url,
    publishedAt: new Date().toISOString(),
  };
  await db.calendarPost.updateMany({
    where: { id: postId, orgId },
    data: {
      platformPublishStatus: next,
      status: 'published',
    },
  });
}

/**
 * Strip likely-sensitive substrings before persisting a provider error to
 * the post (which the UI reads). The full raw text still goes to server
 * logs via console.error in the worker. HARD-5: prevents fbtrace_id,
 * token tails, account IDs, emails from leaking into per-post status JSON.
 */
function sanitizeErrorForPersistence(raw: string): string {
  if (!raw) return raw;
  return raw
    // Bearer tokens, "access_token":"…", apparent base64 secrets > 20 chars
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]{16,}/gi, 'Bearer ***')
    .replace(/("?(?:access_token|refresh_token|client_secret|api_key)"?\s*[:=]\s*")[^"]+(")/gi, '$1***$2')
    .replace(/EAA[A-Za-z0-9]{20,}/g, 'EAA***')           // Meta access tokens
    .replace(/act\.[A-Za-z0-9._\-]{16,}/g, 'act.***')   // TikTok-style
    // Trace ids
    .replace(/("?fbtrace_id"?\s*[:=]\s*")[^"]+(")/gi, '$1***$2')
    .replace(/(x-li-uuid:\s*)\S+/gi, '$1***')
    // Emails (incidental disclosure of admin contact in Meta error bodies)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***@***')
    // Long digit runs that look like account/object IDs (10+ digits)
    .replace(/\b\d{10,}\b/g, '***')
    .slice(0, 500);
}

async function recordError(postId: string, orgId: string, platform: string, error: string): Promise<void> {
  const safe = sanitizeErrorForPersistence(error);
  const existing = await db.calendarPost.findFirst({
    where: { id: postId, orgId },
    select: { platformPublishStatus: true },
  });
  const next = { ...((existing?.platformPublishStatus as any) || {}) };
  next[platform] = {
    status: 'error',
    error: safe,
    attemptedAt: new Date().toISOString(),
  };
  await db.calendarPost.updateMany({
    where: { id: postId, orgId },
    data: { platformPublishStatus: next },
  });
}
