/**
 * Publish worker — drives the platform API call and writes the result
 * back to CalendarPost.platformPublishStatus.
 *
 * Token refresh: if the stored access token is within 24h of expiry, attempt
 * refresh first. If refresh fails, mark the connection 'needs_reauth' and
 * surface the error on the job.
 */
import { db } from '../db/prisma.js';
import { decrypt, decryptOpt, encrypt, encryptOpt } from '../lib/secrets.js';
import { getPlatformModule } from '../integrations/registry.js';
import type { Job } from './queue.js';
import { updateJob } from './queue.js';

const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // refresh when <24h to expiry

export async function publishWorker(job: Job): Promise<{ externalId: string; url?: string }> {
  const { orgId, postId, platform, connectionId, assetUrl, caption, hashtags } = job.data as {
    orgId: string; postId: string; platform: string; connectionId: string;
    assetUrl: string; caption: string; hashtags: string[];
  };

  updateJob(job.id, { progress: 10 });
  const conn = await db.platformConnection.findFirst({ where: { id: connectionId, orgId } });
  if (!conn) throw new Error('Connection not found');

  const mod = getPlatformModule(platform);

  // Token freshness check
  let accessToken = decrypt(conn.accessTokenEnc);
  let refreshToken = decryptOpt(conn.refreshTokenEnc);
  const needsRefresh = conn.expiresAt && (conn.expiresAt.getTime() - Date.now()) < REFRESH_THRESHOLD_MS;

  if (needsRefresh) {
    updateJob(job.id, { progress: 25 });
    try {
      const fresh = await mod.oauth.refresh({ refreshToken, accessToken });
      accessToken = fresh.accessToken;
      refreshToken = fresh.refreshToken ?? refreshToken;
      const expiresAt = fresh.expiresInSec ? new Date(Date.now() + fresh.expiresInSec * 1000) : null;
      await db.platformConnection.update({
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
      await db.platformConnection.update({
        where: { id: conn.id },
        data: { status: 'needs_reauth', lastError: err.message?.slice(0, 500) },
      });
      throw new Error(`Token refresh failed — please reconnect ${platform}: ${err.message}`);
    }
  }

  // Publish
  updateJob(job.id, { progress: 50 });
  let result;
  try {
    result = await mod.publish.publishImage({
      accessToken,
      externalAccountId: conn.externalAccountId,
      metadata: (conn.metadata as Record<string, any>) || {},
      imageUrl: assetUrl,
      caption,
      hashtags,
    });
  } catch (err: any) {
    // Record per-platform error in the post's publish status JSON
    const existing = await db.calendarPost.findUnique({ where: { id: postId }, select: { platformPublishStatus: true } });
    const next = { ...((existing?.platformPublishStatus as any) || {}) };
    next[platform] = {
      status: 'error',
      error: err.message?.slice(0, 500),
      attemptedAt: new Date().toISOString(),
    };
    await db.calendarPost.update({ where: { id: postId }, data: { platformPublishStatus: next } });
    throw err;
  }

  // Record success
  updateJob(job.id, { progress: 90 });
  const existing = await db.calendarPost.findUnique({ where: { id: postId }, select: { platformPublishStatus: true } });
  const next = { ...((existing?.platformPublishStatus as any) || {}) };
  next[platform] = {
    status: 'published',
    externalId: result.externalId,
    url: result.url,
    publishedAt: new Date().toISOString(),
  };
  await db.calendarPost.update({
    where: { id: postId },
    data: {
      platformPublishStatus: next,
      // If this is the first successful platform publish, mark the post as published overall.
      status: 'published',
    },
  });

  return { externalId: result.externalId, url: result.url };
}
