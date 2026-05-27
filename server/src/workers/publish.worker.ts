/**
 * Publish worker — drives the platform API call and writes the result
 * back to CalendarPost.platformPublishStatus.
 *
 * Thin wrapper around lib/publish-dispatch.ts which is shared with
 * scheduler.worker.ts. The wrapper exists so the existing in-memory job
 * queue (workers/queue.ts) can update progress + surface errors via the
 * job record.
 */
import { db } from '../db/prisma.js';
import { dispatchPublish } from '../lib/publish-dispatch.js';
import type { Job } from './queue.js';
import { updateJob } from './queue.js';

export async function publishWorker(job: Job): Promise<{ externalId: string; url?: string }> {
  const { orgId, postId, platform, connectionId, assetUrl, caption, hashtags } = job.data as {
    orgId: string; postId: string; platform: string; connectionId: string;
    assetUrl: string; caption: string; hashtags: string[];
  };

  updateJob(job.id, { progress: 10 });
  const conn = await db.platformConnection.findFirst({ where: { id: connectionId, orgId } });
  if (!conn) throw new Error('Connection not found');
  // Sanity check — platform on the job payload should match the connection.
  if (conn.platform !== platform) {
    throw new Error(`Platform mismatch: job=${platform}, connection=${conn.platform}`);
  }

  const result = await dispatchPublish(
    { id: postId, caption, hashtags, assetUrl },
    conn,
    { onProgress: (pct) => updateJob(job.id, { progress: pct }) },
  );

  if (!result.success) {
    // dispatchPublish has already recorded the error onto the post.
    throw new Error(result.error || 'Publish failed');
  }

  return { externalId: result.externalId!, url: result.url };
}
