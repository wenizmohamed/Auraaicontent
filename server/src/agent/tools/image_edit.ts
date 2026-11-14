import fs from 'fs';
import { defineTool } from '../tool-types.js';
import { scopedClientId } from './client-scope.js';
import { safeFetch, UnsafeUrlError } from '../../lib/safe-fetch.js';
import { aiRouter } from '../../services/providers/ai-router.js';
import { storageService } from '../../services/storage.service.js';
import { historyService } from '../../services/history.service.js';
import { enhanceCreativePrompt, engineForModel, selectBestCreativeEngine } from '../../services/prompt-enhancer.service.js';

type AspectRatio = '1:1' | '4:5' | '9:16' | '16:9';

interface Args {
  prompt: string;
  assetId?: string;
  sourceUrl?: string;
  referenceAssetIds?: string[];
  aspectRatio?: AspectRatio;
  model?: string;
  name?: string;
  clientId?: string;
}

interface Result {
  assetId: string;
  url: string;
  width: number | null;
  height: number | null;
  provider: string;
  model: string;
}

function sniffMime(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return 'image/jpeg';
}

async function readImageBytes(urlOrPath: string, signal: AbortSignal): Promise<{ buffer: Buffer; mimeType: string }> {
  const localAbs = storageService.resolveUploadPath(urlOrPath);
  if (localAbs && fs.existsSync(localAbs)) {
    const buffer = fs.readFileSync(localAbs);
    return { buffer, mimeType: sniffMime(buffer) };
  }
  // The URL comes from the model, so it goes through the SSRF guard: public
  // addresses only (checked at connect time), redirects re-checked, 20 MB cap.
  let res;
  try {
    res = await safeFetch(urlOrPath, { signal, accept: 'image/*', maxBytes: 20 * 1024 * 1024 });
  } catch (e) {
    if (e instanceof UnsafeUrlError) {
      throw new Error('image_edit: sourceUrl must be a saved /uploads/ file or a public https image URL');
    }
    throw e;
  }
  if (res.status < 200 || res.status >= 300) throw new Error(`image_edit: failed to download source image (${res.status})`);
  if (!res.contentType.startsWith('image/')) throw new Error('image_edit: sourceUrl did not return an image');
  return { buffer: res.body, mimeType: sniffMime(res.body) };
}

export const tool = defineTool<Args, Result>({
  name: 'image_edit',
  description:
    'Edit, retouch, restyle, or composite an existing gallery image via AURA Creative Router (Gemini 3 Pro Image, Nano Banana 2.1, ByteDance Dola Seedream 5.5 & Seedream 5.0 4K, Qwen Image 3.0 Pro, MiniMax H3-Image 4K, Wan 2.7 Image Pro). ' +
    'Pass assetId from asset_search or a previous image_generate call (or sourceUrl), plus optional referenceAssetIds for multi-image character or product consistency. ' +
    'Saves the edited image to /uploads/, creates an Asset row when a client is active, and emits an agent:artifact preview.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Exact visual edit instruction: what to change and what to keep identical' },
      assetId: { type: 'string', description: 'Gallery Asset id to edit (preferred; get ids from asset_search or earlier image_generate)' },
      sourceUrl: { type: 'string', description: 'Fallback /uploads/... path or public image URL when no assetId is available' },
      referenceAssetIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional extra Asset ids (up to 6) for product, style, or mascot consistency',
      },
      aspectRatio: {
        type: 'string',
        enum: ['1:1', '4:5', '9:16', '16:9'],
        description: 'Optional target aspect ratio',
      },
      model: {
        type: 'string',
        description: 'Optional engine override (gemini-3-pro-image, gemini-nano-banana-2.1, dola-seedream-5-5-261028, seedream-5-0-260128, qwen-image-3.0-pro, MiniMax-H3-Image, wan2.7-image-pro)',
      },
      name: {
        type: 'string',
        description: 'Optional descriptive title for the saved gallery asset',
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
    if (ctx.signal.aborted) throw new Error('image_edit aborted');

    const clientId = await scopedClientId(ctx, args.clientId);
    let resolvedUrl = args.sourceUrl?.trim() || '';

    if (args.assetId) {
      const found = await ctx.prisma.asset.findFirst({
        where: { id: args.assetId, orgId: ctx.orgId },
        select: { fileUrl: true },
      });
      if (!found) throw new Error(`image_edit: asset "${args.assetId}" not found in this workspace`);
      resolvedUrl = found.fileUrl;
    }

    if (!resolvedUrl && clientId) {
      const latestAsset = await ctx.prisma.asset.findFirst({
        where: { orgId: ctx.orgId, clientId, mimeType: { startsWith: 'image/' } },
        orderBy: { createdAt: 'desc' },
        select: { fileUrl: true },
      });
      if (latestAsset) resolvedUrl = latestAsset.fileUrl;
    }

    if (!resolvedUrl) {
      throw new Error('image_edit requires assetId or sourceUrl (call asset_search first to find the image id)');
    }

    const baseImg = await readImageBytes(resolvedUrl, ctx.signal);
    const refs: Array<{ base64: string; mimeType: string }> = [];
    if (Array.isArray(args.referenceAssetIds) && args.referenceAssetIds.length > 0) {
      const refAssets = await ctx.prisma.asset.findMany({
        where: { id: { in: args.referenceAssetIds.slice(0, 6) }, orgId: ctx.orgId },
        select: { fileUrl: true },
      });
      for (const ra of refAssets) {
        try {
          const loaded = await readImageBytes(ra.fileUrl, ctx.signal);
          refs.push({ base64: loaded.buffer.toString('base64'), mimeType: loaded.mimeType });
        } catch {
          // Skip unreadable optional ref
        }
      }
    }

    const pinnedModel = typeof args.model === 'string' && args.model.trim() ? args.model.trim() : undefined;
    const autoPick = !pinnedModel ? selectBestCreativeEngine('image-edit', args.prompt, { hasRefs: refs.length > 0 }) : null;
    const effectiveModel = pinnedModel || autoPick!.model;
    const effectiveProvider = pinnedModel ? engineForModel(pinnedModel) : autoPick!.provider;

    const imageBase64 = baseImg.buffer.toString('base64');
    let genPrompt = args.prompt;
    try {
      const e = await enhanceCreativePrompt({
        prompt: args.prompt,
        mode: 'image-edit',
        engine: effectiveProvider,
        model: effectiveModel,
        orgId: ctx.orgId,
        userId: ctx.userId ?? undefined,
        clientId,
        hasRefs: refs.length > 0,
        refImageBase64: imageBase64,
        refImageMime: baseImg.mimeType,
      });
      if (e.prompt && e.prompt.trim()) genPrompt = e.prompt.trim();
    } catch {
      // Keep raw edit prompt if enhancer fails
    }

    await ctx.emit('agent:thought', {
      text: `AURA Image Retoucher -> ${effectiveProvider}/${effectiveModel}: ${args.prompt.slice(0, 110)}`,
      at: new Date().toISOString(),
    });

    const result = await aiRouter.image(
      {
        prompt: genPrompt,
        imageBase64,
        mimeType: baseImg.mimeType,
        aspectRatio: args.aspectRatio,
        model: effectiveModel,
        referenceImages: refs.length > 0 ? refs : undefined,
        imageSize: '2K',
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

    let outBuf: Buffer;
    if (result.output.base64) {
      outBuf = Buffer.from(result.output.base64, 'base64');
    } else if (result.output.url) {
      const fetched = await readImageBytes(result.output.url, ctx.signal);
      outBuf = fetched.buffer;
    } else {
      throw new Error('image_edit: provider returned neither base64 nor url');
    }

    const outMime = sniffMime(outBuf);
    const ext = outMime === 'image/png' ? '.png' : outMime === 'image/webp' ? '.webp' : '.jpg';
    const slug = (args.name || args.prompt).replace(/[^a-z0-9]+/gi, '-').slice(0, 40) || 'edited-image';
    const { fileUrl, thumbUrl } = await storageService.saveFile(outBuf, `${slug}${ext}`, outMime);

    let actualWidth: number | null = null;
    let actualHeight: number | null = null;
    try {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(outBuf).metadata();
      if (meta.width) actualWidth = meta.width;
      if (meta.height) actualHeight = meta.height;
    } catch {
      // Optional dimensions
    }

    const asset = clientId
      ? await ctx.prisma.asset.create({
          data: {
            orgId: ctx.orgId,
            clientId,
            name: (args.name || `Edited: ${args.prompt}`).slice(0, 60),
            fileUrl,
            thumbUrl,
            mimeType: outMime,
            width: actualWidth,
            height: actualHeight,
            safeForClient: true,
            analysis: {
              provider: result.provider,
              model: result.model,
              latencyMs: result.latencyMs,
              fallbackUsed: result.fallbackUsed,
              mode: 'image-edit',
            },
            tags: ['ai-edited'],
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
      metadata: { mode: 'image-edit', assetId: asset?.id || null, enhancedPrompt: genPrompt, sessionUid: ctx.sessionUid },
    });

    await ctx.emit('agent:artifact', {
      path: fileUrl,
      mimeType: outMime,
      bytes: outBuf.length,
      preview: `${result.provider}/${result.model}${actualWidth && actualHeight ? ` ${actualWidth}x${actualHeight}` : ''}`,
      at: new Date().toISOString(),
    });

    return {
      assetId: asset?.id ?? 'standalone',
      url: fileUrl,
      width: actualWidth,
      height: actualHeight,
      provider: result.provider,
      model: result.model,
    };
  },
});
