import { errStatus, errMessage } from '../services/providers/errors.js';
import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { aiRouter, getAiTelemetry } from '../services/providers/ai-router.js';
import { sendAiError } from '../services/providers/errors.js';
import { createJob, processJob, getJob } from '../workers/queue.js';
import { creativeVideoWorker } from '../workers/creativeVideo.worker.js';
import { storageService } from '../services/storage.service.js';
import { db } from '../db/prisma.js';
import { searchPinterest, searchPinterestMulti, fetchPinterestImageBase64 } from '../services/pinterest.service.js';
import { historyService } from '../services/history.service.js';
import { sanitizePrompt, validatePrompt } from '../middleware/sanitize.js';
import { enhanceCreativePrompt, enhanceCreativeVariants, type EnhanceMode, type EnhanceVariant } from '../services/prompt-enhancer.service.js';
import { getStylePack, listStylePacks } from '../services/style-packs.js';
import { recordMemory } from '../services/memory.service.js';
import { upscaleImage } from '../services/upscale.service.js';
import { assertVideoDailyGuardrail } from '../lib/budget.js';

// B3 — social safe-zone: appended to the prompt when the user toggles it on, so
// generated creative keeps the top/bottom platform-UI bands clear (Reels/Stories
// controls, caption overlays). Prompt-level guidance (v1); pixel-accurate
// compositing would be a later enhancement.
const SAFE_ZONE_HINT = 'IMPORTANT COMPOSITION CONSTRAINT: keep the top ~15% and bottom ~15% of the frame clear of text, logos, faces, and key subjects — reserve those bands for social platform UI (Reels/Stories controls, captions). Center all important elements in the middle safe area.';

export async function creativeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // POST /api/creative/images/generate
  app.post('/creative/images/generate', async (request, reply) => {
    const { prompt: rawPrompt, aspectRatio, clientId, quality, model, provider, safeZone, imageSize, enhance, depth, stylePackId } = request.body as { prompt: string; aspectRatio?: string; clientId?: string; quality?: 'standard' | 'ultra'; model?: string; provider?: 'gemini' | 'xai' | 'dashscope'; safeZone?: boolean; imageSize?: '1K' | '2K' | '4K'; enhance?: boolean; depth?: 'raw' | 'low' | 'medium' | 'high'; stylePackId?: string };
    const v = validatePrompt(rawPrompt);
    if (!v.valid) return reply.status(400).send({ error: v.error });
    const prompt = sanitizePrompt(rawPrompt);
    const stylePack = getStylePack(stylePackId);
    // Auto pro-prompt (default ON, 2026-07-03): short user prompts are the #1
    // quality killer — expand them through the model-aware enhancer BEFORE
    // generation. Best-effort: any enhancer failure falls back to the raw
    // prompt. enhance:false (FE toggle) opts out. The enhancer already folds
    // the safe-zone constraint into its composition guidance.
    let enhancedPrompt: string | null = null;
    if (enhance !== false) {
      try {
        const e = await enhanceCreativePrompt({ prompt, mode: 'text-to-image', engine: provider, model, depth, clientId: clientId || undefined, orgId: request.orgId, userId: request.user?.userId, safeZone: Boolean(safeZone), stylePack });
        if (e.prompt && e.prompt.trim() && e.prompt.trim() !== prompt) enhancedPrompt = e.prompt.trim();
      } catch (e) { request.log.warn(`prompt-enhancer failed (image): ${errMessage(e)}`); }
    }
    // Pack must survive enhance:false AND enhancer failure — append the raw
    // design contract so the style still lands on the model.
    const packTail = stylePack && !enhancedPrompt ? `\n\nArt direction (follow exactly): ${stylePack.image}` : '';
    const genPrompt = (enhancedPrompt ?? (safeZone ? `${prompt}\n\n${SAFE_ZONE_HINT}` : prompt)) + packTail;

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
          catch (e) { request.log.warn(`image url fetch failed: ${errMessage(e)}`); }
        }
        if (buf) {
          const { fileUrl, thumbUrl } = await storageService.saveFile(buf, `ai-gen-${Date.now()}.png`, 'image/png');
          savedAsset = await db.asset.create({
            data: { orgId: request.orgId!, clientId, name: `ai-gen-${Date.now()}.png`, mimeType: 'image/png', fileUrl, thumbUrl, tags: ['ai-generated'], safeForClient: true },
          });
        }
      }
      const finalUrl = savedAsset?.fileUrl || result.output.url || null;
      // generationId returned so the FE thumbs (POST /creative/feedback) can
      // reference this exact generation for the learn-from-feedback loop.
      const generationId = await historyService.record({
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
        metadata: { aspectRatio, quality, mode: 'text-to-image', assetId: savedAsset?.id || null, enhancedPrompt },
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
        enhancedPrompt,
        generationId,
      };
    } catch (err) {
      await historyService.record({
        orgId: request.orgId,
        userId: request.user?.userId,
        clientId: clientId || undefined,
        type: 'image',
        surface: 'creative_tools',
        prompt,
        status: 'failed',
        error: errMessage(err, 'unknown'),
        metadata: { aspectRatio, quality, mode: 'text-to-image' },
      });
      return sendAiError(reply, err, 'Image generation failed');
    }
  });

  // POST /api/creative/images/edit
  app.post('/creative/images/edit', async (request, reply) => {
    const { prompt: rawEditPrompt, imageBase64, mimeType, aspectRatio, clientId, model, provider, referenceImages, safeZone, imageSize, enhance, depth } = request.body as any;
    if (!rawEditPrompt || !imageBase64) return reply.status(400).send({ error: 'prompt and imageBase64 are required' });
    const ev = validatePrompt(rawEditPrompt);
    if (!ev.valid) return reply.status(400).send({ error: ev.error });
    const prompt = sanitizePrompt(rawEditPrompt);

    try {
      // referenceImages = additional input frames (multi-image edit). Gemini's
      // imageEdit inlines imageBase64 (primary) + every referenceImage, with the
      // optional per-image `role` (content/style/character) preserved (B1).
      const refs = Array.isArray(referenceImages)
        ? referenceImages.filter((r: any) => r?.base64 && r?.mimeType)
            .slice(0, 8)
            .map((r: any) => ({ base64: r.base64, mimeType: r.mimeType, ...(r.role ? { role: r.role } : {}) }))
        : undefined;
      // Auto pro-prompt (default ON) — precise edit instructions beat vague ones.
      let enhancedPrompt: string | null = null;
      if (enhance !== false) {
        try {
          // Vision→prompt: the edit source image is described by the analysis
          // model so the instruction grounds in what's ACTUALLY in the image.
          const e = await enhanceCreativePrompt({ prompt, mode: 'image-edit', engine: provider, model, depth, clientId: clientId || undefined, orgId: request.orgId, userId: request.user?.userId, safeZone: Boolean(safeZone), hasRefs: !!refs?.length, refImageBase64: imageBase64, refImageMime: mimeType || 'image/png' });
          if (e.prompt && e.prompt.trim() && e.prompt.trim() !== prompt) enhancedPrompt = e.prompt.trim();
        } catch (e) { request.log.warn(`prompt-enhancer failed (edit): ${errMessage(e)}`); }
      }
      const genPrompt = enhancedPrompt ?? (safeZone ? `${prompt}\n\n${SAFE_ZONE_HINT}` : prompt);
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
      const generationId = await historyService.record({
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
        metadata: { aspectRatio, mode: 'image-edit', assetId: savedAsset?.id || null, enhancedPrompt },
      });
      return {
        provider: result.provider, model: result.model,
        latencyMs: result.latencyMs, fallbackUsed: result.fallbackUsed,
        url: result.output.url || null,
        assetId: savedAsset?.id || null,
        assetUrl: finalUrl,
        enhancedPrompt,
        generationId,
      };
    } catch (err) {
      await historyService.record({
        orgId: request.orgId,
        userId: request.user?.userId,
        clientId: clientId || undefined,
        type: 'image',
        surface: 'creative_tools',
        prompt,
        status: 'failed',
        error: errMessage(err, 'unknown'),
        metadata: { aspectRatio, mode: 'image-edit' },
      });
      return sendAiError(reply, err, 'AI operation failed');
    }
  });

  // GET /api/creative/style-packs — curated premium design directions for the
  // FE picker (motionsites.ai-style precision looks; directives stay server-side).
  app.get('/creative/style-packs', async () => ({ packs: listStylePacks() }));

  // ─── Upscaler (Weni 2026-07-14): scale an image up to 16K ───────
  // POST /api/creative/images/upscale — source = base64 or sourceUrl (an
  // existing asset/generation). Fast tier (sharp Lanczos) by default; ai tier
  // (fal) when configured, else transparently falls back to fast.
  app.post('/creative/images/upscale', async (request, reply) => {
    const { imageBase64, mimeType, sourceUrl, scale, targetLongEdge, format, mode, model, provider, clientId } = (request.body as any) || {};
    if (!imageBase64 && !sourceUrl) return reply.status(400).send({ error: 'imageBase64 or sourceUrl is required' });
    try {
      const result = await upscaleImage({
        base64: imageBase64, mimeType, sourceUrl,
        scale: scale === 2 || scale === 4 || scale === 8 ? scale : undefined,
        targetLongEdge: typeof targetLongEdge === 'number' ? targetLongEdge : undefined,
        format: format === 'png' || format === 'jpeg' ? format : 'auto',
        mode: mode === 'ai' ? 'ai' : 'fast',
        model: typeof model === 'string' ? model : undefined,
        provider: provider === 'gemini' || provider === 'xai' || provider === 'dashscope' ? provider : undefined,
        orgId: request.orgId, userId: request.user?.userId, clientId: clientId || undefined,
      });
      // Persist to the client's assets so it lands in the gallery.
      let savedAsset = null;
      if (clientId && request.orgId) {
        savedAsset = await db.asset.create({
          data: { orgId: request.orgId, clientId, name: `upscaled-${result.width}x${result.height}.${result.format === 'jpeg' ? 'jpg' : 'png'}`, mimeType: result.format === 'jpeg' ? 'image/jpeg' : 'image/png', fileUrl: result.fileUrl, thumbUrl: result.thumbUrl || null, tags: ['ai-generated', 'upscaled'], safeForClient: true },
        });
      }
      await historyService.record({
        orgId: request.orgId, userId: request.user?.userId, clientId: clientId || undefined,
        type: 'image', surface: 'creative_tools',
        prompt: `Upscale → ${result.width}×${result.height} (${result.scale}×, ${result.provider})`,
        outputUrl: result.fileUrl, thumbnailUrl: result.thumbUrl || result.fileUrl,
        provider: result.provider, model: result.provider === 'sharp' ? 'lanczos3' : 'fal-upscale',
        metadata: { mode: 'upscale', width: result.width, height: result.height, scale: result.scale, bytes: result.bytes, assetId: savedAsset?.id || null },
      });
      return { ...result, assetId: savedAsset?.id || null, assetUrl: savedAsset?.fileUrl || result.fileUrl };
    } catch (err) {
      return sendAiError(reply, err, 'Upscale failed');
    }
  });

  // POST /api/creative/feedback — thumbs up/down on a generation (SOTA pass
  // 2026-07-09). Writes the lesson into the Memory table so the memory-enricher
  // feeds it back into every future enhancement/generation for this client —
  // the same learn-from-feedback USP loop as copywriting (C1), now closing on
  // the creative surface. Enhanced prompt (when present) beats the raw one as
  // the exemplar since it's what the model actually saw.
  app.post('/creative/feedback', async (request, reply) => {
    const { generationId, liked } = request.body as { generationId?: string; liked?: boolean };
    if (!generationId || typeof liked !== 'boolean') {
      return reply.status(400).send({ error: 'generationId and liked (boolean) are required' });
    }
    const gen = await db.generation.findFirst({ where: { id: generationId, orgId: request.orgId! } });
    if (!gen) return reply.status(404).send({ error: 'Generation not found' });
    const styled = ((gen.metadata as any)?.enhancedPrompt as string | undefined) || gen.prompt;
    const memoryId = await recordMemory({
      orgId: request.orgId!,
      clientId: gen.clientId,
      userId: request.user?.userId,
      kind: liked ? 'preference' : 'correction',
      source: 'explicit',
      content: liked
        ? `Creative ${gen.type} WIN — the team liked the output of this prompt; reuse its structure, lighting and composition vocabulary for this client: "${styled.slice(0, 400)}"`
        : `Creative ${gen.type} MISS — the team disliked the output of this prompt; avoid this direction for this client: "${styled.slice(0, 300)}"`,
      context: `creative feedback · generation ${gen.id} · model ${gen.model || 'n/a'}`,
      weight: liked ? 1.2 : 1.4, // misses weigh slightly heavier — repeat-avoidance beats repeat-success
      metadata: { surface: 'creative', generationId: gen.id, liked },
    });
    return { ok: true, memoryId };
  });

  // POST /api/creative/videos/generate — async via job queue
  // Supports both text-to-video AND image-to-video (when imageBase64 is provided).
  app.post('/creative/videos/generate', async (request, reply) => {
    // eslint-disable-next-line prefer-const
    let {
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
      enhance,
      depth,
      stylePackId,
    } = request.body as any;
    if (!prompt) return reply.status(400).send({ error: 'prompt is required' });
    {
      const vv = validatePrompt(prompt);
      if (!vv.valid) return reply.status(400).send({ error: vv.error });
    }
    prompt = sanitizePrompt(prompt);
    // Video spend guardrail — video is ~97% of AI cost. Soft cap logs a WARN
    // (watchdog alerts); hard cap (if configured) blocks for the rest of the day.
    try {
      await assertVideoDailyGuardrail(request.orgId);
    } catch (e) {
      return reply.status(errStatus(e, 402)).send({ error: errMessage(e) });
    }
    const stylePack = getStylePack(stylePackId);
    // Auto pro-prompt (default ON): rewrite into Veo's cinematography-first
    // formula w/ audio directives + auto negatives; Arabic briefs translated.
    // Best-effort — failure falls back to the raw prompt.
    const videoMode = imageBase64 || startImageBase64 ? 'image-to-video' : 'text-to-video';
    // Engine hint for the enhancer dialect — mirrors the router's actual
    // dispatch: wan→dashscope, grok→xai, draft text-only→Grok-primary,
    // everything image-conditioned / hd / omni → Veo (gemini).
    const hasVideoRefs = Array.isArray(referenceImages) && referenceImages.length > 0;
    const enhEngine = model && /wan/i.test(model) ? ('dashscope' as const)
      : model && /grok/i.test(model) ? ('xai' as const)
      : (videoMode === 'text-to-video' && tier !== 'hd' && !model && !hasVideoRefs) ? ('xai' as const)
      : ('gemini' as const);
    let enhancedPrompt: string | null = null;
    let autoNegative: string | undefined;
    if (enhance !== false) {
      try {
        const e = await enhanceCreativePrompt({
          prompt, mode: videoMode as any, engine: enhEngine, model, depth,
          clientId: clientId || undefined,
          orgId: request.orgId, userId: request.user?.userId,
          safeZone: Boolean(safeZone), hasRefs: hasVideoRefs,
          // Vision→prompt: describe the start frame so motion directions
          // reference the real subject, not the user's thin description.
          refImageBase64: imageBase64 || startImageBase64 || undefined,
          refImageMime: (imageBase64 ? mimeType : startMimeType) || 'image/png',
          stylePack,
        });
        if (e.prompt && e.prompt.trim() && e.prompt.trim() !== prompt) enhancedPrompt = e.prompt.trim();
        autoNegative = e.negativePrompt;
      } catch (e) { request.log.warn(`prompt-enhancer failed (video): ${errMessage(e)}`); }
    }
    // Pack survives enhance:false / enhancer failure (raw design contract);
    // pack negatives ride autoNegative when the enhancer didn't run.
    const packTail = stylePack && !enhancedPrompt ? ` Style & ambiance: ${stylePack.video}` : '';
    if (stylePack && !enhancedPrompt && !autoNegative) autoNegative = stylePack.negative;
    const genPrompt = (enhancedPrompt ?? (safeZone ? `${prompt}\n\n${SAFE_ZONE_HINT}` : prompt)) + packTail;
    const mergedNegative = [autoNegative, typeof negativePrompt === 'string' ? negativePrompt : '']
      .filter(sv => sv && sv.trim()).join(', ').slice(0, 500) || undefined;
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
      // orgId/userId travel IN the job data (not via closure) so the durable
      // queue dispatches with the correct owner even under concurrent requests
      // and after restarts — and so /creative/jobs scoping can authorize.
      orgId, userId,
      prompt: genPrompt, aspectRatio, durationSeconds, resolution, clientId,
      imageBase64, mimeType,
      startImageBase64, startMimeType, endImageBase64, endMimeType,
      tier: tier === 'hd' ? 'hd' : 'draft',
      negativePrompt: mergedNegative,
      referenceImages: videoRefs,
      model: typeof model === 'string' && model.trim() ? model.trim() : undefined,
      enhancedPrompt,
      originalPrompt: prompt,
    });
    processJob(job.id, creativeVideoWorker);

    return reply.status(202).send({ jobId: job.id });
  });

  // GET /api/creative/jobs/:jobId — poll video/creative job status
  app.get('/creative/jobs/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = await getJob(jobId);
    if (job) {
      // Tenant check — job ids are guessable-ish UUIDs and the payload carries
      // result URLs + enhanced prompts. Matches the guard in routes/jobs.ts.
      const jobOrgId = (job as any)?.data?.orgId;
      if (jobOrgId && jobOrgId !== request.orgId) {
        return reply.status(404).send({ error: 'Job not found' });
      }
      return { id: job.id, status: job.status, progress: job.progress, result: job.result, error: job.error };
    }
    // Restart survivor: the queue is in-memory and wiped on every deploy, but
    // the worker records every finished video in Generation with
    // metadata.jobId. If the result outlived the queue, hand it back instead
    // of losing a paid generation to a 404.
    const gen = await db.generation.findFirst({
      where: { orgId: request.orgId!, type: 'video', metadata: { path: ['jobId'], equals: jobId } },
      orderBy: { createdAt: 'desc' },
    });
    if (gen) {
      if (gen.status === 'failed') {
        return { id: jobId, status: 'failed', progress: 100, result: null, error: gen.error || 'Video generation failed' };
      }
      return { id: jobId, status: 'completed', progress: 100, result: { url: gen.outputUrl, provider: gen.provider, model: gen.model }, error: null };
    }
    return reply.status(404).send({ error: 'Job not found' });
  });

  // GET /api/creative/telemetry — provider audit log, scoped to the caller's
  // org (entries with no orgId are system/worker calls and stay visible).
  // Mirrors the dashboard's filter — returning the raw buffer exposed every
  // org's orgId/clientId/jobId/error strings to any authenticated user.
  app.get('/creative/telemetry', async (request) => {
    return getAiTelemetry().filter((e: any) => !e.orgId || e.orgId === request.orgId);
  });

  // POST /api/creative/prompt/improve
  // Model-aware magic pen (upgraded 2026-07-02). Video prompts follow Veo's
  // official [Cinematography]+[Subject]+[Action]+[Context]+[Style&Ambiance]
  // formula with SFX/Ambient-noise audio lines; image prompts follow an
  // ad-creative composition structure; Arabic briefs are translated (Veo is
  // English-only) while in-image ad copy stays in its original language.
  // Body: { prompt, mode?, clientId?, safeZone?, hasRefs? }
  app.post('/creative/prompt/improve', async (request, reply) => {
    const { prompt: rawImp, mode, clientId, safeZone, hasRefs, stylePackId } = (request.body as {
      prompt?: string; mode?: string; clientId?: string; safeZone?: boolean; hasRefs?: boolean; stylePackId?: string;
    }) || {};
    if (!rawImp || typeof rawImp !== 'string' || !rawImp.trim()) {
      return reply.status(400).send({ error: 'prompt is required' });
    }
    const iv = validatePrompt(rawImp);
    if (!iv.valid) return reply.status(400).send({ error: iv.error });
    const prompt = sanitizePrompt(rawImp);
    const validModes: EnhanceMode[] = ['text-to-image', 'image-edit', 'text-to-video', 'image-to-video'];
    const enhanceMode: EnhanceMode = validModes.includes(mode as EnhanceMode) ? (mode as EnhanceMode) : 'text-to-image';

    try {
      const enhanceInput = {
        prompt,
        mode: enhanceMode,
        clientId: clientId || undefined,
        orgId: request.orgId,
        userId: request.user?.userId,
        safeZone: Boolean(safeZone),
        hasRefs: Boolean(hasRefs),
        stylePack: getStylePack(stylePackId),
      };
      // Multi-direction improve: 3 distinct creative angles the user picks from.
      // A variants failure (parse/truncation/provider) must never 5xx a request
      // the single-shot path can still serve — catch and fall through.
      let variants: EnhanceVariant[] = [];
      let vmeta: { provider: string; model: string; latencyMs: number } | null = null;
      try {
        const vres = await enhanceCreativeVariants(enhanceInput, 3);
        variants = vres.variants;
        vmeta = vres;
      } catch (e) {
        request.log.warn(`variants enhancer failed — falling back to single-shot: ${errMessage(e)}`);
      }
      const result = variants.length > 0 && vmeta
        ? { prompt: variants[0].prompt, negativePrompt: variants[0].negativePrompt, provider: vmeta.provider, model: vmeta.model, latencyMs: vmeta.latencyMs }
        : await enhanceCreativePrompt(enhanceInput);
      await historyService.record({
        orgId: request.orgId,
        userId: request.user?.userId,
        clientId: clientId || undefined,
        type: 'text',
        surface: 'creative_tools',
        prompt: `[improve:${enhanceMode}] ${prompt}`,
        // The pick happens client-side — logging variants[0] as THE output would
        // attribute a prompt the user may never use. Log every direction offered.
        outputText: variants.length > 0
          ? variants.map((v, i) => `[${i + 1}] ${v.label}: ${v.prompt}`).join('\n\n')
          : result.prompt,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        metadata: {
          mode: enhanceMode, kind: 'prompt-improver', negativePrompt: result.negativePrompt || null,
          variantCount: variants.length || null,
          variantLabels: variants.length ? variants.map(v => v.label) : null,
        },
      });
      return {
        original: prompt,
        improved: result.prompt,
        negativePrompt: result.negativePrompt || null,
        // 3 distinct creative directions to choose from (empty → FE uses `improved`).
        variants,
        mode: enhanceMode,
        provider: result.provider,
        latencyMs: result.latencyMs,
      };
    } catch (err) {
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
    } catch (err) {
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
        } catch (saveErr) {
          console.error('[pinterest] Failed to save asset:', errMessage(saveErr));
        }
      }

      return { count: results.length, results, savedAsset };
    } catch (err) {
      return sendAiError(reply, err, 'AI operation failed');
    }
  });
}
