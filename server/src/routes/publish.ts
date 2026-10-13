/**
 * /api/calendar-posts/:postId/publish — kick off platform publish.
 *
 * Auth-gated. Validates: post exists in org, post.status === 'approved',
 * an active PlatformConnection exists for the requested platform on the
 * post's client. Creates a 'publish-post' job and returns the jobId for
 * the frontend to poll via /api/jobs/:id.
 */
import type { FastifyInstance } from 'fastify';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { auditService } from '../services/audit.service.js';
import { createJob, processJob } from '../workers/queue.js';
import { publishWorker } from '../workers/publish.worker.js';
import { listPlatformIds } from '../integrations/registry.js';

export async function publishRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  app.post('/calendar-posts/:postId/publish', async (request, reply) => {
    const { postId } = request.params as { postId: string };
    const { platform } = (request.body as { platform?: string }) || {};
    const orgId = request.orgId!;

    if (!platform || !(listPlatformIds() as readonly string[]).includes(platform)) {
      return reply.status(400).send({ error: `platform must be one of: ${listPlatformIds().join(', ')}` });
    }

    const post = await db.calendarPost.findFirst({
      where: { id: postId, orgId },
      include: {
        calendarMonth: { select: { clientId: true } },
        assets: { include: { asset: true }, take: 1 },
      },
    });
    if (!post) return reply.status(404).send({ error: 'Post not found' });
    if (post.status !== 'approved') {
      return reply.status(409).send({ error: `Post must be approved before publishing (current: ${post.status})` });
    }

    const conn = await db.platformConnection.findFirst({
      where: { orgId, clientId: post.calendarMonth.clientId, platform, status: 'connected' },
    });
    if (!conn) return reply.status(409).send({ error: `No connected ${platform} account for this client. Connect one in Settings → Integrations.` });

    const asset = post.assets[0]?.asset;
    if (!asset?.fileUrl) return reply.status(409).send({ error: 'Post has no attached image asset to publish' });

    const job = createJob('publish-post', {
      orgId,
      postId: post.id,
      platform,
      connectionId: conn.id,
      assetUrl: asset.fileUrl,
      caption: post.caption,
      hashtags: Array.isArray(post.hashtags) ? post.hashtags : [],
    });
    processJob(job.id, publishWorker);

    auditService.log({
      orgId,
      userId: request.user?.userId,
      clientId: post.calendarMonth.clientId,
      action: 'publish-initiated',
      entityType: 'CalendarPost',
      payload: { postId, platform, jobId: job.id },
    });

    return reply.status(202).send({ jobId: job.id });
  });
}
