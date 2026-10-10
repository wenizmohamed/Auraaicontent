import { defineTool } from '../tool-types.js';
import { aiRouter } from '../../services/providers/ai-router.js';
import { historyService } from '../../services/history.service.js';

// Text-to-video for the agent. Until this tool existed the agent had no way to
// make a video at all, so a video request ended in a still image or a written
// description presented as the deliverable.

interface Args {
  prompt: string;
  aspectRatio?: '16:9' | '9:16';
  durationSeconds?: number;
  tier?: 'draft' | 'hd';
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
    'Generate a short video clip from a text prompt (Veo / Grok / Wan through the AURAAI router). ' +
    'Takes one to three minutes and is the most expensive tool, so call it ONLY when the user explicitly ' +
    'asked for a video, reel or clip, and only once per requested clip. Saves the clip and records it on /history.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'What happens in the clip: subject, action, setting, camera, mood' },
      aspectRatio: { type: 'string', enum: ['16:9', '9:16'], description: '9:16 for reels, stories and TikTok. Defaults to 9:16' },
      durationSeconds: { type: 'integer', description: 'Clip length in seconds, 4 to 8. Defaults to 6' },
      tier: { type: 'string', enum: ['draft', 'hd'], description: 'draft is cheaper and the default; hd only when the user asks for final quality' },
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
    const durationSeconds = Math.min(Math.max(requested, 4), 8);
    const tier = args.tier === 'hd' ? 'hd' : 'draft';

    await ctx.emit('agent:thought', {
      text: `Generating a ${durationSeconds}s ${aspectRatio} video (${tier}). This takes one to three minutes…`,
      at: new Date().toISOString(),
    });

    try {
      const result = await aiRouter.video(
        { prompt: args.prompt, aspectRatio, durationSeconds, tier, fast: true },
        { orgId: ctx.orgId, userId: ctx.userId ?? undefined, clientId, jobId: ctx.sessionId },
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
