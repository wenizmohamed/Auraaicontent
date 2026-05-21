import { defineTool } from '../tool-types.js';
import { aiRouter } from '../../services/providers/ai-router.js';
import { storageService } from '../../services/storage.service.js';

type AspectRatio = '1:1' | '4:5' | '9:16' | '16:9';

interface Args {
  prompt: string;
  platform?: string;
  aspectRatio?: AspectRatio;
  quality?: 'standard' | 'ultra';
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
    'Generate an image via the Radix AI router (xAI / Gemini). ' +
    'Saves to uploads/, creates an Asset row tied to the active client, ' +
    'and emits an agent:artifact event so the UI previews it inline.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Image description' },
      platform: {
        type: 'string',
        description: 'Target platform (instagram, tiktok, linkedin, ...) — used for tagging',
      },
      aspectRatio: {
        type: 'string',
        enum: ['1:1', '4:5', '9:16', '16:9'],
        description: 'Defaults to 1:1',
      },
      quality: {
        type: 'string',
        enum: ['standard', 'ultra'],
        description: 'Ultra routes to imagen-4.0-ultra on Gemini',
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

    const clientId = args.clientId || ctx.clientId;
    if (!clientId) {
      throw new Error(
        'image_generate requires clientId (none on session — call client_switch first).',
      );
    }

    const aspectRatio: AspectRatio = args.aspectRatio || '1:1';
    const { width, height } = DIMENSIONS[aspectRatio];

    await ctx.emit('agent:thought', {
      text: `Generating image… (${aspectRatio}, ${args.quality || 'standard'}) — ${args.prompt.slice(0, 120)}`,
      at: new Date().toISOString(),
    });

    const result = await aiRouter.image(
      {
        prompt: args.prompt,
        aspectRatio,
        quality: args.quality,
        n: 1,
      },
      { orgId: ctx.orgId, userId: ctx.userId ?? undefined, clientId, jobId: ctx.sessionId },
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

    const asset = await ctx.prisma.asset.create({
      data: {
        orgId: ctx.orgId,
        clientId,
        name: args.prompt.slice(0, 60),
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
        tags: args.platform ? [args.platform] : [],
      },
    });

    await ctx.emit('agent:artifact', {
      path: fileUrl,
      mimeType,
      bytes: actualWidth * actualHeight * 3,
      preview: `${result.provider}/${result.model} ${actualWidth}×${actualHeight} (asset ${asset.id})`,
      at: new Date().toISOString(),
    });

    return {
      assetId: asset.id,
      url: fileUrl,
      width: actualWidth,
      height: actualHeight,
    };
  },
});
