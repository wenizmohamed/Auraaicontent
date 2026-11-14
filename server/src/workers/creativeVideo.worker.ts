// Creative-video job worker. Extracted from the inline closure in
// routes/creative.ts so the durable BullMQ queue can register it AT BOOT and
// resume any waiting video jobs after a restart — and so it reads owner/context
// exclusively from job.data (never a request closure), which is required for
// correct dispatch under concurrency + restarts.
import { aiRouter } from '../services/providers/ai-router.js';
import { historyService } from '../services/history.service.js';
import { errMessage } from '../services/providers/errors.js';
import { updateJob, type Job } from './queue.js';
import { enhanceCreativePrompt, engineForModel, selectBestCreativeEngine, SAFE_ZONE_HINT } from '../services/prompt-enhancer.service.js';
import { getStylePack } from '../services/style-packs.js';

// Builds the prompt the engine will see. Runs here (not in the HTTP route)
// since 2026-10-17 so the POST answers at once. Older queued jobs carry a
// pre-enhanced prompt and no `enhance` flag; they pass through unchanged.
async function prepareVideoPrompt(j: Job): Promise<{
  genPrompt: string;
  negativePrompt?: string;
  enhancedPrompt: string | null;
  effectiveModel?: string;
  effectiveProvider?: 'gemini' | 'xai' | 'dashscope' | 'vertex' | 'minimax' | 'byteplus';
}> {
  const d = j.data;
  const videoMode = d.imageBase64 || d.startImageBase64 ? 'image-to-video' : 'text-to-video';
  const hasRefs = Array.isArray(d.referenceImages) && d.referenceImages.length > 0;
  const pinnedModel: string | undefined = d.model;
  const pinnedProvider: 'gemini' | 'xai' | 'dashscope' | 'vertex' | 'minimax' | 'byteplus' | undefined = d.provider;
  const autoPick = (!pinnedModel && !pinnedProvider)
    ? selectBestCreativeEngine(videoMode, d.originalPrompt || d.prompt || '', {
        fast: d.tier === 'draft',
        hasRefs,
        hasEndFrame: Boolean(d.endImageBase64),
      })
    : null;
  const effectiveModel = pinnedModel || autoPick?.model;
  const effectiveProvider = pinnedProvider || (pinnedModel ? engineForModel(pinnedModel) : autoPick?.provider);

  if (d.enhance === undefined) {
    return {
      genPrompt: d.prompt,
      negativePrompt: d.negativePrompt,
      enhancedPrompt: d.enhancedPrompt || null,
      effectiveModel,
      effectiveProvider,
    };
  }
  const prompt: string = d.originalPrompt || d.prompt;
  const stylePack = getStylePack(d.stylePackId);
  let enhancedPrompt: string | null = null;
  let autoNegative: string | undefined;
  if (d.enhance !== false) {
    updateJob(j.id, { progress: 5 });
    try {
      const e = await enhanceCreativePrompt({
        prompt, mode: videoMode, engine: effectiveProvider, model: effectiveModel, depth: d.depth,
        clientId: d.clientId || undefined, orgId: d.orgId, userId: d.userId ?? undefined,
        useBrandKit: Boolean(d.useBrandKit),
        safeZone: Boolean(d.safeZone), hasRefs,
        refImageBase64: d.imageBase64 || d.startImageBase64 || undefined,
        refImageMime: (d.imageBase64 ? d.mimeType : d.startMimeType) || 'image/png',
        stylePack,
      });
      if (e.prompt && e.prompt.trim() && e.prompt.trim() !== prompt) enhancedPrompt = e.prompt.trim();
      autoNegative = e.negativePrompt;
    } catch (e) {
      console.warn(`[creative-video] prompt-enhancer failed, using raw prompt: ${errMessage(e)}`);
    }
  }
  const packTail = stylePack && !enhancedPrompt ? ` Style & ambiance: ${stylePack.video}` : '';
  if (stylePack && !enhancedPrompt && !autoNegative) autoNegative = stylePack.negative;
  const genPrompt = (enhancedPrompt ?? (d.safeZone ? `${prompt}\n\n${SAFE_ZONE_HINT}` : prompt)) + packTail;
  const negativePrompt = [autoNegative, typeof d.userNegative === 'string' ? d.userNegative : '']
    .filter((sv) => sv && sv.trim()).join(', ').slice(0, 500) || undefined;
  return { genPrompt, negativePrompt, enhancedPrompt, effectiveModel, effectiveProvider };
}

export async function creativeVideoWorker(j: Job): Promise<any> {
  const m: string = j.data.model || '';
  const expectedSec = (!m || /wan|happyhorse|vidu/i.test(m)) ? 170
    : /omni/i.test(m) ? 55
    : /seedance/i.test(m) ? 95
    : /minimax|hailuo/i.test(m) ? 95
    : /grok/i.test(m) ? 110
    : 80;
  const stepPct = 85 / (expectedSec / 3); // 10% -> 95% across expectedSec
  let p = 10;
  const ticker = setInterval(() => {
    p = Math.min(p + stepPct, 95);
    updateJob(j.id, { progress: Math.round(p * 10) / 10 });
  }, 3000);
  try {
    const { genPrompt, negativePrompt, enhancedPrompt, effectiveModel, effectiveProvider } = await prepareVideoPrompt(j);
    // 720p unless the job asked for 1080p (the route already defaults it).
    const effectiveRes = j.data.resolution || '720p';
    const result = await aiRouter.video(
      {
        prompt: genPrompt,
        aspectRatio: j.data.aspectRatio,
        durationSeconds: j.data.durationSeconds,
        resolution: effectiveRes,
        imageBase64: j.data.imageBase64,
        mimeType: j.data.mimeType,
        startImageBase64: j.data.startImageBase64,
        startMimeType: j.data.startMimeType,
        endImageBase64: j.data.endImageBase64,
        endMimeType: j.data.endMimeType,
        tier: j.data.tier,
        fast: j.data.tier === 'draft',
        negativePrompt,
        referenceImages: j.data.referenceImages,
        model: effectiveModel,
      },
      {
        orgId: j.data.orgId, userId: j.data.userId, jobId: j.id, clientId: j.data.clientId,
        skipBrandKit: true,
        ...(effectiveProvider ? { preferredProvider: effectiveProvider } : {}),
      },
    );
    const generationId = await historyService.record({
      orgId: j.data.orgId,
      userId: j.data.userId,
      clientId: j.data.clientId || undefined,
      type: 'video',
      surface: 'creative_tools',
      prompt: genPrompt,
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
        enhancedPrompt,
      },
    });
    return {
      provider: result.provider, model: result.model,
      latencyMs: result.latencyMs, fallbackUsed: result.fallbackUsed,
      url: result.output.url,
      enhancedPrompt,
      generationId,
    };
  } catch (err) {
    await historyService.record({
      orgId: j.data.orgId,
      userId: j.data.userId,
      clientId: j.data.clientId || undefined,
      type: 'video',
      surface: 'creative_tools',
      prompt: j.data.prompt,
      status: 'failed',
      error: errMessage(err, 'unknown'),
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
}
