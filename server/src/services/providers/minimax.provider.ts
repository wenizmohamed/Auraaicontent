// MiniMax M Plan provider (https://api.minimax.io).
//
// Verified live 2026-11-12 against https://api.minimax.io:
//   - VIDEO : POST /v2/video_generation + GET /v2/query/video_generation/{id}
//             models: MiniMax-H3 (768P & native 2K with stereo audio, 4-15s,
//             T2V + first_frame/last_frame I2V + reference_image R2V),
//             MiniMax-H3-Max (fast 480P/768P cinema drafts).
//   - IMAGE : POST /v1/images/generations & POST /v1/images/edits
//             models: MiniMax-H3-Image (up to 4096x4096 4K stills & multi-ref
//             <Picture N> edits), MiniMax-H3-Image-Highspeed;
//             POST /v1/image_generation for image-01 (fast economy & character ref).
//   - TEXT  : POST /v1/chat/completions
//             models: MiniMax-M3, MiniMax-M3.1-Flash, MiniMax-M2.7.

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

const TEXT_TIMEOUT_MS = parseInt(process.env.MINIMAX_TIMEOUT_MS || '120000', 10);
const IMAGE_TIMEOUT_MS = parseInt(process.env.MINIMAX_IMAGE_TIMEOUT_MS || '240000', 10);
const VIDEO_BUDGET_MS = parseInt(process.env.MINIMAX_VIDEO_BUDGET_MS || String(10 * 60 * 1000), 10);

function getBaseHost(): string {
  return (process.env.MINIMAX_BASE_URL || 'https://api.minimax.io')
    .replace(/\/v\d+\/?$/i, '')
    .replace(/\/+$/, '');
}

function getKey(): string {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw new AiProviderError('minimax', 'init', 'MINIMAX_API_KEY not set', 401);
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
    throw new AiProviderError('minimax', label, `JSON parse failed. Response: ${cleaned.slice(0, 200)}`);
  }
}

async function minimaxFetch(
  path: string,
  body: object | undefined,
  opts: { method?: 'GET' | 'POST'; timeoutMs?: number; signal?: AbortSignal; task?: 'text' | 'image' | 'image_edit' | 'video' } = {},
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
    const res = await fetch(`${getBaseHost()}${path}`, {
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
      throw new AiProviderError('minimax', path, `${res.status}: ${text.slice(0, 300)}`, res.status);
    }
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new AiProviderError('minimax', path, `Invalid JSON response: ${text.slice(0, 200)}`, 502);
    }
    const baseCode = data?.base_resp?.status_code;
    if (typeof baseCode === 'number' && baseCode !== 0) {
      const baseMsg = data?.base_resp?.status_msg || 'MiniMax API error';
      // Map MiniMax business codes to HTTP semantics so retryable vs bad-request works cleanly
      const mappedStatus = baseCode === 1004 || baseCode === 2049 ? 401
        : baseCode === 1002 || baseCode === 1039 ? 429
        : baseCode === 1008 || baseCode === 2056 ? 402
        : baseCode === 1026 || baseCode === 1027 ? 422
        : 502;
      throw new AiProviderError('minimax', path, `MiniMax ${baseCode}: ${baseMsg}`, mappedStatus);
    }
    return data;
  } catch (err) {
    if (opts.signal?.aborted) throw new AiCancelledError(task, abortReasonText(opts.signal));
    if (timedOut) throw new AiProviderError('minimax', path, `timeout after ${timeoutMs}ms`, 504);
    throw err;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onCallerAbort);
  }
}

async function ensureMinImageB64(b64: string, mime: string): Promise<{ b64: string; mime: string }> {
  try {
    const buf = Buffer.from(b64, 'base64');
    const meta = await sharp(buf).metadata();
    if (meta.width && meta.height && (meta.width < 384 || meta.height < 384)) {
      const scale = Math.max(384 / meta.width, 384 / meta.height);
      const nw = Math.max(384, Math.round(meta.width * scale));
      const nh = Math.max(384, Math.round(meta.height * scale));
      const resized = await sharp(buf).resize(nw, nh, { fit: 'fill' }).png().toBuffer();
      return { b64: resized.toString('base64'), mime: 'image/png' };
    }
  } catch { /* pass through */ }
  return { b64, mime };
}

const MINIMAX_ASPECTS = new Set(['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9']);
const MINIMAX_NEAREST_AR: Record<string, string> = { '4:5': '3:4', '5:4': '4:3' };

function normalizeAspectRatio(ar?: string): string {
  if (!ar) return '1:1';
  if (MINIMAX_ASPECTS.has(ar)) return ar;
  return MINIMAX_NEAREST_AR[ar] || '1:1';
}

function refRoleInstruction(index: number, role?: 'content' | 'style' | 'character'): string {
  switch (role) {
    case 'style':
      return `<Picture ${index}> is the STYLE reference (apply its color palette, lighting, and texture, not its subject).`;
    case 'character':
      return `<Picture ${index}> is the PRODUCT/CHARACTER reference (preserve its exact identity and geometry).`;
    case 'content':
      return `<Picture ${index}> is the LAYOUT/COMPOSITION reference.`;
    default:
      return `<Picture ${index}> is an additional visual reference.`;
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

export const minimaxProvider: AiProvider = {
  name: 'minimax',

  async text(req: TextRequest): Promise<ProviderResult<string | object>> {
    throwIfCancelled(req.signal, 'text');
    const ladder = readLadder('MINIMAX_TEXT_LADDER', [
      process.env.MINIMAX_TEXT_MODEL || 'MiniMax-M3',
      'MiniMax-M3.1-Flash',
      'MiniMax-M2.7',
    ]);
    if (req.model && /^MiniMax-M/i.test(req.model)) {
      const rest = ladder.filter((e) => e.model !== req.model);
      ladder.length = 0;
      ladder.push({ model: req.model }, ...rest);
    }

    const start = Date.now();
    const maxTokens = req.maxTokens ?? (req.json ? 8192 : 4096);
    const systemText = req.json
      ? `${req.system ? `${req.system}\n\n` : ''}Respond ONLY with valid raw JSON (no markdown code fences, no commentary).`
      : req.system;

    const run = await runModelLadder('minimax', 'text', ladder, async (entry) => {
      const data = await minimaxFetch(
        '/v1/chat/completions',
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
        throw new AiProviderError('minimax', 'text', `Empty completion from ${entry.model}`, 503);
      }
      return {
        output: req.json ? safeJsonParse(cleaned, 'text') : cleaned,
        usage: data?.usage,
      };
    });

    return {
      provider: 'minimax',
      model: run.modelUsed,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      output: run.result.output,
      ...extractUsage(run.result.usage),
    };
  },

  async image(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    throwIfCancelled(req.signal, 'image');
    const ladder = readLadder('MINIMAX_IMAGE_LADDER', [
      process.env.MINIMAX_IMAGE_MODEL || 'MiniMax-H3-Image',
      'MiniMax-H3-Image-Highspeed',
      'image-01',
    ]);
    if (req.model && /^(MiniMax-H3-Image|image-01)/i.test(req.model)) {
      const rest = ladder.filter((e) => e.model !== req.model);
      ladder.length = 0;
      ladder.push({ model: req.model }, ...rest);
    }

    const start = Date.now();
    const ar = normalizeAspectRatio(req.aspectRatio);

    const run = await runModelLadder('minimax', 'image', ladder, async (entry) => {
      if (/^image-01$/i.test(entry.model)) {
        const data = await minimaxFetch(
          '/v1/image_generation',
          {
            model: 'image-01',
            prompt: req.prompt,
            aspect_ratio: ar,
            response_format: 'url',
            n: 1,
          },
          { timeoutMs: IMAGE_TIMEOUT_MS, signal: req.signal, task: 'image' },
        );
        const url = data?.data?.image_urls?.[0];
        const b64 = data?.data?.image_base64?.[0];
        if (!url && !b64) {
          throw new AiProviderError('minimax', 'image', 'Empty image-01 response', 503);
        }
        return { url, b64, usage: data?.usage };
      }

      const data = await minimaxFetch(
        '/v1/images/generations',
        {
          model: entry.model,
          prompt: req.prompt,
          aspect_ratio: ar,
          n: 1,
          response_format: 'url',
        },
        { timeoutMs: IMAGE_TIMEOUT_MS, signal: req.signal, task: 'image' },
      );
      const url = data?.data?.[0]?.url;
      const b64 = data?.data?.[0]?.b64_json;
      if (!url && !b64) {
        throw new AiProviderError('minimax', 'image', `Empty ${entry.model} image response`, 503);
      }
      return { url, b64, usage: data?.usage };
    });

    return {
      provider: 'minimax',
      model: run.modelUsed,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      output: run.result.b64 ? { base64: run.result.b64 } : { url: run.result.url },
      ...extractUsage(run.result.usage),
    };
  },

  async imageEdit(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    throwIfCancelled(req.signal, 'image_edit');
    if (!req.imageBase64) {
      throw new AiProviderError('minimax', 'imageEdit', 'imageBase64 is required for imageEdit', 400);
    }

    const ladder = readLadder('MINIMAX_IMAGE_EDIT_LADDER', [
      process.env.MINIMAX_IMAGE_MODEL || 'MiniMax-H3-Image',
      'MiniMax-H3-Image-Highspeed',
      'image-01',
    ]);
    if (req.model && /^(MiniMax-H3-Image|image-01)/i.test(req.model)) {
      const rest = ladder.filter((e) => e.model !== req.model);
      ladder.length = 0;
      ladder.push({ model: req.model }, ...rest);
    }

    const start = Date.now();
    const primary = await ensureMinImageB64(req.imageBase64, req.mimeType || 'image/png');
    const primaryDataUrl = `data:${primary.mime};base64,${primary.b64}`;

    const images: { image_url: string }[] = [{ image_url: primaryDataUrl }];
    const roleHints: string[] = [];
    const extraRefs = (req.referenceImages || []).filter((r) => r?.base64 && r?.mimeType).slice(0, 7);
    if (extraRefs.length > 0) {
      roleHints.push('<Picture 1> is the BASE IMAGE to edit.');
      for (let i = 0; i < extraRefs.length; i++) {
        const norm = await ensureMinImageB64(extraRefs[i].base64, extraRefs[i].mimeType);
        images.push({ image_url: `data:${norm.mime};base64,${norm.b64}` });
        roleHints.push(refRoleInstruction(i + 2, extraRefs[i].role));
      }
    }
    const editPrompt = roleHints.length > 0
      ? `${roleHints.join(' ')}\n\n${req.prompt}`
      : req.prompt;

    const run = await runModelLadder('minimax', 'image_edit', ladder, async (entry) => {
      if (/^image-01$/i.test(entry.model)) {
        const data = await minimaxFetch(
          '/v1/image_generation',
          {
            model: 'image-01',
            prompt: req.prompt,
            aspect_ratio: normalizeAspectRatio(req.aspectRatio),
            response_format: 'url',
            n: 1,
            subject_reference: [{ type: 'character', image_file: primaryDataUrl }],
          },
          { timeoutMs: IMAGE_TIMEOUT_MS, signal: req.signal, task: 'image_edit' },
        );
        const url = data?.data?.image_urls?.[0];
        if (!url) throw new AiProviderError('minimax', 'imageEdit', 'Empty image-01 edit response', 503);
        return { url, usage: data?.usage };
      }

      const data = await minimaxFetch(
        '/v1/images/edits',
        {
          model: entry.model,
          prompt: editPrompt,
          images,
          response_format: 'url',
        },
        { timeoutMs: IMAGE_TIMEOUT_MS, signal: req.signal, task: 'image_edit' },
      );
      const url = data?.data?.[0]?.url;
      const b64 = data?.data?.[0]?.b64_json;
      if (!url && !b64) {
        throw new AiProviderError('minimax', 'imageEdit', `Empty ${entry.model} image-edit response`, 503);
      }
      return { url, b64, usage: data?.usage };
    });

    return {
      provider: 'minimax',
      model: run.modelUsed,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      output: run.result.b64 ? { base64: run.result.b64 } : { url: run.result.url },
      ...extractUsage(run.result.usage),
    };
  },

  async video(req: VideoRequest): Promise<ProviderResult<{ url: string }>> {
    throwIfCancelled(req.signal, 'video');
    const ladder = readLadder('MINIMAX_VIDEO_LADDER', [
      process.env.MINIMAX_VIDEO_MODEL || 'MiniMax-H3',
      'MiniMax-H3-Max',
    ]);
    if (req.model && /^(MiniMax-H3|MiniMax-Hailuo)/i.test(req.model)) {
      const rest = ladder.filter((e) => e.model !== req.model);
      ladder.length = 0;
      ladder.push({ model: req.model }, ...rest);
    }

    const start = Date.now();
    const startB64 = req.startImageBase64 || req.imageBase64;
    const startMime = req.startMimeType || req.mimeType || 'image/png';
    const endB64 = req.endImageBase64;
    const endMime = req.endMimeType || 'image/png';
    const refs = (req.referenceImages || []).filter((r) => r?.base64 && r?.mimeType).slice(0, 3);

    const cleanedPrompt = req.prompt
      .replace(/^\s*(?:\d+:\d+\s+(?:square|vertical|portrait|widescreen|landscape|cinematic)\s+aspect\s+ratio\.?\s*)/i, '')
      .trim() || req.prompt;

    const content: any[] = [{ type: 'text', text: cleanedPrompt }];
    if (startB64) {
      const normStart = await ensureMinImageB64(startB64, startMime);
      content.push({
        type: 'image_url',
        image_url: { url: `data:${normStart.mime};base64,${normStart.b64}` },
        role: 'first_frame',
      });
      if (endB64) {
        const normEnd = await ensureMinImageB64(endB64, endMime);
        content.push({
          type: 'image_url',
          image_url: { url: `data:${normEnd.mime};base64,${normEnd.b64}` },
          role: 'last_frame',
        });
      }
    } else if (refs.length > 0) {
      for (const ref of refs) {
        const normRef = await ensureMinImageB64(ref.base64, ref.mimeType);
        content.push({
          type: 'image_url',
          image_url: { url: `data:${normRef.mime};base64,${normRef.b64}` },
          role: 'reference_image',
        });
      }
    }

    const hasFrameAnchor = Boolean(startB64 || endB64);
    const ratio = hasFrameAnchor ? 'adaptive' : (req.aspectRatio === '9:16' ? '9:16' : '16:9');
    const duration = Math.min(Math.max(Math.round(req.durationSeconds || 6), 4), 15);

    let billedSuffix = '';
    let taskUsage: any;

    const run = await runModelLadder('minimax', 'video', ladder, async (entry) => {
      const isMax = /max/i.test(entry.model);
      const wantsHiRes = req.resolution === '1080p' || req.resolution === '4k';
      // MiniMax-H3 supports 768P ($0.08/s) and 2K ($0.13/s, mapped to :1080p HD tier).
      // MiniMax-H3-Max supports 480P and 768P.
      const apiResolution = isMax ? '768P' : (wantsHiRes ? '2K' : '768P');
      billedSuffix = (!isMax && wantsHiRes) ? ':1080p' : '';

      const submitted = await minimaxFetch(
        '/v2/video_generation',
        {
          model: entry.model,
          content,
          resolution: apiResolution,
          duration,
          ratio,
        },
        { timeoutMs: 60000, signal: req.signal, task: 'video' },
      );

      const taskId = submitted?.task_id || submitted?.task?.id;
      if (!taskId) {
        throw new AiProviderError('minimax', 'video', `${entry.model} submit missing task_id: ${JSON.stringify(submitted).slice(0, 200)}`, 502);
      }

      const deadline = Date.now() + VIDEO_BUDGET_MS;
      while (Date.now() < deadline) {
        throwIfCancelled(req.signal, 'video');
        await new Promise((r) => setTimeout(r, 5000));
        throwIfCancelled(req.signal, 'video');

        const poll = await minimaxFetch(
          `/v2/query/video_generation/${encodeURIComponent(String(taskId))}`,
          undefined,
          { method: 'GET', timeoutMs: 30000, signal: req.signal, task: 'video' },
        );

        const taskObj = poll?.task || poll;
        const status = String(taskObj?.status || '').toLowerCase();
        if (status === 'succeeded' || status === 'success') {
          const remoteUrl = taskObj?.content?.url || taskObj?.video_url || poll?.video_url;
          if (!remoteUrl) {
            throw new AiProviderError('minimax', 'video', `${entry.model} succeeded without video URL`, 502);
          }
          taskUsage = taskObj?.usage;
          return String(remoteUrl);
        }
        if (status === 'failed' || status === 'fail' || status === 'canceled' || status === 'cancelled' || status === 'expired') {
          const errDetail = taskObj?.error?.message || taskObj?.status_msg || poll?.base_resp?.status_msg || status;
          throw new AiProviderError('minimax', 'video', `${entry.model} video ${status}: ${String(errDetail).slice(0, 200)}`);
        }
      }
      throw new AiProviderError('minimax', 'video', `${entry.model} poll timeout after ${Math.round(VIDEO_BUDGET_MS / 1000)}s`, 504);
    });

    // Persist MP4 to local storage so 24h CDN URLs never expire and CSP ('self') allows <video>.
    let finalUrl = run.result;
    try {
      const dl = await fetch(run.result, { signal: AbortSignal.timeout(120000) });
      if (dl.ok) {
        const buf = Buffer.from(await dl.arrayBuffer());
        const saved = await storageService.saveFile(
          buf,
          `${run.modelUsed.replace(/[^a-z0-9.-]+/gi, '-')}-${Date.now()}.mp4`,
          'video/mp4',
        );
        finalUrl = saved.fileUrl;
      }
    } catch (e: any) {
      console.warn(`[minimax/video] persist failed (${e?.message}); returning remote url`);
    }

    const billedModel = `${run.modelUsed}${billedSuffix}`;
    return {
      provider: 'minimax',
      model: billedModel,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      output: { url: finalUrl },
      // The clip MiniMax actually rendered: the request is clamped to 4-15s
      // and defaults to 6s, while the router would otherwise bill the asked
      // length (or 8s when none was given: 33% over on every default clip).
      durationSeconds: duration,
      ...extractUsage(taskUsage),
    };
  },

  async analysis(_req: AnalysisRequest): Promise<never> {
    throw new AiProviderError('minimax', 'analysis', 'MiniMax vision analysis falls through to multimodal providers', 503);
  },
};
