import { defineTool } from '../tool-types.js';
import { scopedClientId } from './client-scope.js';
import { aiRouter } from '../../services/providers/ai-router.js';
import { storageService } from '../../services/storage.service.js';
import { historyService } from '../../services/history.service.js';
import { enhanceCreativePrompt, engineForModel, selectBestCreativeEngine } from '../../services/prompt-enhancer.service.js';

type AspectRatio = '1:1' | '4:5' | '9:16' | '16:9';

interface Args {
  prompt: string;
  platform?: string;
  aspectRatio?: AspectRatio;
  quality?: 'standard' | 'ultra';
  model?: string;
  name?: string;
  tags?: string[];
  useBrandKit?: boolean;
  clientId?: string;
}

interface Result {
  assetId: string;
  url: string;
  width: number | null;
  height: number | null;
}

const DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '4:5': { width: 1024, height: 1280 },
  '9:16': { width: 1024, height: 1820 },
  '16:9': { width: 1820, height: 1024 },
};

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) {
    const err = new Error('AbortError: image_generate cancelled');
    err.name = 'AbortError';
    throw err;
  }
}

async function downloadUrl(url: string, signal: AbortSignal): Promise<Buffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Image download failed: ${res.status} ${res.statusText}`);
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

function sniffMime(buf: Buffer): 'image/png' | 'image/jpeg' {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  return 'image/jpeg';
}

export const tool = defineTool<Args, Result>({
  name: 'image_generate',
  description:
    'Generate ONE standalone studio-grade image frame via AURA Creative Router (Gemini 3 Pro Image, Nano Banana 2.1, ByteDance Dola Seedream 5.5 RGBA & Seedream 5.0 4K, MiniMax H3-Image 4K, Qwen Image 3.0 Pro, Wan 2.7 Image Pro, Grok Imagine 2.0). ' +
    'Automatically enhances the prompt via Gemini 4 Carbon and selects the optimal engine unless model is specified. ' +
    'For multi-slide carousels, call image_generate ONCE PER SLIDE (e.g. aspectRatio="4:5", name="Slide 01 - Cover") describing only that single slide. ' +
    'Saves to /uploads/, creates an Asset row when a client is active, and emits an agent:artifact preview.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Single-frame image description or creative brief (include exact copy in double quotes and #HEX palette if needed)' },
      platform: {
        type: 'string',
        description: 'Target platform (instagram, tiktok, linkedin, ...) - used for tagging',
      },
      aspectRatio: {
        type: 'string',
        enum: ['1:1', '4:5', '9:16', '16:9'],
        description: 'Defaults to 1:1 (use 4:5 for Instagram feed/carousel slides, 9:16 for Stories/Reels)',
      },
      quality: {
        type: 'string',
        enum: ['standard', 'ultra'],
        description: 'Ultra renders high-resolution 2K/4K output',
      },
      model: {
        type: 'string',
        description: 'Optional engine override (gemini-3-pro-image, gemini-nano-banana-2.1, dola-seedream-5-5-261028, seedream-5-0-260128, MiniMax-H3-Image, qwen-image-3.0-pro, wan2.7-image-pro, grok-imagine-image-2.0)',
      },
      name: {
        type: 'string',
        description: 'Optional clear asset name in the Gallery (e.g. "Carousel Slide 01 - Cover")',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional Gallery tags (e.g. ["carousel", "slide-01"])',
      },
      useBrandKit: {
        type: 'boolean',
        description: 'Weave active client Brand Kit palette and tone into prompt enhancement',
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
    checkAbort(ctx.signal);

    const clientId = await scopedClientId(ctx, args.clientId);
    const aspectRatio: AspectRatio = args.aspectRatio || '1:1';
    const { width, height } = DIMENSIONS[aspectRatio];

    const pinnedModel = typeof args.model === 'string' && args.model.trim() ? args.model.trim() : undefined;
    const autoPick = !pinnedModel ? selectBestCreativeEngine('text-to-image', args.prompt, { quality: args.quality }) : null;
    const effectiveModel = pinnedModel || autoPick!.model;
    const effectiveProvider = pinnedModel ? engineForModel(pinnedModel) : autoPick!.provider;

    let genPrompt = args.prompt;
    try {
      const e = await enhanceCreativePrompt({
        prompt: args.prompt,
        mode: 'text-to-image',
        engine: effectiveProvider,
        model: effectiveModel,
        orgId: ctx.orgId,
        userId: ctx.userId ?? undefined,
        clientId,
        useBrandKit: Boolean(args.useBrandKit),
      });
      if (e.prompt && e.prompt.trim()) genPrompt = e.prompt.trim();
    } catch {
      // Fall back to raw prompt if enhancement fails.
    }

    await ctx.emit('agent:thought', {
      text: `AURA Image Director -> ${effectiveProvider}/${effectiveModel} (${aspectRatio}, 2K): ${args.prompt.slice(0, 110)}`,
      at: new Date().toISOString(),
    });

    const result = await aiRouter.image(
      {
        prompt: genPrompt,
        aspectRatio,
        quality: args.quality,
        model: effectiveModel,
        imageSize: '2K',
        n: 1,
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
    checkAbort(ctx.signal);

    // Resolve to a Buffer regardless of whether provider returned URL or base64.
    let buffer: Buffer;
    if (result.output.base64) {
      buffer = Buffer.from(result.output.base64, 'base64');
    } else if (result.output.url) {
      buffer = await downloadUrl(result.output.url, ctx.signal);
    } else {
      throw new Error('image_generate: provider returned neither url nor base64');
    }
    checkAbort(ctx.signal);

    const mimeType = sniffMime(buffer);
    const ext = mimeType === 'image/png' ? '.png' : '.jpg';
    const namePrefix = args.prompt.replace(/[^a-z0-9]+/gi, '-').slice(0, 40) || 'image';
    const { fileUrl, thumbUrl } = await storageService.saveFile(
      buffer,
      `${namePrefix}${ext}`,
      mimeType,
    );

    // Best-effort dimension detection via sharp; non-fatal.
    let actualWidth: number | null = width;
    let actualHeight: number | null = height;
    try {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(buffer).metadata();
      if (meta.width) actualWidth = meta.width;
      if (meta.height) actualHeight = meta.height;
    } catch {
      // keep aspect-ratio-derived defaults
    }

    const mergedTags = Array.from(new Set([
      ...(args.platform ? [args.platform] : []),
      ...(Array.isArray(args.tags) ? args.tags : []),
    ]));

    const asset = clientId
      ? await ctx.prisma.asset.create({
          data: {
            orgId: ctx.orgId,
            clientId,
            name: (args.name || args.prompt).slice(0, 60),
            fileUrl,
            thumbUrl,
            mimeType,
            width: actualWidth,
            height: actualHeight,
            safeForClient: true,
            analysis: {
              provider: result.provider,
              model: result.model,
              latencyMs: result.latencyMs,
              fallbackUsed: result.fallbackUsed,
              platform: args.platform || null,
              aspectRatio,
              quality: args.quality || 'standard',
            },
            tags: mergedTags,
          },
        })
      : null;

    await historyService.record({
      orgId: ctx.orgId,
      userId: ctx.userId ?? undefined,
      clientId,
      type: 'image',
      surface: 'agent',
      prompt: args.prompt,
      outputUrl: fileUrl,
      thumbnailUrl: thumbUrl || fileUrl,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      metadata: { aspectRatio, quality: args.quality || 'standard', mode: 'text-to-image', assetId: asset?.id || null, enhancedPrompt: genPrompt, sessionUid: ctx.sessionUid },
    });

    await ctx.emit('agent:artifact', {
      path: fileUrl,
      mimeType,
      bytes: actualWidth * actualHeight * 3,
      preview: `${result.provider}/${result.model} ${actualWidth}x${actualHeight}${asset ? ` (asset ${asset.id})` : ''}`,
      at: new Date().toISOString(),
    });

    return {
      assetId: asset?.id ?? 'standalone',
      url: fileUrl,
      width: actualWidth,
      height: actualHeight,
    };
  },
});
