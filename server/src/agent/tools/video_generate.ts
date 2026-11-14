import { defineTool } from '../tool-types.js';
import { scopedClientId } from './client-scope.js';
import { aiRouter } from '../../services/providers/ai-router.js';
import { historyService } from '../../services/history.service.js';
import { enhanceCreativePrompt, engineForModel } from '../../services/prompt-enhancer.service.js';
import { directEngine } from '../../services/engine-director.service.js';

interface Args {
  prompt: string;
  aspectRatio?: '16:9' | '9:16';
  durationSeconds?: number;
  tier?: 'draft' | 'hd';
  resolution?: '720p' | '1080p';
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
    'Generate a cinema-grade video clip via AURA Creative Router (Dreamina Seedance 2.5 & 2.0 with native audio, Wan 3.0 Prime with native audio, MiniMax H3 2K cinema with stereo audio, Omni 1.2 Flash, Grok Imagine Video 1.5, HappyHorse 1.1). ' +
    'AURA rewrites the prompt for the engine and selects the best engine unless model is specified. ' +
    'Call ONLY when the user explicitly asked for a video, reel, or clip.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'What happens in the clip: subject, action, setting, camera, mood, audio' },
      aspectRatio: { type: 'string', enum: ['16:9', '9:16'], description: '9:16 for reels, stories and TikTok; 16:9 for landscape. Defaults to 9:16' },
      durationSeconds: { type: 'integer', description: 'Clip length in seconds, 4 to 30 (up to 30s on Seedance 2.5 and Wan 3.0, up to 15s on Seedance 2.0 and MiniMax H3). Defaults to 6' },
      tier: { type: 'string', enum: ['draft', 'hd'], description: 'Which engine class: hd (the default) uses the flagship engines, draft a fast engine for a quick preview. It does not set the resolution' },
      resolution: { type: 'string', enum: ['720p', '1080p'], description: 'Defaults to 720p. Use 1080p only when the user asks for 1080p, Full HD or final quality: it costs about twice as much per second' },
      model: { type: 'string', description: 'Optional engine override (dreamina-seedance-2-5-260628, dreamina-seedance-2-0-260128, wan3.0-video-prime, MiniMax-H3, MiniMax-H3-Max, gemini-omni-1.2-flash, grok-imagine-video-1.5, happyhorse-1.1-t2v)' },
      clientId: { type: 'string', description: 'Override active client; falls back to session clientId' },
    },
    required: ['prompt'],
    additionalProperties: false,
  },

  async handler(args, ctx) {
    if (ctx.signal.aborted) throw new Error('video_generate aborted');

    const clientId = await scopedClientId(ctx, args.clientId);
    const aspectRatio = args.aspectRatio === '16:9' ? '16:9' : '9:16';
    const pinnedModel = typeof args.model === 'string' && args.model.trim() ? args.model.trim() : undefined;
    const requested = typeof args.durationSeconds === 'number' ? Math.round(args.durationSeconds) : 6;
    const tier = args.tier === 'draft' ? 'draft' : 'hd';
    // 720p unless the user asked for 1080p (Weni 2026-11-14).
    const resolution: '720p' | '1080p' = args.resolution === '1080p' ? '1080p' : '720p';
    const autoPick = !pinnedModel
      ? await directEngine({ mode: 'text-to-video', prompt: args.prompt, fast: tier === 'draft', durationSeconds: requested, resolution, orgId: ctx.orgId, userId: ctx.userId ?? undefined, clientId })
      : null;
    const effectiveModel = pinnedModel || autoPick!.model;
    const maxAllowedDur = /seedance-2-5|wan3/i.test(effectiveModel) ? 30 : 15;
    const durationSeconds = Math.min(Math.max(requested, 4), maxAllowedDur);
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
      text: `AURA Video Director -> ${effectiveProvider}/${effectiveModel} (${durationSeconds}s ${aspectRatio}, ${resolution})...`,
      at: new Date().toISOString(),
    });

    try {
      const result = await aiRouter.video(
        {
          prompt: genPrompt,
          aspectRatio,
          durationSeconds,
          resolution,
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
