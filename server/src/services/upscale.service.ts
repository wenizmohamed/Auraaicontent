// Image upscaler for Creative Tools (2026-07-14, Weni request): scale a
// generated/edited image UP TO 16K.
//
// Two tiers:
//  - 'fast' (default): sharp/libvips Lanczos3 resample. Free, no API key,
//    streams in strips so even 16K stays memory-safe. Ideal for the CLEAN
//    AI-generated sources this tool produces (no sensor noise → interpolation
//    looks crisp, not mushy).
//  - 'ai': true super-resolution that hallucinates detail (fal.ai). Only used
//    when FAL_KEY + FAL_UPSCALE_MODEL are configured AND the account is funded;
//    otherwise transparently falls back to 'fast' so the feature never hard-
//    fails. (fal balance is currently exhausted — see docs.)
//
// Source can be raw base64 or a URL (an existing asset/generation). Output is
// saved to storage + returned. PNG for <= 4K long edge (lossless), high-quality
// JPEG above that (a 16K PNG is 100MB+; JPEG keeps it downloadable).

import sharp from 'sharp';
import { storageService } from './storage.service.js';

export const MAX_LONG_EDGE = 16384; // "16K"

export interface UpscaleInput {
  base64?: string;
  mimeType?: string;
  sourceUrl?: string;          // fetched if base64 absent
  scale?: 2 | 4 | 8;           // multiply source long edge (ignored if targetLongEdge set)
  targetLongEdge?: number;     // explicit target for the long edge, px (capped at 16384)
  format?: 'png' | 'jpeg' | 'auto';
  mode?: 'fast' | 'ai';
  orgId?: string;
  userId?: string;
  clientId?: string;
}

export interface UpscaleResult {
  fileUrl: string;
  thumbUrl?: string;
  width: number;
  height: number;
  scale: number;               // effective long-edge multiplier applied
  provider: 'sharp' | 'fal';
  format: 'png' | 'jpeg';
  bytes: number;
}

async function loadSource(input: UpscaleInput): Promise<Buffer> {
  if (input.base64) return Buffer.from(input.base64, 'base64');
  if (input.sourceUrl) {
    // Local /uploads path → read straight off disk; otherwise fetch.
    if (input.sourceUrl.startsWith('/uploads') || input.sourceUrl.startsWith('uploads')) {
      const abs = storageService.getAbsolutePath(input.sourceUrl);
      const fs = await import('fs');
      return fs.readFileSync(abs);
    }
    const res = await fetch(input.sourceUrl, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Could not fetch source image (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('No source image (base64 or sourceUrl required)');
}

/** Compute the target dimensions honoring aspect ratio + the 16K cap. */
function computeTarget(w: number, h: number, input: UpscaleInput): { tw: number; th: number; scale: number } {
  const longEdge = Math.max(w, h);
  let targetLong: number;
  if (input.targetLongEdge && input.targetLongEdge > 0) {
    targetLong = input.targetLongEdge;
  } else {
    targetLong = longEdge * (input.scale || 4);
  }
  targetLong = Math.min(Math.round(targetLong), MAX_LONG_EDGE);
  // never downscale via this endpoint — if the source already exceeds target, keep it
  if (targetLong <= longEdge) targetLong = longEdge;
  const scale = targetLong / longEdge;
  return { tw: Math.round(w * scale), th: Math.round(h * scale), scale };
}

/** Fast tier — sharp/libvips Lanczos3. */
async function upscaleSharp(buf: Buffer, input: UpscaleInput): Promise<UpscaleResult> {
  // Bound native memory + let libvips stream. Input pixel cap raised so 4K/8K
  // sources are accepted; libvips still processes the (large) output in strips.
  const meta = await sharp(buf, { limitInputPixels: 500_000_000 }).metadata();
  const w = meta.width || 0, h = meta.height || 0;
  if (!w || !h) throw new Error('Unreadable image dimensions');
  const { tw, th, scale } = computeTarget(w, h, input);

  const longEdge = Math.max(tw, th);
  const fmt: 'png' | 'jpeg' = input.format === 'png' ? 'png'
    : input.format === 'jpeg' ? 'jpeg'
    : (longEdge > 4096 ? 'jpeg' : 'png'); // auto: JPEG above 4K to keep file sane

  let pipeline = sharp(buf, { limitInputPixels: 500_000_000 })
    .resize(tw, th, { kernel: sharp.kernel.lanczos3, fit: 'fill', withoutEnlargement: false });
  pipeline = fmt === 'jpeg'
    ? pipeline.jpeg({ quality: 92, mozjpeg: true })
    : pipeline.png({ compressionLevel: 9 });

  const out = await pipeline.toBuffer();
  const name = `upscaled-${Date.now()}.${fmt === 'jpeg' ? 'jpg' : 'png'}`;
  const { fileUrl, thumbUrl } = await storageService.saveFile(out, name, fmt === 'jpeg' ? 'image/jpeg' : 'image/png');
  return { fileUrl, thumbUrl: thumbUrl ?? undefined, width: tw, height: th, scale: Math.round(scale * 100) / 100, provider: 'sharp', format: fmt, bytes: out.length };
}

/** AI tier — fal.ai super-resolution. Only when configured + funded; otherwise
 *  the caller catches and we fall back to fast. Kept behind env so an unverified
 *  model id / dry balance never breaks the feature. */
async function upscaleFal(buf: Buffer, input: UpscaleInput): Promise<UpscaleResult> {
  const key = process.env.FAL_KEY;
  const model = process.env.FAL_UPSCALE_MODEL; // e.g. 'fal-ai/clarity-upscaler'
  if (!key || !model) throw new Error('AI upscale not configured');
  const dataUri = `data:${input.mimeType || 'image/png'};base64,${buf.toString('base64')}`;
  const res = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: dataUri, scale: input.scale || 4 }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`fal upscale ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j: any = await res.json();
  const url = j?.image?.url || j?.images?.[0]?.url;
  if (!url) throw new Error('fal upscale returned no image');
  const dl = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(30000) })).arrayBuffer());
  const meta = await sharp(dl).metadata();
  const name = `upscaled-ai-${Date.now()}.png`;
  const { fileUrl, thumbUrl } = await storageService.saveFile(dl, name, 'image/png');
  return { fileUrl, thumbUrl: thumbUrl ?? undefined, width: meta.width || 0, height: meta.height || 0, scale: input.scale || 4, provider: 'fal', format: 'png', bytes: dl.length };
}

export async function upscaleImage(input: UpscaleInput): Promise<UpscaleResult> {
  const buf = await loadSource(input);
  if (input.mode === 'ai') {
    try { return await upscaleFal(buf, input); }
    catch { /* fall through to fast — feature never hard-fails */ }
  }
  return upscaleSharp(buf, input);
}
