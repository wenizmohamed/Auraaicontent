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
import { aiRouter } from './providers/ai-router.js';

export const MAX_LONG_EDGE = 16384; // "16K"

export interface UpscaleInput {
  base64?: string;
  mimeType?: string;
  sourceUrl?: string;          // fetched if base64 absent
  scale?: 2 | 4 | 8;           // multiply source long edge (ignored if targetLongEdge set)
  targetLongEdge?: number;     // explicit target for the long edge, px (capped at 16384)
  format?: 'png' | 'jpeg' | 'auto';
  mode?: 'fast' | 'ai';
  /** Which image model does the AI enhance pass (mode:'ai'). Any of our
   *  image-capable models: gemini nano-banana, qwen-image-2.0(-pro),
   *  wan2.7-image(-pro). Falls back through the router chain if omitted. */
  model?: string;
  provider?: 'gemini' | 'xai' | 'dashscope';
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
  provider: 'sharp' | 'fal' | 'gemini' | 'xai' | 'dashscope';
  format: 'png' | 'jpeg';
  bytes: number;
  /** true when an AI model added detail (vs pure interpolation). */
  aiEnhanced?: boolean;
}

// SSRF guard: a caller-supplied sourceUrl is fetched BY THE SERVER, so without
// this it doubles as a probe of loopback/LAN services (redis, the API's own
// internal routes, cloud metadata). Public http(s) hosts only.
export function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw Object.assign(new Error('Invalid source URL'), { statusCode: 400 }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw Object.assign(new Error('Only http(s) URLs are allowed'), { statusCode: 400 });
  }
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const blocked =
    h === 'localhost' || h === '::1' || h.endsWith('.localhost') || h.endsWith('.internal') ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) || /^0\./.test(h) ||
    /^f[cd][0-9a-f]{2}:/i.test(h) || /^fe80:/i.test(h);
  if (blocked) throw Object.assign(new Error('URL host is not permitted'), { statusCode: 400 });
  return u;
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
    assertPublicHttpUrl(input.sourceUrl);
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

/** Resample an already-in-memory buffer to the requested target long edge with
 *  Lanczos3, then persist. Used to pad an AI-enhanced result (capped ~4K by the
 *  model) up to the requested size (up to 16K). */
async function padToTarget(buf: Buffer, input: UpscaleInput): Promise<{ fileUrl: string; thumbUrl?: string; width: number; height: number; format: 'png' | 'jpeg'; bytes: number }> {
  const meta = await sharp(buf, { limitInputPixels: 500_000_000 }).metadata();
  const { tw, th } = computeTarget(meta.width || 0, meta.height || 0, input);
  const longEdge = Math.max(tw, th);
  const fmt: 'png' | 'jpeg' = input.format === 'png' ? 'png' : input.format === 'jpeg' ? 'jpeg' : (longEdge > 4096 ? 'jpeg' : 'png');
  let pipe = sharp(buf, { limitInputPixels: 500_000_000 }).resize(tw, th, { kernel: sharp.kernel.lanczos3, fit: 'fill', withoutEnlargement: false });
  pipe = fmt === 'jpeg' ? pipe.jpeg({ quality: 92, mozjpeg: true }) : pipe.png({ compressionLevel: 9 });
  const out = await pipe.toBuffer();
  const name = `upscaled-ai-${Date.now()}.${fmt === 'jpeg' ? 'jpg' : 'png'}`;
  const { fileUrl, thumbUrl } = await storageService.saveFile(out, name, fmt === 'jpeg' ? 'image/jpeg' : 'image/png');
  return { fileUrl, thumbUrl: thumbUrl ?? undefined, width: tw, height: th, format: fmt, bytes: out.length };
}

/** AI tier using the models we ALREADY have (Gemini nano-banana → DashScope
 *  Qwen via the router's image_edit chain). Regenerates the exact image at up to
 *  4K adding real detail/sharpness, then Lanczos-pads to the requested target
 *  (up to 16K). No fal, no extra key — rides the universal fallback + metering. */
async function upscaleAiModels(buf: Buffer, input: UpscaleInput): Promise<UpscaleResult> {
  const meta = await sharp(buf, { limitInputPixels: 500_000_000 }).metadata();
  const { tw, th } = computeTarget(meta.width || 0, meta.height || 0, input);
  const aiLong = Math.max(tw, th);
  const imageSize: '1K' | '2K' | '4K' = aiLong >= 4096 ? '4K' : aiLong >= 2048 ? '2K' : '1K';
  const prompt = 'Upscale and enhance this exact image to maximum resolution and clarity. Add fine, realistic detail, texture and sharpness. Keep the composition, subject, framing, colors and ANY text 100% identical — do not add, remove, restyle or reinterpret anything. Output a crisp high-resolution version of the same image.';

  const result = await aiRouter.image(
    { prompt, imageBase64: buf.toString('base64'), mimeType: input.mimeType || 'image/png', imageSize, ...(input.model ? { model: input.model } : {}) },
    { orgId: input.orgId, userId: input.userId, clientId: input.clientId, ...(input.provider ? { preferredProvider: input.provider } : {}) },
  );
  // Pull the model output into a buffer (Gemini → base64, DashScope → url).
  let aiBuf: Buffer | null = null;
  if (result.output.base64) aiBuf = Buffer.from(result.output.base64, 'base64');
  else if (result.output.url) aiBuf = Buffer.from(await (await fetch(result.output.url, { signal: AbortSignal.timeout(30000) })).arrayBuffer());
  if (!aiBuf) throw new Error('AI enhance returned no image');

  const provider = (result.provider as UpscaleResult['provider']) || 'gemini';
  const aiMeta = await sharp(aiBuf).metadata();
  const aiW = aiMeta.width || 0, aiH = aiMeta.height || 0;

  // If the model already met/exceeded the target, save as-is; else Lanczos-pad up.
  if (Math.max(aiW, aiH) >= aiLong) {
    const fmt: 'png' | 'jpeg' = aiLong > 4096 ? 'jpeg' : 'png';
    const outBuf = fmt === 'jpeg' ? await sharp(aiBuf).jpeg({ quality: 92, mozjpeg: true }).toBuffer() : aiBuf;
    const name = `upscaled-ai-${Date.now()}.${fmt === 'jpeg' ? 'jpg' : 'png'}`;
    const { fileUrl, thumbUrl } = await storageService.saveFile(outBuf, name, fmt === 'jpeg' ? 'image/jpeg' : 'image/png');
    return { fileUrl, thumbUrl: thumbUrl ?? undefined, width: aiW, height: aiH, scale: Math.round((Math.max(aiW, aiH) / Math.max(meta.width || 1, meta.height || 1)) * 100) / 100, provider, format: fmt, bytes: outBuf.length, aiEnhanced: true };
  }
  const padded = await padToTarget(aiBuf, input);
  return { ...padded, scale: Math.round((Math.max(padded.width, padded.height) / Math.max(meta.width || 1, meta.height || 1)) * 100) / 100, provider, aiEnhanced: true };
}

/** Optional premium tier — fal.ai super-resolution. Only when explicitly
 *  configured (FAL_UPSCALE_MODEL) + funded; caller catches + falls back. */
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
    // Premium fal tier ONLY if explicitly configured (topaz/seedvr, needs funded
    // balance); otherwise use the AI models we already have (Gemini/DashScope).
    if (process.env.FAL_UPSCALE_MODEL && process.env.FAL_KEY) {
      try { return await upscaleFal(buf, input); } catch { /* fall through */ }
    }
    try { return await upscaleAiModels(buf, input); }
    catch { /* AI models unavailable — fall back to fast Lanczos, never hard-fail */ }
  }
  return upscaleSharp(buf, input);
}
