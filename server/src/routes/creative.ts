import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { aiRouter, getAiTelemetry } from '../services/providers/ai-router.js';
import { sendAiError } from '../services/providers/errors.js';
import { createJob, processJob, getJob, updateJob } from '../workers/queue.js';
import { storageService } from '../services/storage.service.js';
import { db } from '../db/prisma.js';
import { searchPinterest, searchPinterestMulti, fetchPinterestImageBase64 } from '../services/pinterest.service.js';
import { historyService } from '../services/history.service.js';
import { sanitizePrompt, validatePrompt } from '../middleware/sanitize.js';
import { enhanceCreativePrompt, type EnhanceMode } from '../services/prompt-enhancer.service.js';
import type { Job } from '../workers/queue.js';

// B3 — social safe-zone: appended to the prompt when the user toggles it on, so
// generated creative keeps the top/bottom platform-UI bands clear (Reels/Stories
// controls, caption overlays). Prompt-level guidance (v1); pixel-accurate
// compositing would be a later enhancement.
const SAFE_ZONE_HINT = 'IMPORTANT COMPOSITION CONSTRAINT: keep the top ~15% and bottom ~15% of the frame clear of text, logos, faces, and key subjects — reserve those bands for social platform UI (Reels/Stories controls, captions). Center all important elements in the middle safe area.';

export async function creativeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // POST /api/creative/images/generate
  app.post('/creative/images/generate', async (request, reply) => {
    const { prompt: rawPrompt, aspectRatio, clientId, quality, model, provider, safeZone, imageSize } = request.body as { prompt: string; aspectRatio?: string; clientId?: string; quality?: 'standard' | 'ultra'; model?: string; provider?: 'gemini' | 'xai' | 'dashscope'; safeZone?: boolean; imageSize?: '1K' | '2K' | '4K' };
    const v = validatePrompt(rawPrompt);
    if (!v.valid) return reply.status(400).send({ error: v.error });
    const prompt = sanitizePrompt(rawPrompt);
    const genPrompt = safeZone ? `${prompt}\n\n${SAFE_ZONE_HINT}` : prompt;

    try {
      const result = await aiRouter.image({ prompt: genPrompt, aspectRatio, quality, model, imageSize }, { orgId: request.orgId, userId: request.user?.userId, clientId, preferredProvider: provider });
      // Persist to assets. Gemini/Grok return base64; DashScope (qwen/wan)
      // returns an EXPIRING OSS url, so fetch+store it too — otherwise the
      // image vanishes when the signed link expires and never hits the gallery.
      let savedAsset = null;
      if (clientId) {
        let buf: Buffer | null = null;
        if (result.output.base64) {
          buf = Buffer.from(result.output.base64, 'base64');
        } else if (result.output.url) {
          try { buf = Buffer.from(await (await fetch(result.output.url)).arrayBuffer()); }
          catch (e: any) { request.log.warn(`image url fetch failed: ${e?.message}`); }
        }
        if (buf) {
          const { fileUrl, thumbUrl } = await storageService.saveFile(buf, `ai-gen-${Date.now()}.png`, 'image/png');
          savedAsset = await db.asset.create({
            data: { orgId: request.orgId!, clientId, name: `ai-gen-${Date.now()}.png`, mimeType: 'image/png', fileUrl, thumbUrl, tags: ['ai-generated'], safeForClient: true },
          });
        }
      }
      const finalUrl = savedAsset?.fileUrl || result.output.url || null;
      await historyService.record({
        orgId: request.orgId,
        userId: request.user?.userId,
        clientId: clientId || undefined,
        type: 'image',
        surface: 'creative_tools',
        prompt,
        outputUrl: finalUrl,
        thumbnailUrl: savedAsset?.thumbUrl || finalUrl,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        metadata: { aspectRatio, quality, mode: 'text-to-image', assetId: savedAsset?.id || null },
      });
      return {
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        fallbackUsed: result.fallbackUsed,
        url: result.output.url || null,
        base64: result.output.base64 ? true : false,
        assetId: savedAsset?.id || null,
        assetUrl: finalUrl,
      };
    } catch (err: any) {
      await historyService.record({
        orgId: request.orgId,
        userId: request.user?.userId,
        clientId: clientId || undefined,
        type: 'image',
        surface: 'creative_tools',
        prompt,
        status: 'failed',
        error: err?.message || 'unknown',
        metadata: { aspectRatio, quality, mode: 'text-to-image' },
      });
      return sendAiError(reply, err, 'Image generation failed');
    }
  });

  // POST /api/creative/images/edit
  app.post('/creative/images/edit', async (request, reply) => {
    const { prompt, imageBase64, mimeType, aspectRatio, clientId, model, provider, referenceImages, safeZone, imageSize } = request.body as any;
    if (!prompt || !imageBase64) return reply.status(400).send({ error: 'prompt and imageBase64 are required' });

    try {
      // referenceImages = additional input frames (multi-image edit). Gemini's
      // imageEdit inlines imageBase64 (primary) + every referenceImage, with the
      // optional per-image `role` (content/style/character) preserved (B1).
      const refs = Array.isArray(referenceImages)
        ? referenceImages.filter((r: any) => r?.base64 && r?.mimeType)
            .slice(0, 8)
            .map((r: any) => ({ base64: r.base64, mimeType: r.mimeType, ...(r.role ? { role: r.role } : {}) }))
        : undefined;
      const genPrompt = safeZone ? `${prompt}\n\n${SAFE_ZONE_HINT}` : prompt;
      const result = await aiRouter.image({ prompt: genPrompt, imageBase64, mimeType: mimeType || 'image/png', aspectRatio, model, referenceImages: refs, imageSize }, { orgId: request.orgId, userId: request.user?.userId, clientId, preferredProvider: provider });
      let savedAsset = null;
      if (result.output.base64 && clientId) {
        const buf = Buffer.from(result.output.base64, 'base64');
        const { fileUrl, thumbUrl } = await storageService.saveFile(buf, `ai-edit-${Date.now()}.png`, 'image/png');
        savedAsset = await db.asset.create({
          data: { orgId: request.orgId!, clientId, name: `ai-edit-${Date.now()}.png`, mimeType: 'image/png', fileUrl, thumbUrl, tags: ['ai-edited'], safeForClient: true },
        });
      }
      const finalUrl = savedAsset?.fileUrl || result.output.url || null;
      await historyService.record({
        orgId: request.orgId,
        userId: request.user?.userId,
        clientId: clientId || undefined,
        type: 'image',
        surface: 'creative_tools',
        prompt,
        outputUrl: finalUrl,
        thumbnailUrl: savedAsset?.thumbUrl || finalUrl,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        metadata: { aspectRatio, mode: 'image-edit', assetId: savedAsset?.id || null },
      });
      return {
        provider: result.provider, model: result.model,
        latencyMs: result.latencyMs, fallbackUsed: result.fallbackUsed,
        url: result.output.url || null,
        assetId: savedAsset?.id || null,
        assetUrl: finalUrl,
      };
    } catch (err: any) {
      await historyService.record({
        orgId: request.orgId,
        userId: request.user?.userId,
        clientId: clientId || undefined,
        type: 'image',
        surface: 'creative_tools',
        prompt,
        status: 'failed',
        error: err?.message || 'unknown',
        metadata: { aspectRatio, mode: 'image-edit' },
      });
      return sendAiError(reply, err, 'AI operation failed');
    }
  });

  // POST /api/creative/videos/generate — async via job queue
  // Supports both text-to-video AND image-to-video (when imageBase64 is provided).
  app.post('/creative/videos/generate', async (request, reply) => {
    const {
      prompt, aspectRatio, durationSeconds, resolution, clientId,
      imageBase64, mimeType,
      // Workshop 2026-05-06 #3 (Haneen): explicit start + end frame controls
      startImageBase64, startMimeType, endImageBase64, endMimeType,
      // Cost tiering (design 2026-06-03): draft → Grok ($0.05/s), hd → veo-3.1-fast
      // ($0.20/s). Default draft (cheap). Full Veo is never selected in v1.
      tier,
      safeZone,
      negativePrompt,
      referenceImages,
      model,
    } = request.body as any;
    if (!prompt) return reply.status(400).send({ error: 'prompt is required' });
    const genPrompt = safeZone ? `${prompt}\n\n${SAFE_ZONE_HINT}` : prompt;
    // Veo "ingredients to video" asset refs — the subject/product stays
    // consistent in the output. Max 3; forces an 8s clip (Google constraint,
    // enforced in the provider). Routed Veo-primary via imageConditioned.
    const videoRefs = Array.isArray(referenceImages)
      ? referenceImages
          .filter((r: any) => r?.base64 && r?.mimeType)
          .slice(0, 3)
          .map((r: any) => ({ base64: r.base64, mimeType: r.mimeType }))
      : undefined;

    // Both Gemini Veo and xAI grok-imagine-video only accept 16:9 and 9:16.
    // Reject unsupported ratios upfront with a clear message instead of letting
    // the upstream provider's raw JSON error leak through.
    const allowedAspects = ['16:9', '9:16'];
    if (aspectRatio && !allowedAspects.includes(aspectRatio)) {
      return reply.status(400).send({
        error: `Video generation only supports aspect ratios ${allowedAspects.join(' and ')}. Got "${aspectRatio}". Switch to 16:9 or 9:16.`,
      });
    }

    const orgId = request.orgId;
    const userId = request.user?.userId;
    const job = createJob('creative-video', {
      prompt: genPrompt, aspectRatio, durationSeconds, resolution, clientId,
      imageBase64, mimeType,
      startImageBase64, startMimeType, endImageBase64, endMimeType,
      tier: tier === 'hd' ? 'hd' : 'draft',
      negativePrompt: typeof negativePrompt === 'string' && negativePrompt.trim() ? negativePrompt.trim().slice(0, 500) : undefined,
      referenceImages: videoRefs,
      model: typeof model === 'string' && model.trim() ? model.trim() : undefined,
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
            startImageBase64: j.data.startImageBase64,
            startMimeType: j.data.startMimeType,
            endImageBase64: j.data.endImageBase64,
            endMimeType: j.data.endMimeType,
            // Cost tiering: tier drives provider order in ai-router; fast is
            // ALWAYS true in v1 (draft → grok-fast fallback, hd → veo-3.1-fast).
            tier: j.data.tier,
            fast: true,
            negativePrompt: j.data.negativePrompt,
            referenceImages: j.data.referenceImages,
            model: j.data.model,
          },
          // Engine pins: Omni lives on Gemini, Wan on DashScope — pin the
          // provider so tier-based reordering can't send the request to an
          // engine that ignores req.model.
          { orgId, userId, jobId: j.id, clientId: j.data.clientId,
            ...(j.data.model && /omni/i.test(j.data.model) ? { preferredProvider: 'gemini' as const }
              : j.data.model && /wan/i.test(j.data.model) ? { preferredProvider: 'dashscope' as const } : {}) },
        );
        await historyService.record({
          orgId,
          userId,
          clientId: j.data.clientId || undefined,
          type: 'video',
          surface: 'creative_tools',
          prompt: j.data.prompt,
          outputUrl: result.output.url || null,
          thumbnailUrl: result.output.url || null,
          provider: result.provider,
          model: result.model,
          latencyMs: result.latencyMs,
          metadata: {
            aspectRatio: j.data.aspectRatio,
            durationSeconds: j.data.durationSeconds,
            resolution: j.data.resolution,
            mode: j.data.imageBase64 ? 'image-to-video' : 'text-to-video',
            jobId: j.id,
          },
        });
        return {
          provider: result.provider, model: result.model,
          latencyMs: result.latencyMs, fallbackUsed: result.fallbackUsed,
          url: result.output.url,
        };
      } catch (err: any) {
        await historyService.record({
          orgId,
          userId,
          clientId: j.data.clientId || undefined,
          type: 'video',
          surface: 'creative_tools',
          prompt: j.data.prompt,
          status: 'failed',
          error: err?.message || 'unknown',
          metadata: {
            aspectRatio: j.data.aspectRatio,
            mode: j.data.imageBase64 ? 'image-to-video' : 'text-to-video',
            jobId: j.id,
          },
        });
        throw err;
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
  // Model-aware magic pen (upgraded 2026-07-02). Video prompts follow Veo's
  // official [Cinematography]+[Subject]+[Action]+[Context]+[Style&Ambiance]
  // formula with SFX/Ambient-noise audio lines; image prompts follow an
  // ad-creative composition structure; Arabic briefs are translated (Veo is
  // English-only) while in-image ad copy stays in its original language.
  // Body: { prompt, mode?, clientId?, safeZone?, hasRefs? }
  app.post('/creative/prompt/improve', async (request, reply) => {
    const { prompt, mode, clientId, safeZone, hasRefs } = (request.body as {
      prompt?: string; mode?: string; clientId?: string; safeZone?: boolean; hasRefs?: boolean;
    }) || {};
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return reply.status(400).send({ error: 'prompt is required' });
    }
    const validModes: EnhanceMode[] = ['text-to-image', 'image-edit', 'text-to-video', 'image-to-video'];
    const enhanceMode: EnhanceMode = validModes.includes(mode as EnhanceMode) ? (mode as EnhanceMode) : 'text-to-image';

    try {
      const result = await enhanceCreativePrompt({
        prompt,
        mode: enhanceMode,
        clientId: clientId || undefined,
        orgId: request.orgId,
        userId: request.user?.userId,
        safeZone: Boolean(safeZone),
        hasRefs: Boolean(hasRefs),
      });
      await historyService.record({
        orgId: request.orgId,
        userId: request.user?.userId,
        clientId: clientId || undefined,
        type: 'text',
        surface: 'creative_tools',
        prompt: `[improve:${enhanceMode}] ${prompt}`,
        outputText: result.prompt,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        metadata: { mode: enhanceMode, kind: 'prompt-improver', negativePrompt: result.negativePrompt || null },
      });
      return {
        original: prompt,
        improved: result.prompt,
        negativePrompt: result.negativePrompt || null,
        mode: enhanceMode,
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
              orgId: request.orgId!,
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
