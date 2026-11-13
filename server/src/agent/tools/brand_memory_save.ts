import fs from 'fs';
import { defineTool } from '../tool-types.js';
import { recordMemory, type MemoryKind } from '../../services/memory.service.js';
import { aiRouter } from '../../services/providers/ai-router.js';
import { storageService } from '../../services/storage.service.js';

interface Args {
  note: string;
  kind?: 'preference' | 'pattern' | 'correction';
  imageUrl?: string;
  assetId?: string;
  tags?: string[];
  orgWide?: boolean;
  clientId?: string;
}

interface Result {
  saved: boolean;
  memoryId: string | null;
  savedAssetId: string | null;
  savedAssetUrl: string | null;
  visualSummary: string | null;
  note: string;
}

function isBlockedHost(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h.endsWith('.local') || h.endsWith('.internal')) return true;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return true;
    return false;
  } catch {
    return true;
  }
}

function sniffImageMime(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function extractMetaImageUrl(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      return m[1].replace(/&amp;/g, '&').trim();
    }
  }
  return null;
}

async function tryFetchVisualReference(
  imageUrl: string,
  signal: AbortSignal,
): Promise<{ buffer: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' } | null> {
  const localAbs = storageService.resolveUploadPath(imageUrl);
  if (localAbs && fs.existsSync(localAbs)) {
    const buffer = fs.readFileSync(localAbs);
    const mime = sniffImageMime(buffer);
    return mime ? { buffer, mimeType: mime } : null;
  }
  if (isBlockedHost(imageUrl)) return null;

  try {
    const res = await fetch(imageUrl, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AuraBrandBot/1.0)',
        Accept: 'image/*,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.startsWith('image/')) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const mime = sniffImageMime(buffer);
      return mime ? { buffer, mimeType: mime } : null;
    }
    if (ct.includes('text/html')) {
      const html = (await res.text()).slice(0, 250_000);
      const ogImg = extractMetaImageUrl(html);
      if (ogImg && !isBlockedHost(ogImg)) {
        const imgRes = await fetch(ogImg, { signal });
        if (imgRes.ok) {
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          const mime = sniffImageMime(buffer);
          if (mime) return { buffer, mimeType: mime };
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

export const tool = defineTool<Args, Result>({
  name: 'brand_memory_save',
  description:
    'Save a permanent Brand Kit learning, visual style rule, character/mascot specification, hex color palette, or DO-NOT correction to the client Memory layer so every future prompt, chat, and agent run remembers it. ' +
    'When imageUrl or assetId is supplied, inspects the visual with Gemini 4 Carbon vision (extracting public preview images when available) and stores a tagged Brand Kit reference asset in the Gallery.',
  input_schema: {
    type: 'object',
    properties: {
      note: {
        type: 'string',
        description: 'Clear, durable brand rule, character/mascot description, color palette (#HEX), or preference to remember',
      },
      kind: {
        type: 'string',
        enum: ['preference', 'pattern', 'correction'],
        description: 'preference for desired styles/characters, pattern for recurring templates, correction for strict DO-NOT rules',
      },
      imageUrl: {
        type: 'string',
        description: 'Optional image URL, /uploads/... path, or public post URL to inspect and archive as a Brand Kit reference',
      },
      assetId: {
        type: 'string',
        description: 'Optional existing Gallery Asset id to analyze and bind into Brand Memory',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tags for the saved reference asset (e.g. ["brand-kit", "mascot", "style-ref"])',
      },
      orgWide: {
        type: 'boolean',
        description: 'Set true only when the rule applies to every client in the organization; defaults to active client',
      },
      clientId: {
        type: 'string',
        description: 'Override active client; falls back to session clientId',
      },
    },
    required: ['note'],
    additionalProperties: false,
  },

  async handler(args, ctx) {
    if (ctx.signal.aborted) throw new Error('brand_memory_save aborted');

    const targetClientId = args.orgWide ? null : (args.clientId || ctx.clientId || null);
    const kind: MemoryKind = args.kind || 'preference';
    let visualSummary: string | null = null;
    let savedAssetId: string | null = null;
    let savedAssetUrl: string | null = null;
    let visualFetchNote = '';

    await ctx.emit('agent:thought', {
      text: `Saving to Brand Memory${args.imageUrl || args.assetId ? ' (analyzing visual reference)' : ''}...`,
      at: new Date().toISOString(),
    });

    let loadedVisual: { buffer: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' } | null = null;
    if (args.assetId) {
      const existing = await ctx.prisma.asset.findFirst({
        where: { id: args.assetId, orgId: ctx.orgId },
        select: { id: true, fileUrl: true },
      });
      if (existing) {
        savedAssetId = existing.id;
        savedAssetUrl = existing.fileUrl;
        loadedVisual = await tryFetchVisualReference(existing.fileUrl, ctx.signal);
      }
    } else if (args.imageUrl) {
      loadedVisual = await tryFetchVisualReference(args.imageUrl.trim(), ctx.signal);
      if (!loadedVisual) {
        visualFetchNote =
          'The external link did not expose a public image without login, so the rule and URL were saved to Brand Memory. Attach the image directly if you want pixel-level traits archived in the Gallery.';
      }
    }

    if (loadedVisual) {
      try {
        const analysisRes = await aiRouter.analysis(
          {
            prompt:
              'Analyze this brand reference image in at most 85 words for a creative director: describe exact character/mascot or product features, color palette (with approximate #HEX codes), typography or graphic style, materials, and lighting mood. Never use em-dashes. Return ONLY JSON: {"summary":"..."}',
            imageBase64: loadedVisual.buffer.toString('base64'),
            mimeType: loadedVisual.mimeType,
          },
          { orgId: ctx.orgId, userId: ctx.userId ?? undefined, clientId: targetClientId ?? undefined },
        );
        const out = analysisRes.output as any;
        const text = typeof out === 'string' ? out : typeof out?.summary === 'string' ? out.summary : '';
        if (text.trim()) visualSummary = text.trim().slice(0, 600);
      } catch {
        // Vision enrichment is best-effort
      }

      if (!savedAssetId && targetClientId) {
        const ext = loadedVisual.mimeType === 'image/png' ? '.png' : loadedVisual.mimeType === 'image/webp' ? '.webp' : '.jpg';
        const savedFile = await storageService.saveFile(loadedVisual.buffer, `brand-ref-${Date.now()}${ext}`, loadedVisual.mimeType);
        const mergedTags = Array.from(new Set(['brand-kit', 'reference', ...(args.tags || [])]));
        const createdAsset = await ctx.prisma.asset.create({
          data: {
            orgId: ctx.orgId,
            clientId: targetClientId,
            name: `Brand Reference: ${args.note.slice(0, 44)}`,
            fileUrl: savedFile.fileUrl,
            thumbUrl: savedFile.thumbUrl,
            mimeType: loadedVisual.mimeType,
            safeForClient: true,
            tags: mergedTags,
            analysis: visualSummary ? { visualSummary, sourceUrl: args.imageUrl || null } : undefined,
          },
        });
        savedAssetId = createdAsset.id;
        savedAssetUrl = createdAsset.fileUrl;
      }
    }

    const contentParts = [args.note.trim()];
    if (visualSummary) contentParts.push(`Visual traits: ${visualSummary}`);
    if (savedAssetUrl) contentParts.push(`Reference asset: ${savedAssetUrl}`);
    else if (args.imageUrl) contentParts.push(`Reference URL: ${args.imageUrl.trim()}`);

    const memoryId = await recordMemory({
      orgId: ctx.orgId,
      clientId: targetClientId,
      userId: ctx.userId ?? null,
      kind,
      source: 'explicit',
      content: contentParts.join(' | ').slice(0, 1500),
      context: args.imageUrl ? `agent brand_memory_save (${args.imageUrl.slice(0, 160)})` : 'agent brand_memory_save',
      weight: 1.5,
      metadata: {
        surface: 'agent',
        savedAssetId,
        savedAssetUrl,
        imageUrl: args.imageUrl || null,
        tags: args.tags || [],
      },
    });

    return {
      saved: Boolean(memoryId),
      memoryId,
      savedAssetId,
      savedAssetUrl,
      visualSummary,
      note:
        visualFetchNote ||
        (savedAssetId
          ? 'Saved to Brand Memory and archived as a Brand Kit reference in the Gallery.'
          : 'Saved to Brand Memory and active for future generations and agent runs.'),
    };
  },
});
