import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { aiRouter, getAiTelemetry } from '../services/providers/ai-router.js';
import { createJob, processJob, getJob } from '../workers/queue.js';
import { storageService } from '../services/storage.service.js';
import { db } from '../db/prisma.js';
import type { Job } from '../workers/queue.js';

export async function creativeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // POST /api/creative/images/generate
  app.post('/creative/images/generate', async (request, reply) => {
    const { prompt, aspectRatio, clientId } = request.body as { prompt: string; aspectRatio?: string; clientId?: string };
    if (!prompt) return reply.status(400).send({ error: 'prompt is required' });

    try {
      const result = await aiRouter.image({ prompt, aspectRatio }, { clientId });
      // Save to assets if we have base64
      let savedAsset = null;
      if (result.output.base64 && clientId) {
        const buf = Buffer.from(result.output.base64, 'base64');
        const { fileUrl, thumbUrl } = await storageService.saveFile(buf, `ai-gen-${Date.now()}.png`, 'image/png');
        savedAsset = await db.asset.create({
          data: { clientId, name: `ai-gen-${Date.now()}.png`, mimeType: 'image/png', fileUrl, thumbUrl, tags: ['ai-generated'], safeForClient: true },
        });
      }
      return {
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        fallbackUsed: result.fallbackUsed,
        url: result.output.url || null,
        base64: result.output.base64 ? true : false,
        assetId: savedAsset?.id || null,
        assetUrl: savedAsset?.fileUrl || result.output.url || null,
      };
    } catch (err: any) {
      return reply.status(502).send({ error: err.message, provider: 'ai-router' });
    }
  });

  // POST /api/creative/images/edit
  app.post('/creative/images/edit', async (request, reply) => {
    const { prompt, imageBase64, mimeType, aspectRatio, clientId } = request.body as any;
    if (!prompt || !imageBase64) return reply.status(400).send({ error: 'prompt and imageBase64 are required' });

    try {
      const result = await aiRouter.image({ prompt, imageBase64, mimeType: mimeType || 'image/png', aspectRatio }, { clientId });
      let savedAsset = null;
      if (result.output.base64 && clientId) {
        const buf = Buffer.from(result.output.base64, 'base64');
        const { fileUrl, thumbUrl } = await storageService.saveFile(buf, `ai-edit-${Date.now()}.png`, 'image/png');
        savedAsset = await db.asset.create({
          data: { clientId, name: `ai-edit-${Date.now()}.png`, mimeType: 'image/png', fileUrl, thumbUrl, tags: ['ai-edited'], safeForClient: true },
        });
      }
      return {
        provider: result.provider, model: result.model,
        latencyMs: result.latencyMs, fallbackUsed: result.fallbackUsed,
        url: result.output.url || null,
        assetId: savedAsset?.id || null,
        assetUrl: savedAsset?.fileUrl || result.output.url || null,
      };
    } catch (err: any) {
      return reply.status(502).send({ error: err.message });
    }
  });

  // POST /api/creative/videos/generate — async via job queue
  app.post('/creative/videos/generate', async (request, reply) => {
    const { prompt, aspectRatio, durationSeconds, resolution, clientId } = request.body as any;
    if (!prompt) return reply.status(400).send({ error: 'prompt is required' });

    const job = createJob('creative-video', { prompt, aspectRatio, durationSeconds, resolution, clientId });
    processJob(job.id, async (j: Job) => {
      const result = await aiRouter.video(
        { prompt: j.data.prompt, aspectRatio: j.data.aspectRatio, durationSeconds: j.data.durationSeconds, resolution: j.data.resolution },
        { jobId: j.id, clientId: j.data.clientId },
      );
      return {
        provider: result.provider, model: result.model,
        latencyMs: result.latencyMs, fallbackUsed: result.fallbackUsed,
        url: result.output.url,
      };
    });

    return reply.status(202).send({ jobId: job.id });
  });

  // GET /api/creative/jobs/:jobId — poll video/creative job status
  app.get('/creative/jobs/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = getJob(jobId);
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    return { id: job.id, status: job.status, progress: job.progress, result: job.result, error: job.error };
  });

  // GET /api/creative/telemetry — provider audit log
  app.get('/creative/telemetry', async () => {
    return getAiTelemetry();
  });
}
