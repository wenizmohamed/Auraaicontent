import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { aiRouter, getAiTelemetry } from '../services/providers/ai-router.js';
import { sendAiError } from '../services/providers/errors.js';
import { createJob, processJob, getJob, updateJob } from '../workers/queue.js';
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
      return sendAiError(reply, err, 'Image generation failed');
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
      return sendAiError(reply, err, 'AI operation failed');
    }
  });

  // POST /api/creative/videos/generate — async via job queue
  // Supports both text-to-video AND image-to-video (when imageBase64 is provided).
  app.post('/creative/videos/generate', async (request, reply) => {
    const { prompt, aspectRatio, durationSeconds, resolution, clientId, imageBase64, mimeType } =
      request.body as any;
    if (!prompt) return reply.status(400).send({ error: 'prompt is required' });

    // Both Gemini Veo and xAI grok-imagine-video only accept 16:9 and 9:16.
    // Reject unsupported ratios upfront with a clear message instead of letting
    // the upstream provider's raw JSON error leak through.
    const allowedAspects = ['16:9', '9:16'];
    if (aspectRatio && !allowedAspects.includes(aspectRatio)) {
      return reply.status(400).send({
        error: `Video generation only supports aspect ratios ${allowedAspects.join(' and ')}. Got "${aspectRatio}". Switch to 16:9 or 9:16.`,
      });
    }

    const job = createJob('creative-video', {
      prompt, aspectRatio, durationSeconds, resolution, clientId, imageBase64, mimeType,
    });
    processJob(job.id, async (j: Job) => {
      // Bump progress every 3 seconds while the long Gemini Veo call runs.
      // Without this the user sees "5%" frozen for ~75 seconds and assumes the job is broken.
      // Caps at 90% so the final jump to 100% is the actual completion.
      let p = 10;
      const ticker = setInterval(() => {
        p = Math.min(p + 5, 90);
        updateJob(j.id, { progress: p });
      }, 3000);
      try {
        const result = await aiRouter.video(
          {
            prompt: j.data.prompt,
            aspectRatio: j.data.aspectRatio,
            durationSeconds: j.data.durationSeconds,
            resolution: j.data.resolution,
            imageBase64: j.data.imageBase64,
            mimeType: j.data.mimeType,
          },
          { jobId: j.id, clientId: j.data.clientId },
        );
        return {
          provider: result.provider, model: result.model,
          latencyMs: result.latencyMs, fallbackUsed: result.fallbackUsed,
          url: result.output.url,
        };
      } finally {
        clearInterval(ticker);
      }
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

  // POST /api/creative/prompt/improve
  // Magic-pen prompt rewriter for the 4 primary creative modes.
  // Body: { prompt: string, mode?: 'text-to-image'|'image-edit'|'text-to-video'|'image-to-video' }
  app.post('/creative/prompt/improve', async (request, reply) => {
    const { prompt, mode } = (request.body as { prompt?: string; mode?: string }) || {};
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return reply.status(400).send({ error: 'prompt is required' });
    }

    const modeHints: Record<string, string> = {
      'text-to-image': 'a single still image',
      'image-edit': 'an edit applied to an existing image',
      'text-to-video': 'a short video clip generated from scratch',
      'image-to-video': 'a short video animated from a starting still image',
    };
    const targetHint = modeHints[mode || ''] || 'a creative output';

    const improvePrompt = [
      `You are a senior creative director. Rewrite the user's raw prompt into a stronger, more vivid prompt for ${targetHint}.`,
      ``,
      `Rules:`,
      `- Keep the user's core intent and subject.`,
      `- Add specific visual details: lighting, composition, mood, color palette, camera angle, style references where relevant.`,
      `- Use present tense, concrete nouns, evocative adjectives.`,
      `- 1-3 sentences, no preamble, no quotes, no markdown.`,
      `- Return ONLY the improved prompt as plain text.`,
      ``,
      `User prompt:`,
      `"${prompt.trim()}"`,
      ``,
      `Improved prompt:`,
    ].join('\n');

    try {
      const result = await aiRouter.text({ prompt: improvePrompt, temperature: 0.6 });
      const improved = (typeof result.output === 'string' ? result.output : JSON.stringify(result.output))
        .trim()
        .replace(/^["']+|["']+$/g, '')   // strip wrap quotes if model added them
        .replace(/^Improved prompt:\s*/i, '');
      return {
        original: prompt,
        improved,
        mode: mode || null,
        provider: result.provider,
        latencyMs: result.latencyMs,
      };
    } catch (err: any) {
      return sendAiError(reply, err, 'Prompt improver failed');
    }
  });

  // ─── Pinterest scraper (no API key) ─────────────────────────────
  // Mirrors local Claude commit bb6ae31 — public JSON endpoint, browser-shaped headers.

  // GET /api/creative/pinterest/search?q=...&limit=12&bookmark=...
  app.get('/creative/pinterest/search', async (request, reply) => {
    const { q, limit, bookmark } = request.query as { q?: string; limit?: string; bookmark?: string };
    if (!q) return reply.status(400).send({ error: 'q (query) is required' });
    try {
      const lim = limit ? Math.min(parseInt(limit), 25) : 12;
      const { results, nextBookmark } = await searchPinterest(q, lim, bookmark);
      return { query: q, count: results.length, results, nextBookmark };
    } catch (err: any) {
      return sendAiError(reply, err, 'AI operation failed');
    }
  });

  // POST /api/creative/pinterest/multi
  // Body: { queries: ["luxury villa","dubai"], perQuery: 6, clientId?: string, savePick?: number }
  // If savePick is set, downloads that result and saves it as an Asset under clientId.
  app.post('/creative/pinterest/multi', async (request, reply) => {
    const { queries, perQuery, clientId, savePick } = request.body as {
      queries: string[]; perQuery?: number; clientId?: string; savePick?: number;
    };
    if (!Array.isArray(queries) || queries.length === 0) {
      return reply.status(400).send({ error: 'queries array is required' });
    }
    try {
      const results = await searchPinterestMulti(queries, perQuery || 6);

      let savedAsset = null;
      if (clientId && typeof savePick === 'number' && results[savePick]) {
        const pick = results[savePick];
        try {
          const dataUrl = await fetchPinterestImageBase64(pick.imageUrl);
          const base64 = dataUrl.split(',')[1] || '';
          const buf = Buffer.from(base64, 'base64');
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
      return sendAiError(reply, err, 'AI operation failed');
    }
  });
}
