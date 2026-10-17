// Creative-video job worker. Extracted from the inline closure in
// routes/creative.ts so the durable BullMQ queue can register it AT BOOT and
// resume any waiting video jobs after a restart — and so it reads owner/context
// exclusively from job.data (never a request closure), which is required for
// correct dispatch under concurrency + restarts.
import { aiRouter } from '../services/providers/ai-router.js';
import { historyService } from '../services/history.service.js';
import { errMessage } from '../services/providers/errors.js';
import { updateJob, type Job } from './queue.js';
import { enhanceCreativePrompt, SAFE_ZONE_HINT } from '../services/prompt-enhancer.service.js';
import { getStylePack } from '../services/style-packs.js';

// Builds the prompt the engine will see. Runs here (not in the HTTP route)
// since 2026-10-17 so the POST answers at once. Older queued jobs carry a
// pre-enhanced prompt and no `enhance` flag; they pass through unchanged.
async function prepareVideoPrompt(j: Job): Promise<{ genPrompt: string; negativePrompt?: string; enhancedPrompt: string | null }> {
  const d = j.data;
  if (d.enhance === undefined) {
    return { genPrompt: d.prompt, negativePrompt: d.negativePrompt, enhancedPrompt: d.enhancedPrompt || null };
  }
  const prompt: string = d.originalPrompt || d.prompt;
  const stylePack = getStylePack(d.stylePackId);
  const videoMode = d.imageBase64 || d.startImageBase64 ? 'image-to-video' : 'text-to-video';
  const hasRefs = Array.isArray(d.referenceImages) && d.referenceImages.length > 0;
  const model: string | undefined = d.model;
  // Enhancer dialect follows the router's dispatch: grok→xai, veo/omni→gemini,
  // wan/happyhorse and Auto→dashscope (the video primary).
  const engine = model && /grok/i.test(model) ? ('xai' as const)
    : model && /veo|omni|gemini/i.test(model) ? ('gemini' as const)
    : ('dashscope' as const);
  let enhancedPrompt: string | null = null;
  let autoNegative: string | undefined;
  if (d.enhance !== false) {
    updateJob(j.id, { progress: 5 });
    try {
      const e = await enhanceCreativePrompt({
        prompt, mode: videoMode, engine, model, depth: d.depth,
        clientId: d.clientId || undefined, orgId: d.orgId, userId: d.userId ?? undefined,
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
  return { genPrompt, negativePrompt, enhancedPrompt };
}

export async function creativeVideoWorker(j: Job): Promise<any> {
  // Pace the progress bar to the engine's REAL latency (measured live
  // 2026-07-03): omni ~55s, veo ~80s, grok draft ~110s, wan ~170s. Creeps to
  // 95% so there's always visible motion until real completion.
  const m: string = j.data.model || '';
  // Auto (no model) now lands on wan3.0-video first, so it paces like Wan.
  const expectedSec = (!m || /wan|happyhorse/i.test(m)) ? 170
    : /omni/i.test(m) ? 55
    : /grok/i.test(m) ? 110
    : 80;
  const stepPct = 85 / (expectedSec / 3); // 10% → 95% across expectedSec
  let p = 10;
  const ticker = setInterval(() => {
    p = Math.min(p + stepPct, 95);
    updateJob(j.id, { progress: Math.round(p * 10) / 10 });
  }, 3000);
  try {
    const { genPrompt, negativePrompt, enhancedPrompt } = await prepareVideoPrompt(j);
    const result = await aiRouter.video(
      {
        prompt: genPrompt,
        aspectRatio: j.data.aspectRatio,
        durationSeconds: j.data.durationSeconds,
        resolution: j.data.resolution,
        imageBase64: j.data.imageBase64,
        mimeType: j.data.mimeType,
        startImageBase64: j.data.startImageBase64,
        startMimeType: j.data.startMimeType,
        endImageBase64: j.data.endImageBase64,
        endMimeType: j.data.endMimeType,
        tier: j.data.tier,
        fast: true,
        negativePrompt,
        referenceImages: j.data.referenceImages,
        model: j.data.model,
      },
      // Engine pins: Omni lives on Gemini, Wan on DashScope.
      {
        orgId: j.data.orgId, userId: j.data.userId, jobId: j.id, clientId: j.data.clientId,
        // Explicit engine → provider. Each picked video engine deterministically
        // pins its provider (Veo/Omni→gemini, Grok→xai, Wan→dashscope) so the
        // user's choice is honoured regardless of tier.
        ...(j.data.model && /veo|omni|imagen|gemini/i.test(j.data.model) ? { preferredProvider: 'gemini' as const }
          : j.data.model && /grok/i.test(j.data.model) ? { preferredProvider: 'xai' as const }
          : j.data.model && /wan|qwen|happyhorse/i.test(j.data.model) ? { preferredProvider: 'dashscope' as const } : {}),
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
