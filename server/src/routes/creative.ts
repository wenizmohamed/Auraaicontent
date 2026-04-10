import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { aiRouter, getAiTelemetry } from '../services/providers/ai-router.js';
import { createJob, processJob, getJob } from '../workers/queue.js';
import { storageService } from '../services/storage.service.js';
import { db } from '../db/prisma.js';
import { searchPinterest, searchPinterestMulti, fetchPinterestImageBase64 } from '../services/pinterest.service.js';
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

  // GET /api/creative/pinterest/search?q=...&limit=12&bookmark=...
  // Scrapes Pinterest's public JSON endpoint — no API key required
  app.get('/creative/pinterest/search', async (request, reply) => {
    const { q, limit, bookmark } = request.query as { q?: string; limit?: string; bookmark?: string };
    if (!q) return reply.status(400).send({ error: 'q (query) is required' });
    try {
      const lim = limit ? Math.min(parseInt(limit), 25) : 12;
      const { results, nextBookmark } = await searchPinterest(q, lim, bookmark);
      return { query: q, count: results.length, results, nextBookmark };
    } catch (err: any) {
      return reply.status(502).send({ error: err.message });
    }
  });

  // POST /api/creative/pinterest/multi — search multiple queries at once
  // Body: { queries: ["luxury villa", "dubai skyline"], perQuery: 6, clientId?: string, savePick?: 0 }
  // If savePick is set, saves that result index as an asset under the client
  app.post('/creative/pinterest/multi', async (request, reply) => {
    const { queries, perQuery, clientId, savePick } = request.body as {
      queries: string[]; perQuery?: number; clientId?: string; savePick?: number;
    };
    if (!Array.isArray(queries) || queries.length === 0) {
      return reply.status(400).send({ error: 'queries array is required' });
    }
    try {
      const results = await searchPinterestMulti(queries, perQuery || 6);

      // Optionally save one as an asset for a client
      let savedAsset = null;
      if (clientId && typeof savePick === 'number' && results[savePick]) {
        const pick = results[savePick];
        try {
          const base64 = await fetchPinterestImageBase64(pick.imageUrl);
          const buf = Buffer.from(base64.split(',')[1], 'base64');
          const { fileUrl, thumbUrl } = await storageService.saveFile(
            buf,
            `pinterest-${pick.id}.jpg`,
            'image/jpeg',
          );
          savedAsset = await db.asset.create({
            data: {
              clientId,
              name: `pinterest-${pick.id}.jpg`,
              mimeType: 'image/jpeg',
              fileUrl,
              thumbUrl,
              tags: ['pinterest', 'visual-ref'],
              safeForClient: true,
            },
          });
        } catch (saveErr: any) {
          console.error('[pinterest] Failed to save asset:', saveErr.message);
        }
      }

      return { count: results.length, results, savedAsset };
    } catch (err: any) {
      return reply.status(502).send({ error: err.message });
    }
  });
}
