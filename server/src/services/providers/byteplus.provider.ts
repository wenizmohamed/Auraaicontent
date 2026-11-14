// BytePlus ModelArk provider (ByteDance official international cloud: https://ark.ap-southeast.bytepluses.com/api/v3).
//
// Verified live 2026-11-14 against Weni's ap-southeast-1 account:
//   - VIDEO : POST /contents/generations/tasks + GET /contents/generations/tasks/{id}
//             models: dreamina-seedance-2-5-260628 (4-30s, 480p/720p/1080p, native stereo audio,
//             T2V + first_frame/last_frame I2V + up to 30 omni reference_image R2V),
//             dreamina-seedance-2-0-260128 (4-15s, up to native 4K + stereo audio),
//             dreamina-seedance-2-0-fast-260128 & dreamina-seedance-2-0-mini-260615 (fast 720p + audio),
//             seedance-1-0-pro-250528 & seedance-1-0-pro-fast-251015 (2-12s visual-only cinema).
//   - IMAGE : POST /images/generations
//             models: dola-seedream-5-5-261028 (1K/2K PNG, native RGBA transparent alpha,
//             multi-turn consistent edits up to 10 reference images),
//             dola-seedream-5-0-pro-260628, dola-seedream-5-0-flash-260915,
//             seedream-5-0-260128 (native 2K to 4K up to 4096x4096 / 5504x3040),
//             seedream-4-5-251128, seedream-4-0-250828.
//   - TEXT  : POST /chat/completions
//             models: dola-seed-2-1-turbo-260628 (256K VLM), seed-2-0-pro-260328,
//             seed-2-0-lite-260428, seed-2-0-mini-260428, deepseek-v4-1-flash-261017, glm-5-3-flash-260828.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type {
  AiProvider,
  AnalysisRequest,
  ImageRequest,
  ProviderResult,
  TextRequest,
  VideoRequest,
} from './types.js';
import { AiProviderError, AiCancelledError, abortReasonText, throwIfCancelled } from './errors.js';
import { storageService } from '../storage.service.js';
import { runModelLadder, readLadder } from './model-chain.js';

const execFileAsync = promisify(execFile);

const TEXT_TIMEOUT_MS = parseInt(process.env.ARK_TIMEOUT_MS || '120000', 10);
const IMAGE_TIMEOUT_MS = parseInt(process.env.ARK_IMAGE_TIMEOUT_MS || '240000', 10);
const VIDEO_BUDGET_MS = parseInt(process.env.ARK_VIDEO_BUDGET_MS || String(12 * 60 * 1000), 10);

function getBaseUrl(): string {
  return (process.env.ARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3')
    .replace(/\/+$/, '');
}

function getKey(): string {
  const key = process.env.ARK_API_KEY;
  if (!key) throw new AiProviderError('byteplus', 'init', 'ARK_API_KEY not set', 401);
  return key;
}

function stripThinkingAndFences(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function balancedJsonSlice(text: string): string | null {
  const start = text.search(/[\[{]/);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function safeJsonParse(raw: string, label: string): any {
  const cleaned = stripThinkingAndFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const balanced = balancedJsonSlice(cleaned);
    if (balanced) {
      try { return JSON.parse(balanced); } catch { /* fall through */ }
    }
    const match = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    throw new AiProviderError('byteplus', label, `JSON parse failed. Response: ${cleaned.slice(0, 200)}`);
  }
}

function isArkSafetyError(codeOrMsg: string): boolean {
  return /SensitiveContentDetected|InputImageSensitive|OutputVideoSensitive|OutputImageSensitive|real\s+human\s+face|portrait.*not\s+support/i.test(codeOrMsg);
}

async function arkFetch(
  endpointPath: string,
  body: object | undefined,
  opts: { method?: 'GET' | 'POST'; timeoutMs?: number; signal?: AbortSignal; task?: 'text' | 'image' | 'image_edit' | 'video' | 'analysis' } = {},
): Promise<any> {
  const task = opts.task || 'text';
  throwIfCancelled(opts.signal, task);
  const timeoutMs = opts.timeoutMs ?? TEXT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onCallerAbort, { once: true });

  try {
    const method = opts.method || 'POST';
    const res = await fetch(`${getBaseUrl()}${endpointPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${getKey()}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(method === 'POST' && body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      let errSummary = text.slice(0, 320);
      try {
        const parsed = JSON.parse(text);
        const code = parsed?.error?.code || '';
        const message = parsed?.error?.message || '';
        if (code || message) errSummary = `${code}${code && message ? ': ' : ''}${message}`.slice(0, 320);
      } catch { /* keep raw slice */ }

      if (isArkSafetyError(errSummary)) {
        throw new AiProviderError('byteplus', endpointPath, `${res.status} (safety policy): ${errSummary}`, 422);
      }
      if (/ServerOverloaded/i.test(errSummary)) {
        throw new AiProviderError('byteplus', endpointPath, `503 ServerOverloaded: ${errSummary}`, 503);
      }
      throw new AiProviderError('byteplus', endpointPath, `${res.status}: ${errSummary}`, res.status);
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new AiProviderError('byteplus', endpointPath, `Invalid JSON response: ${text.slice(0, 200)}`, 502);
    }
  } catch (err) {
    if (opts.signal?.aborted) throw new AiCancelledError(task, abortReasonText(opts.signal));
    if (timedOut) throw new AiProviderError('byteplus', endpointPath, `timeout after ${timeoutMs}ms`, 504);
    throw err;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onCallerAbort);
  }
}

async function ensureMinImageB64(
  b64: string,
  mime: string,
  opts: { clampVideoAspect?: boolean } = {},
): Promise<{ b64: string; mime: string }> {
  try {
    const buf = Buffer.from(b64, 'base64');
    const meta = await sharp(buf).metadata();
    if (meta.width && meta.height) {
      let nw = meta.width;
      let nh = meta.height;
      let needsResize = false;

      if (nw < 384 || nh < 384) {
        const scale = Math.max(384 / nw, 384 / nh);
        nw = Math.max(384, Math.round(nw * scale));
        nh = Math.max(384, Math.round(nh * scale));
        needsResize = true;
      }

      // Seedance requires width/height ratio in [0.4, 2.5] and dimensions in [300, 6000].
      if (opts.clampVideoAspect) {
        const ratio = nw / nh;
        if (ratio < 0.42) {
          nw = Math.ceil(nh * 0.42);
          needsResize = true;
        } else if (ratio > 2.45) {
          nh = Math.ceil(nw / 2.45);
          needsResize = true;
        }
      }

      if (needsResize) {
        const resized = await sharp(buf).resize(nw, nh, { fit: 'cover' }).png().toBuffer();
        return { b64: resized.toString('base64'), mime: 'image/png' };
      }
    }
  } catch { /* pass through */ }
  const cleanMime = /^image\/(png|jpeg|webp|gif|bmp|tiff)$/i.test(mime) ? mime.toLowerCase() : 'image/png';
  return { b64, mime: cleanMime };
}

// Exact official Dola Seedream 5.5 / 5.0 Pro / 5.0 Flash dimensions:
// 1K tier stays in [921,600 .. 2,600,000] px; 2K tier stays in (2,600,000 .. 4,624,220] px.
const DOLA_DIMS_1K: Record<string, string> = {
  '1:1': '1024x1024',
  '4:5': '960x1200',
  '9:16': '800x1424',
  '16:9': '1424x800',
  '4:3': '1152x864',
  '3:4': '864x1152',
  '3:2': '1248x832',
  '2:3': '832x1248',
  '21:9': '1568x672',
};

const DOLA_DIMS_2K: Record<string, string> = {
  '1:1': '2048x2048',
  '4:5': '1840x2304',
  '9:16': '1584x2816',
  '16:9': '2816x1584',
  '4:3': '2368x1776',
  '3:4': '1776x2368',
  '3:2': '2496x1664',
  '2:3': '1664x2496',
  '21:9': '3136x1344',
};

// Official Seedream 5.0 (5.0 lite) & Seedream 4.5 dimensions:
// Total pixels must fall in [3,686,400 .. 16,777,216].
const SEEDREAM_HI_2K: Record<string, string> = {
  '1:1': '2048x2048',
  '4:5': '1920x2400',
  '9:16': '1600x2848',
  '16:9': '2848x1600',
  '4:3': '2304x1728',
  '3:4': '1728x2304',
  '3:2': '2496x1664',
  '2:3': '1664x2496',
  '21:9': '3136x1344',
};

const SEEDREAM_HI_4K: Record<string, string> = {
  '1:1': '4096x4096',
  '4:5': '3648x4560',
  '9:16': '3040x5504',
  '16:9': '5504x3040',
  '4:3': '4704x3520',
  '3:4': '3520x4704',
  '3:2': '4992x3328',
  '2:3': '3328x4992',
  '21:9': '6240x2656',
};

function resolveSeedreamDimensions(
  model: string,
  aspectRatio?: string,
  imageSize?: '1K' | '2K' | '4K',
): { size: string; billedSuffix: string; supportsOutputFormat: boolean; supportsSequentialDisable: boolean; is55: boolean } {
  const m = model.toLowerCase();
  const ar = aspectRatio && DOLA_DIMS_2K[aspectRatio] ? aspectRatio : '1:1';
  const isDola = m.startsWith('dola-seedream-');
  const is55 = m.startsWith('dola-seedream-5-5');
  const isTieredDola = is55 || m.startsWith('dola-seedream-5-0-pro');

  if (isDola) {
    const tier = imageSize === '1K' ? '1K' : '2K';
    return {
      size: tier === '1K' ? DOLA_DIMS_1K[ar] : DOLA_DIMS_2K[ar],
      billedSuffix: isTieredDola ? (tier === '1K' ? ':1k' : ':2k') : '',
      supportsOutputFormat: true,
      supportsSequentialDisable: false,
      is55,
    };
  }

  const isSeedream50Or45 = m.startsWith('seedream-5-0') || m.startsWith('seedream-4-5');
  if (isSeedream50Or45) {
    const tier = imageSize === '4K' ? '4K' : '2K';
    return {
      size: tier === '4K' ? SEEDREAM_HI_4K[ar] : SEEDREAM_HI_2K[ar],
      billedSuffix: '',
      supportsOutputFormat: m.startsWith('seedream-5-0'),
      supportsSequentialDisable: true,
      is55: false,
    };
  }

  // seedream-4-0 / seedream-3-0 fallback
  const tier = imageSize === '4K' ? '4K' : imageSize === '1K' ? '1K' : '2K';
  const size = tier === '4K' ? SEEDREAM_HI_4K[ar] : tier === '1K' ? DOLA_DIMS_1K[ar] : SEEDREAM_HI_2K[ar];
  return {
    size,
    billedSuffix: '',
    supportsOutputFormat: false,
    supportsSequentialDisable: m.startsWith('seedream-4-0'),
    is55: false,
  };
}

function wantsTransparentAlpha(prompt: string): boolean {
  return /\b(transparent\s+background|alpha\s+channel|rgba|die[\s-]?cut\s+sticker|isolated\s+png|transparent\s+png|cutout\s+on\s+transparent)\b/i.test(prompt);
}

function refRoleInstruction(index: number, role?: 'content' | 'style' | 'character'): string {
  switch (role) {
    case 'style':
      return `Image ${index} is the STYLE reference (apply its color palette, lighting, and texture, not its subject).`;
    case 'character':
      return `Image ${index} is the PRODUCT/CHARACTER reference (preserve its exact identity, logo, and geometry).`;
    case 'content':
      return `Image ${index} is the LAYOUT/COMPOSITION reference.`;
    default:
      return `Image ${index} is an additional visual reference.`;
  }
}

function extractUsage(u: any): { promptTokens?: number; completionTokens?: number; totalTokens?: number } {
  if (!u || typeof u !== 'object') return {};
  const p = u.prompt_tokens ?? u.input_tokens;
  const c = u.completion_tokens ?? u.output_tokens;
  const t = u.total_tokens ?? (((p ?? 0) + (c ?? 0)) || undefined);
  return {
    ...(typeof p === 'number' ? { promptTokens: p } : {}),
    ...(typeof c === 'number' ? { completionTokens: c } : {}),
    ...(typeof t === 'number' ? { totalTokens: t } : {}),
  };
}

/**
 * Seedance 2.5 1080p and Seedance 2.0 4K output 10-bit HEVC (H.265), which
 * several desktop/Windows browsers cannot decode inline in <video>. Probe the
 * stream and transcode to 8-bit H.264 yuv420p (+faststart, audio copied) when
 * HEVC/10-bit is detected. Falls back to the raw MP4 buffer if ffmpeg is absent.
 */
async function ensureBrowserCompatibleMp4(buf: Buffer): Promise<Buffer> {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inPath = path.join(os.tmpdir(), `seedance-in-${stamp}.mp4`);
  const outPath = path.join(os.tmpdir(), `seedance-out-${stamp}.mp4`);
  try {
    await fs.writeFile(inPath, buf);
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,pix_fmt',
      '-of', 'json',
      inPath,
    ], { timeout: 15000 });
    const info = JSON.parse(stdout || '{}');
    const stream = info?.streams?.[0] || {};
    const codec = String(stream.codec_name || '').toLowerCase();
    const pixFmt = String(stream.pix_fmt || '').toLowerCase();
    const needsTranscode = codec === 'hevc' || codec === 'h265' || pixFmt.includes('10');
    if (!needsTranscode) return buf;

    await execFileAsync('ffmpeg', [
      '-y',
      '-i', inPath,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'fast',
      '-crf', '20',
      '-movflags', '+faststart',
      '-c:a', 'copy',
      outPath,
    ], { timeout: 180000 });
    const transcoded = await fs.readFile(outPath);
    if (transcoded.length > 1024) {
      console.log(`[byteplus/video] transcoded ${codec}/${pixFmt} -> h264/yuv420p (${buf.length} -> ${transcoded.length} bytes)`);
      return transcoded;
    }
    return buf;
  } catch {
    return buf;
  } finally {
    await fs.unlink(inPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});
  }
}

export const byteplusProvider: AiProvider = {
  name: 'byteplus',

  async text(req: TextRequest): Promise<ProviderResult<string | object>> {
    throwIfCancelled(req.signal, 'text');
    const ladder = readLadder('ARK_TEXT_LADDER', [
      process.env.ARK_TEXT_MODEL || 'dola-seed-2-1-turbo-260628',
      'seed-2-0-pro-260328',
      'seed-2-0-lite-260428',
      'deepseek-v4-1-flash-261017',
    ]);
    if (req.model && /^(dola-seed-|seed-2-|seed-translation-|deepseek-v4-|glm-5-)/i.test(req.model)) {
      const rest = ladder.filter((e) => e.model !== req.model);
      ladder.length = 0;
      ladder.push({ model: req.model }, ...rest);
    }

    const start = Date.now();
    const maxTokens = req.maxTokens ?? (req.json ? 8192 : 4096);
    const systemText = req.json
      ? `${req.system ? `${req.system}\n\n` : ''}Respond ONLY with valid raw JSON (no markdown code fences, no commentary).`
      : req.system;

    const run = await runModelLadder('byteplus', 'text', ladder, async (entry) => {
      const data = await arkFetch(
        '/chat/completions',
        {
          model: entry.model,
          temperature: req.temperature ?? 0.7,
          max_tokens: maxTokens,
          messages: [
            ...(systemText ? [{ role: 'system', content: systemText }] : []),
            { role: 'user', content: req.prompt },
          ],
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
        },
        { timeoutMs: req.timeoutMs ?? TEXT_TIMEOUT_MS, signal: req.signal, task: 'text' },
      );
      const rawContent = String(data?.choices?.[0]?.message?.content ?? '');
      const cleaned = stripThinkingAndFences(rawContent);
      if (!cleaned) {
        throw new AiProviderError('byteplus', 'text', `Empty completion from ${entry.model}`, 503);
      }
      return {
        output: req.json ? safeJsonParse(cleaned, 'text') : cleaned,
        usage: data?.usage,
      };
    });

    return {
      provider: 'byteplus',
      model: run.modelUsed,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      output: run.result.output,
      ...extractUsage(run.result.usage),
    };
  },

  async image(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    throwIfCancelled(req.signal, 'image');
    const defaults = req.imageSize === '4K' && !req.model
      ? ['seedream-5-0-260128', 'dola-seedream-5-5-261028', 'dola-seedream-5-0-pro-260628', 'dola-seedream-5-0-flash-260915']
      : [
          process.env.ARK_IMAGE_MODEL || 'dola-seedream-5-5-261028',
          'dola-seedream-5-0-pro-260628',
          'seedream-5-0-260128',
          'dola-seedream-5-0-flash-260915',
        ];
    const ladder = readLadder('ARK_IMAGE_LADDER', defaults);
    if (req.model && /^(dola-seedream-|seedream-)/i.test(req.model)) {
      const rest = ladder.filter((e) => e.model !== req.model);
      ladder.length = 0;
      ladder.push({ model: req.model }, ...rest);
    }

    const start = Date.now();
    const transparent = wantsTransparentAlpha(req.prompt);
    let billedSuffix = '';

    const run = await runModelLadder('byteplus', 'image', ladder, async (entry) => {
      const spec = resolveSeedreamDimensions(entry.model, req.aspectRatio, req.imageSize);
      billedSuffix = spec.billedSuffix;

      const payload: Record<string, unknown> = {
        model: entry.model,
        prompt: req.prompt,
        size: spec.size,
        response_format: 'url',
        watermark: false,
      };
      if (spec.supportsOutputFormat) payload.output_format = 'png';
      if (spec.is55) payload.background = transparent ? 'transparent' : 'auto';
      if (spec.supportsSequentialDisable) payload.sequential_image_generation = 'disabled';

      const data = await arkFetch('/images/generations', payload, {
        timeoutMs: IMAGE_TIMEOUT_MS,
        signal: req.signal,
        task: 'image',
      });
      const url = data?.data?.[0]?.url;
      const b64 = data?.data?.[0]?.b64_json;
      if (!url && !b64) {
        throw new AiProviderError('byteplus', 'image', `Empty ${entry.model} image response`, 503);
      }
      return { url, b64, usage: data?.usage };
    });

    return {
      provider: 'byteplus',
      model: `${run.modelUsed}${billedSuffix}`,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      output: run.result.b64 ? { base64: run.result.b64 } : { url: run.result.url },
      ...extractUsage(run.result.usage),
    };
  },

  async imageEdit(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    throwIfCancelled(req.signal, 'image_edit');
    if (!req.imageBase64) {
      throw new AiProviderError('byteplus', 'imageEdit', 'imageBase64 is required for imageEdit', 400);
    }

    const ladder = readLadder('ARK_IMAGE_EDIT_LADDER', [
      process.env.ARK_IMAGE_MODEL || 'dola-seedream-5-5-261028',
      'dola-seedream-5-0-pro-260628',
      'seedream-5-0-260128',
      'dola-seedream-5-0-flash-260915',
    ]);
    if (req.model && /^(dola-seedream-|seedream-)/i.test(req.model)) {
      const rest = ladder.filter((e) => e.model !== req.model);
      ladder.length = 0;
      ladder.push({ model: req.model }, ...rest);
    }

    const start = Date.now();
    const primary = await ensureMinImageB64(req.imageBase64, req.mimeType || 'image/png');
    const imageUrls: string[] = [`data:${primary.mime};base64,${primary.b64}`];
    const roleHints: string[] = [];
    const extraRefs = (req.referenceImages || []).filter((r) => r?.base64 && r?.mimeType).slice(0, 9);
    if (extraRefs.length > 0) {
      roleHints.push('Image 1 is the BASE IMAGE to edit.');
      for (let i = 0; i < extraRefs.length; i++) {
        const norm = await ensureMinImageB64(extraRefs[i].base64, extraRefs[i].mimeType);
        imageUrls.push(`data:${norm.mime};base64,${norm.b64}`);
        roleHints.push(refRoleInstruction(i + 2, extraRefs[i].role));
      }
    }
    const editPrompt = roleHints.length > 0
      ? `${roleHints.join(' ')}\n\n${req.prompt}`
      : req.prompt;
    const transparent = wantsTransparentAlpha(req.prompt);
    let billedSuffix = '';

    const run = await runModelLadder('byteplus', 'image_edit', ladder, async (entry) => {
      const spec = resolveSeedreamDimensions(entry.model, req.aspectRatio, req.imageSize);
      billedSuffix = spec.billedSuffix;

      const payload: Record<string, unknown> = {
        model: entry.model,
        prompt: editPrompt,
        image: imageUrls.length === 1 ? imageUrls[0] : imageUrls,
        size: spec.size,
        response_format: 'url',
        watermark: false,
      };
      if (spec.supportsOutputFormat) payload.output_format = 'png';
      // Official Seedream 5.5 multi-turn edit recommendation: use 'opaque' unless RGBA cutout requested.
      if (spec.is55) payload.background = transparent ? 'transparent' : 'opaque';
      if (spec.supportsSequentialDisable) payload.sequential_image_generation = 'disabled';

      const data = await arkFetch('/images/generations', payload, {
        timeoutMs: IMAGE_TIMEOUT_MS,
        signal: req.signal,
        task: 'image_edit',
      });
      const url = data?.data?.[0]?.url;
      const b64 = data?.data?.[0]?.b64_json;
      if (!url && !b64) {
        throw new AiProviderError('byteplus', 'imageEdit', `Empty ${entry.model} image-edit response`, 503);
      }
      return { url, b64, usage: data?.usage };
    });

    return {
      provider: 'byteplus',
      model: `${run.modelUsed}${billedSuffix}`,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      output: run.result.b64 ? { base64: run.result.b64 } : { url: run.result.url },
      ...extractUsage(run.result.usage),
    };
  },

  async video(req: VideoRequest): Promise<ProviderResult<{ url: string }>> {
    throwIfCancelled(req.signal, 'video');
    const defaults = req.fast && !req.model
      ? [
          'dreamina-seedance-2-0-fast-260128',
          'dreamina-seedance-2-0-mini-260615',
          'seedance-1-0-pro-fast-251015',
          process.env.ARK_VIDEO_MODEL || 'dreamina-seedance-2-5-260628',
        ]
      : [
          process.env.ARK_VIDEO_MODEL || 'dreamina-seedance-2-5-260628',
          'dreamina-seedance-2-0-260128',
          'dreamina-seedance-2-0-fast-260128',
          'seedance-1-0-pro-fast-251015',
        ];
    const ladder = readLadder('ARK_VIDEO_LADDER', defaults);
    if (req.model && /^(dreamina-seedance-|seedance-)/i.test(req.model)) {
      const rest = ladder.filter((e) => e.model !== req.model);
      ladder.length = 0;
      ladder.push({ model: req.model }, ...rest);
    }

    const start = Date.now();
    const startB64 = req.startImageBase64 || req.imageBase64;
    const startMime = req.startMimeType || req.mimeType || 'image/png';
    const endB64 = req.endImageBase64;
    const endMime = req.endMimeType || 'image/png';
    const refs = (req.referenceImages || []).filter((r) => r?.base64 && r?.mimeType).slice(0, 10);

    const cleanedPrompt = req.prompt
      .replace(/^\s*(?:\d+:\d+\s+(?:square|vertical|portrait|widescreen|landscape|cinematic)\s+aspect\s+ratio\.?\s*)/i, '')
      .trim() || req.prompt;

    const normStart = startB64 ? await ensureMinImageB64(startB64, startMime, { clampVideoAspect: true }) : null;
    const normEnd = endB64 ? await ensureMinImageB64(endB64, endMime, { clampVideoAspect: true }) : null;
    const normRefs = await Promise.all(refs.map((r) => ensureMinImageB64(r.base64, r.mimeType, { clampVideoAspect: true })));

    let billedSuffix = '';
    let taskUsage: any;
    let actualDuration = Math.min(Math.max(Math.round(req.durationSeconds || 6), 4), 15);

    const run = await runModelLadder('byteplus', 'video', ladder, async (entry) => {
      const m = entry.model.toLowerCase();
      const is25 = m.startsWith('dreamina-seedance-2-5');
      const is20 = m.startsWith('dreamina-seedance-2-0');
      const is20Full = m === 'dreamina-seedance-2-0-260128';
      const is720MaxOnly = /^dreamina-seedance-2-0-(fast|mini)/i.test(m) || /^dreamina-seedance-2-5-flash/i.test(m);
      const is10 = m.startsWith('seedance-1-0');
      const is10Fast = m.startsWith('seedance-1-0-pro-fast');

      const content: Record<string, unknown>[] = [{ type: 'text', text: cleanedPrompt }];
      let usedFrameAnchor = false;
      let usedOmniRefs = false;

      if (normStart) {
        usedFrameAnchor = true;
        content.push({
          type: 'image_url',
          image_url: { url: `data:${normStart.mime};base64,${normStart.b64}` },
          role: 'first_frame',
        });
        if (normEnd && !is10Fast) {
          content.push({
            type: 'image_url',
            image_url: { url: `data:${normEnd.mime};base64,${normEnd.b64}` },
            role: 'last_frame',
          });
        }
      } else if (normRefs.length > 0) {
        if (is10) {
          // Seedance 1.0 does not support reference_image; promote primary ref to first_frame.
          usedFrameAnchor = true;
          content.push({
            type: 'image_url',
            image_url: { url: `data:${normRefs[0].mime};base64,${normRefs[0].b64}` },
            role: 'first_frame',
          });
        } else {
          usedOmniRefs = true;
          const cap = is25 ? 10 : 9;
          for (const nr of normRefs.slice(0, cap)) {
            content.push({
              type: 'image_url',
              image_url: { url: `data:${nr.mime};base64,${nr.b64}` },
              role: 'reference_image',
            });
          }
        }
      }

      // Seedance 2.5 strictly requires ratio='adaptive' whenever first_frame/last_frame is passed.
      const ratio = usedFrameAnchor ? 'adaptive' : (req.aspectRatio === '9:16' ? '9:16' : '16:9');
      const maxDur = is25 ? 30 : is20 ? 15 : 12;
      const minDur = is10 ? 2 : 4;
      const duration = Math.min(Math.max(Math.round(req.durationSeconds || 6), minDur), maxDur);
      actualDuration = duration;

      let apiResolution: '720p' | '1080p' | '4k' = '720p';
      if (is720MaxOnly) {
        apiResolution = '720p';
        billedSuffix = '';
      } else if (req.resolution === '4k' && is20Full) {
        apiResolution = '4k';
        billedSuffix = ':4k';
      } else if (req.resolution === '1080p' || req.resolution === '4k') {
        apiResolution = '1080p';
        billedSuffix = ':1080p';
      } else {
        apiResolution = '720p';
        billedSuffix = '';
      }

      const submitAndPoll = async (promptOverride?: string): Promise<string> => {
        const attemptContent = promptOverride
          ? [{ type: 'text', text: promptOverride }, ...content.slice(1)]
          : content;
        const payload: Record<string, unknown> = {
          model: entry.model,
          content: attemptContent,
          resolution: apiResolution,
          duration,
          ratio,
          watermark: false,
        };
        if (is25 || is20) payload.generate_audio = true;
        if (is25 && usedOmniRefs) payload.omni_reference_task_type = 'reference';

        const submitted = await arkFetch('/contents/generations/tasks', payload, {
          timeoutMs: 60000,
          signal: req.signal,
          task: 'video',
        });

        const taskId = submitted?.id || submitted?.task_id;
        if (!taskId) {
          throw new AiProviderError('byteplus', 'video', `${entry.model} submit missing id: ${JSON.stringify(submitted).slice(0, 200)}`, 502);
        }

        const deadline = Date.now() + VIDEO_BUDGET_MS;
        while (Date.now() < deadline) {
          throwIfCancelled(req.signal, 'video');
          await new Promise((r) => setTimeout(r, 5000));
          throwIfCancelled(req.signal, 'video');

          const poll = await arkFetch(
            `/contents/generations/tasks/${encodeURIComponent(String(taskId))}`,
            undefined,
            { method: 'GET', timeoutMs: 30000, signal: req.signal, task: 'video' },
          );

          const status = String(poll?.status || '').toLowerCase();
          if (status === 'succeeded' || status === 'success') {
            const remoteUrl = poll?.content?.video_url || poll?.content?.url || poll?.video_url;
            if (!remoteUrl) {
              throw new AiProviderError('byteplus', 'video', `${entry.model} succeeded without video_url`, 502);
            }
            taskUsage = poll?.usage;
            return String(remoteUrl);
          }
          if (status === 'failed' || status === 'fail' || status === 'canceled' || status === 'cancelled' || status === 'expired') {
            const errCode = poll?.error?.code || '';
            const errMsg = poll?.error?.message || status;
            const combined = `${errCode}${errCode && errMsg ? ': ' : ''}${errMsg}`;
            if (isArkSafetyError(combined)) {
              throw new AiProviderError('byteplus', 'video', `${entry.model} video (safety policy): ${combined.slice(0, 220)}`, 422);
            }
            throw new AiProviderError('byteplus', 'video', `${entry.model} video ${status}: ${combined.slice(0, 220)}`, 502);
          }
        }
        throw new AiProviderError('byteplus', 'video', `${entry.model} poll timeout after ${Math.round(VIDEO_BUDGET_MS / 1000)}s`, 504);
      };

      try {
        return await submitAndPoll();
      } catch (firstErr: any) {
        if ((is25 || is20) && /OutputAudioSensitiveContentDetected/i.test(String(firstErr?.message || ''))) {
          console.warn(`[byteplus/video] ${entry.model} hit OutputAudioSensitiveContentDetected on seed 1; retrying same model with clean foley constraint`);
          return await submitAndPoll(`${cleanedPrompt} Pure instrumental and environmental foley audio only, zero background voices.`);
        }
        throw firstErr;
      }
    });

    // Persist MP4 locally (transcoding 10-bit HEVC -> 8-bit H.264 yuv420p when needed)
    // so 24h BytePlus TOS URLs never expire and every browser plays <video> natively.
    let finalUrl = run.result;
    try {
      const dl = await fetch(run.result, { signal: AbortSignal.timeout(180000) });
      if (dl.ok) {
        const rawBuf = Buffer.from(await dl.arrayBuffer());
        const browserBuf = await ensureBrowserCompatibleMp4(rawBuf);
        const saved = await storageService.saveFile(
          browserBuf,
          `${run.modelUsed.replace(/[^a-z0-9.-]+/gi, '-')}-${Date.now()}.mp4`,
          'video/mp4',
        );
        finalUrl = saved.fileUrl;
      }
    } catch (e: any) {
      console.warn(`[byteplus/video] persist failed (${e?.message}); returning remote url`);
    }

    return {
      provider: 'byteplus',
      model: `${run.modelUsed}${billedSuffix}`,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      output: { url: finalUrl },
      durationSeconds: actualDuration,
      ...extractUsage(taskUsage),
    };
  },

  async analysis(req: AnalysisRequest): Promise<ProviderResult<object>> {
    throwIfCancelled(req.signal, 'analysis');
    const ladder = readLadder('ARK_ANALYSIS_LADDER', [
      process.env.ARK_TEXT_MODEL || 'dola-seed-2-1-turbo-260628',
      'seed-2-0-pro-260328',
      'seed-2-0-lite-260428',
    ]);
    const start = Date.now();
    const norm = await ensureMinImageB64(req.imageBase64, req.mimeType || 'image/png');
    const dataUrl = `data:${norm.mime};base64,${norm.b64}`;

    const run = await runModelLadder('byteplus', 'analysis', ladder, async (entry) => {
      const data = await arkFetch(
        '/chat/completions',
        {
          model: entry.model,
          temperature: 0.3,
          max_tokens: 4096,
          messages: [
            { role: 'system', content: 'Respond ONLY with valid raw JSON (no markdown code fences, no commentary).' },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: dataUrl } },
                { type: 'text', text: req.prompt },
              ],
            },
          ],
          response_format: { type: 'json_object' },
        },
        { timeoutMs: TEXT_TIMEOUT_MS, signal: req.signal, task: 'analysis' },
      );
      const rawContent = String(data?.choices?.[0]?.message?.content ?? '');
      const parsed = safeJsonParse(rawContent, 'analysis');
      return { output: parsed, usage: data?.usage };
    });

    return {
      provider: 'byteplus',
      model: run.modelUsed,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      output: run.result.output,
      ...extractUsage(run.result.usage),
    };
  },
};
