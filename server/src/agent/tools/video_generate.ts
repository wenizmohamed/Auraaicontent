import { defineTool } from '../tool-types.js';
import { aiRouter } from '../../services/providers/ai-router.js';
import { historyService } from '../../services/history.service.js';
import { enhanceCreativePrompt, engineForModel, selectBestCreativeEngine } from '../../services/prompt-enhancer.service.js';

interface Args {
  prompt: string;
  aspectRatio?: '16:9' | '9:16';
  durationSeconds?: number;
  tier?: 'draft' | 'hd';
  model?: string;
  clientId?: string;
}

interface Result {
  url: string;
  generationId: string | null;
  provider: string;
  model: string;
  durationSeconds: number;
  aspectRatio: '16:9' | '9:16';
  note: string;
}

export const tool = defineTool<Args, Result>({
  name: 'video_generate',
  description:
    'Generate a cinema-grade video clip via AURA Creative Router (ByteDance Dreamina Seedance 2.5 & 2.0 with native audio, Wan 3.0 Prime with native audio, MiniMax H3 2K cinema with stereo audio, Gemini Omni 1.2 Flash Video, Grok Imagine Video 1.5, HappyHorse 1.1). ' +
    'Automatically enhances cinematography via Gemini 4 Carbon and selects the best engine unless model is specified. ' +
    'Call ONLY when the user explicitly asked for a video, reel, or clip.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'What happens in the clip: subject, action, setting, camera, mood, audio' },
      aspectRatio: { type: 'string', enum: ['16:9', '9:16'], description: '9:16 for reels, stories and TikTok; 16:9 for landscape. Defaults to 9:16' },
      durationSeconds: { type: 'integer', description: 'Clip length in seconds, 4 to 15. Defaults to 6' },
      tier: { type: 'string', enum: ['draft', 'hd'], description: 'Defaults to hd (1080p/2K flagship); use draft only when the user asks for a fast preview' },
      model: { type: 'string', description: 'Optional engine override (dreamina-seedance-2-5-260628, dreamina-seedance-2-0-260128, wan3.0-video-prime, MiniMax-H3, MiniMax-H3-Max, gemini-omni-1.2-flash, grok-imagine-video-1.5, happyhorse-1.1-t2v)' },
      clientId: { type: 'string', description: 'Override active client; falls back to session clientId' },
    },
    required: ['prompt'],
    additionalProperties: false,
  },

  async handler(args, ctx) {
    if (ctx.signal.aborted) throw new Error('video_generate aborted');

    const clientId = args.clientId || ctx.clientId || undefined;
    const aspectRatio = args.aspectRatio === '16:9' ? '16:9' : '9:16';
    const requested = typeof args.durationSeconds === 'number' ? Math.round(args.durationSeconds) : 6;
    const durationSeconds = Math.min(Math.max(requested, 4), 15);
    const tier = args.tier === 'draft' ? 'draft' : 'hd';
    const pinnedModel = typeof args.model === 'string' && args.model.trim() ? args.model.trim() : undefined;
    const autoPick = !pinnedModel ? selectBestCreativeEngine('text-to-video', args.prompt, { fast: tier === 'draft' }) : null;
    const effectiveModel = pinnedModel || autoPick!.model;
    const effectiveProvider = pinnedModel ? engineForModel(pinnedModel) : autoPick!.provider;

    let genPrompt = args.prompt;
    let negativePrompt: string | undefined;
    try {
      const e = await enhanceCreativePrompt({
        prompt: args.prompt,
        mode: 'text-to-video',
        engine: effectiveProvider,
        model: effectiveModel,
        orgId: ctx.orgId,
        userId: ctx.userId ?? undefined,
        clientId,
        useBrandKit: false,
      });
      if (e.prompt && e.prompt.trim()) genPrompt = e.prompt.trim();
      negativePrompt = e.negativePrompt;
    } catch {
      // Fall back to raw prompt if enhancement fails.
    }

    await ctx.emit('agent:thought', {
      text: `AURA Video Director -> ${effectiveProvider}/${effectiveModel} (${durationSeconds}s ${aspectRatio}, ${tier === 'hd' ? '1080p' : '720p'})...`,
      at: new Date().toISOString(),
    });

    try {
      const result = await aiRouter.video(
        {
          prompt: genPrompt,
          aspectRatio,
          durationSeconds,
          resolution: tier === 'hd' ? '1080p' : '720p',
          tier,
          fast: tier === 'draft',
          model: effectiveModel,
          negativePrompt,
        },
        {
          orgId: ctx.orgId,
          userId: ctx.userId ?? undefined,
          clientId,
          jobId: ctx.sessionId,
          preferredProvider: effectiveProvider,
          skipBrandKit: true,
        },
      );
      const url = result.output?.url;
      if (!url) throw new Error('the video provider returned no file');

      const generationId = await historyService.record({
        orgId: ctx.orgId,
        userId: ctx.userId ?? undefined,
        clientId,
        type: 'video',
        surface: 'agent',
        prompt: args.prompt,
        outputUrl: url,
        thumbnailUrl: url,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        metadata: { aspectRatio, durationSeconds, tier, mode: 'text-to-video', sessionUid: ctx.sessionUid },
      });

      await ctx.emit('agent:artifact', {
        path: url,
        mimeType: 'video/mp4',
        preview: `${result.provider}/${result.model} ${durationSeconds}s ${aspectRatio}`,
        at: new Date().toISOString(),
      });

      return {
        url,
        generationId: generationId ?? null,
        provider: result.provider,
        model: result.model,
        durationSeconds,
        aspectRatio,
        note: 'Video generated and saved. Visible on /history.',
      };
    } catch (err) {
      await historyService.record({
        orgId: ctx.orgId,
        userId: ctx.userId ?? undefined,
        clientId,
        type: 'video',
        surface: 'agent',
        prompt: args.prompt,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        metadata: { aspectRatio, durationSeconds, tier, mode: 'text-to-video', sessionUid: ctx.sessionUid },
      });
      throw err;
    }
  },
});
