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

/**
 * Structural shape of a PlatformConnection row that dispatchPublish needs.
 * Declared inline rather than imported from @prisma/client so we don't
 * couple to the generated client at compile time — the same stale-client
 * workaround used elsewhere in the codebase (db as any).platformConnection.
 */
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
      const fresh = await mod.oauth.refresh({ refreshToken, accessToken });
      accessToken = fresh.accessToken;
      refreshToken = fresh.refreshToken ?? refreshToken;
      const expiresAt = fresh.expiresInSec ? new Date(Date.now() + fresh.expiresInSec * 1000) : null;
      await (db as any).platformConnection.update({
        where: { id: conn.id },
        data: {
          accessTokenEnc: encrypt(accessToken),
          refreshTokenEnc: encryptOpt(refreshToken),
          expiresAt,
          status: 'connected',
          lastError: null,
        },
      });
    } catch (err: any) {
      const msg = err?.message?.slice(0, 500) || 'token refresh failed';
      await (db as any).platformConnection.update({
        where: { id: conn.id },
        data: { status: 'needs_reauth', lastError: msg },
      });
      const wrapped = `Token refresh failed — please reconnect ${conn.platform}: ${msg}`;
      await recordError(post.id, conn.platform, wrapped);
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
    await recordError(post.id, conn.platform, msg);
    return { success: false, error: msg };
  }

  // ── Success ─────────────────────────────────────────────────────────
  onProgress(90);
  await recordSuccess(post.id, conn.platform, result);
  return { success: true, externalId: result.externalId, url: result.url };
}

async function recordSuccess(
  postId: string,
  platform: string,
  result: { externalId: string; url?: string },
): Promise<void> {
  const existing = await (db as any).calendarPost.findUnique({
    where: { id: postId },
    select: { platformPublishStatus: true },
  });
  const next = { ...((existing?.platformPublishStatus as any) || {}) };
  next[platform] = {
    status: 'published',
    externalId: result.externalId,
    url: result.url,
    publishedAt: new Date().toISOString(),
  };
  await (db as any).calendarPost.update({
    where: { id: postId },
    data: {
      platformPublishStatus: next,
      status: 'published',
    },
  });
}

async function recordError(postId: string, platform: string, error: string): Promise<void> {
  const existing = await (db as any).calendarPost.findUnique({
    where: { id: postId },
    select: { platformPublishStatus: true },
  });
  const next = { ...((existing?.platformPublishStatus as any) || {}) };
  next[platform] = {
    status: 'error',
    error,
    attemptedAt: new Date().toISOString(),
  };
  await (db as any).calendarPost.update({
    where: { id: postId },
    data: { platformPublishStatus: next },
  });
}
