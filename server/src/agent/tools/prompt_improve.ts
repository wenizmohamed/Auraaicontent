import { defineTool } from '../tool-types.js';
import { scopedClientId } from './client-scope.js';
import {
  enhanceCreativePrompt,
  enhanceCreativeVariants,
  engineForModel,
  type EnhanceDepth,
  type EnhanceMode,
} from '../../services/prompt-enhancer.service.js';
import { historyService } from '../../services/history.service.js';
import { directEngine } from '../../services/engine-director.service.js';

interface Args {
  prompt: string;
  mode?: EnhanceMode;
  model?: string;
  depth?: EnhanceDepth;
  variants?: boolean;
  useBrandKit?: boolean;
  clientId?: string;
}

interface Result {
  original: string;
  improved: string;
  negativePrompt: string | null;
  variants?: Array<{ label: string; prompt: string; negativePrompt?: string }>;
  targetEngine: { provider: string; model: string };
  rewriterProvider: string;
  rewriterModel: string;
}

export const tool = defineTool<Args, Result>({
  name: 'prompt_improve',
  description:
    'Rewrite or expand a creative idea into a studio-grade image, edit, or video prompt using AURA Creative Director. ' +
    'Automatically matches the dialect of the target engine (Nano Banana Pro, Nano Banana 2.1, MiniMax H3-Image 4K, Qwen Image 3.0 Pro, Wan 2.7 Image Pro, Wan 3.0 Prime, MiniMax H3 2K, Omni 1.2, Grok). ' +
    'Set variants=true when the user asks for 3 creative prompt options without generating media yet.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Raw creative concept, shorthand brief, or draft prompt to improve' },
      mode: {
        type: 'string',
        enum: ['text-to-image', 'image-edit', 'text-to-video', 'image-to-video'],
        description: 'Target creative mode. Defaults to text-to-image',
      },
      model: {
        type: 'string',
        description: 'Optional target media model id (e.g. gemini-3-pro-image, qwen-image-3.0-pro, wan3.0-video-prime, MiniMax-H3)',
      },
      depth: {
        type: 'string',
        enum: ['raw', 'low', 'medium', 'high'],
        description: 'Rewrite intensity. Defaults to medium (high for maximum art-direction detail)',
      },
      variants: {
        type: 'boolean',
        description: 'Set true to generate 3 distinct creative prompt directions instead of a single prompt',
      },
      useBrandKit: {
        type: 'boolean',
        description: 'Include active client Brand Kit palette and tone when rewriting',
      },
      clientId: {
        type: 'string',
        description: 'Override active client; falls back to session clientId',
      },
    },
    required: ['prompt'],
    additionalProperties: false,
  },

  async handler(args, ctx) {
    if (ctx.signal.aborted) throw new Error('prompt_improve aborted');

    const clientId = await scopedClientId(ctx, args.clientId);
    const mode: EnhanceMode = args.mode || 'text-to-image';
    const pinnedModel = typeof args.model === 'string' && args.model.trim() ? args.model.trim() : undefined;
    const autoPick = !pinnedModel
      ? await directEngine({ mode, prompt: args.prompt, orgId: ctx.orgId, userId: ctx.userId ?? undefined, clientId })
      : null;
    const targetModel = pinnedModel || autoPick!.model;
    const targetProvider = pinnedModel ? engineForModel(pinnedModel) : autoPick!.provider;

    await ctx.emit('agent:thought', {
      text: `AURA Prompt Director -> optimizing ${mode} prompt for ${targetProvider}/${targetModel}`,
      at: new Date().toISOString(),
    });

    if (args.variants) {
      const vres = await enhanceCreativeVariants(
        {
          prompt: args.prompt,
          mode,
          engine: targetProvider,
          model: targetModel,
          depth: args.depth,
          clientId,
          orgId: ctx.orgId,
          userId: ctx.userId ?? undefined,
          useBrandKit: args.useBrandKit ?? Boolean(clientId),
        },
        3,
      );
      const best = vres.variants[0];
      await historyService.record({
        orgId: ctx.orgId,
        userId: ctx.userId ?? undefined,
        clientId,
        type: 'text',
        surface: 'agent',
        prompt: `[prompt_improve:${mode}] ${args.prompt}`,
        outputText: vres.variants.map((v, i) => `[${i + 1}] ${v.label}: ${v.prompt}`).join('\n\n'),
        provider: vres.provider,
        model: vres.model,
        latencyMs: vres.latencyMs,
        metadata: { mode, targetModel, variantCount: vres.variants.length, sessionUid: ctx.sessionUid },
      });
      return {
        original: args.prompt,
        improved: best?.prompt || args.prompt,
        negativePrompt: best?.negativePrompt || null,
        variants: vres.variants,
        targetEngine: { provider: targetProvider, model: targetModel },
        rewriterProvider: vres.provider,
        rewriterModel: vres.model,
      };
    }

    const res = await enhanceCreativePrompt({
      prompt: args.prompt,
      mode,
      engine: targetProvider,
      model: targetModel,
      depth: args.depth,
      clientId,
      orgId: ctx.orgId,
      userId: ctx.userId ?? undefined,
      useBrandKit: args.useBrandKit ?? Boolean(clientId),
    });

    await historyService.record({
      orgId: ctx.orgId,
      userId: ctx.userId ?? undefined,
      clientId,
      type: 'text',
      surface: 'agent',
      prompt: `[prompt_improve:${mode}] ${args.prompt}`,
      outputText: res.prompt,
      provider: res.provider,
      model: res.model,
      latencyMs: res.latencyMs,
      metadata: { mode, targetModel, negativePrompt: res.negativePrompt || null, sessionUid: ctx.sessionUid },
    });

    return {
      original: args.prompt,
      improved: res.prompt,
      negativePrompt: res.negativePrompt || null,
      targetEngine: { provider: targetProvider, model: targetModel },
      rewriterProvider: res.provider,
      rewriterModel: res.model,
    };
  },
});
