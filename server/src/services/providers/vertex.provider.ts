// Google Vertex AI (Agent Platform) provider.
//
// Added 2026-11-07. The Gemini Developer API key we held is billing-dead
// ("Your prepayment credits are depleted" / 402 on EVERY model, both keys),
// but the Vertex / Agent Platform entitlement on the same Google Cloud
// project is fully funded: text, image, image-edit and analysis all answer
// 200 (verified live 2026-11-07 against project hubz-510406).
//
// WHY RAW fetch AND NOT @google/genai:
//   The SDK refuses to accept project/location together with an apiKey —
//   "Project/location and API key are mutually exclusive in the client
//   initializer" — and the documented workaround needs three ambient env
//   vars (GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_LOCATION /
//   GOOGLE_GENAI_USE_VERTEXAI). Raw fetch needs one key and one URL, and
//   keeps the call shape explicit.
//
// WHY THE HOST IS GLOBAL:
//   The location lives in the PATH, not the host. `us-aiplatform.googleapis.com`
//   answers 400 "Invalid hostname" and `us-central1-aiplatform.googleapis.com`
//   answers 404. The working URL is
//     https://aiplatform.googleapis.com/v1/projects/<p>/locations/<loc>/publishers/google/models/<id>:generateContent
//   with header `x-goog-api-key`.
//
// WHY THERE IS NO video():
//   Vertex serves NO video model. Every veo-* id 404s and
//   gemini-omni-flash-preview is Interactions-API-only (Developer API, 402).
//   video() throws a clear error so the ai-router falls through to the next
//   provider instead of hanging on a model that can never answer.
//
// EMBEDDINGS ARE DELIBERATELY NOT USED HERE:
//   Vertex's gemini-embedding-001 returns 3072 dims — the SAME count as our
//   stored vectors — so the STORED_EMBED_DIMS guard cannot detect the swap.
//   Measured against real prod chunk rows (2026-11-07):
//     cos(stored, vertex-same-text)      = 0.0090 – 0.0231
//     cos(stored, vertex-unrelated-text) ≈ 0
//   i.e. Vertex's embedding space is ORTHOGONAL to the space that wrote our
//   3,450 chunk vectors (gemini-embedding-2-preview, Developer API, now 402).
//   Pointing RAG at it would silently serve UNRANKED chunks — the exact
//   2026-11-05 bug. If a Vertex re-embed ever happens it must be a FULL store
//   migration (every chunk + memory rewritten in one run, old vectors
//   discarded), never a partial flip. Do not add an embed() to this file.

import type {
  AiProvider, AnalysisRequest, ImageRequest, ProviderResult, TextRequest, VideoRequest,
} from './types.js';
import { AiProviderError, AiCancelledError, abortReasonText, throwIfCancelled } from './errors.js';
import { runModelLadder, readLadder } from './model-chain.js';

const API_KEY = process.env.VERTEX_API_KEY || '';
const PROJECT = process.env.VERTEX_PROJECT || 'hubz-510406';
const LOCATION = process.env.VERTEX_LOCATION || 'us';
const HOST = process.env.VERTEX_HOST || 'https://aiplatform.googleapis.com';
const TIMEOUT = parseInt(process.env.VERTEX_TIMEOUT_MS || '90000', 10);
const IMAGE_TIMEOUT = parseInt(process.env.VERTEX_IMAGE_TIMEOUT_MS || '180000', 10);

// Model ladders. A pinned model (the Creative Studio picker) wins over the
// ladder head, the same way gemini.provider.ts honours req.model.
const TEXT_LADDER = [
  process.env.VERTEX_TEXT_MODEL || 'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-4-argon',
];
const IMAGE_LADDER = [
  process.env.VERTEX_IMAGE_MODEL || 'gemini-nano-banana-2.1',
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
];
const IMAGE_EDIT_LADDER = [
  process.env.VERTEX_IMAGE_EDIT_MODEL || 'gemini-nano-banana-2.1',
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
];
const ANALYSIS_MODEL = process.env.VERTEX_ANALYSIS_MODEL || 'gemini-3.8-flash';

// Retry budget. Only 429 (quota) and 5xx (transient) are worth a backoff.
const RETRY_BACKOFFS_MS = [500, 1500];

function modelUrl(model: string): string {
  return `${HOST}/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${model}:generateContent`;
}

function requireKey(): string {
  if (!API_KEY) throw new AiProviderError('vertex', 'init', 'VERTEX_API_KEY not set', 401);
  return API_KEY;
}

// ─── Request helpers ───────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AiProviderError('vertex', label, `timeout after ${ms}ms`)), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }).catch(e => { clearTimeout(timer); reject(e); });
  });
}

// Abortable attempt: cancels the request itself (not just the wait) so a
// timed-out rung does not keep running in the background and burn quota.
async function abortableAttempt<T>(
  label: string,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  throwIfCancelled(callerSignal, label);
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
  const onCallerAbort = () => ctl.abort();
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  const abortedP = new Promise<never>((_, reject) => {
    ctl.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  try {
    return await Promise.race([run(ctl.signal), abortedP]);
  } catch (err) {
    if (callerSignal?.aborted) throw new AiCancelledError(label, abortReasonText(callerSignal));
    if (timedOut) throw new AiProviderError('vertex', label, `timeout after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

// Transient = 429 (quota) + 5xx ONLY. A 400/401/403/404 is permanent and
// must NOT be retried — it would burn the whole ladder on a bad request.
function isVertexTransient(err: unknown): boolean {
  const status = (err as any)?.status ?? (err as any)?.statusCode;
  if (status === 429 || status === 503 || status === 500 || status === 502) return true;
  if (status && status >= 400 && status < 500) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /429|resource exhausted|rate.?limit|too many requests|503|502|500|internal error|try again later|unavailable|overloaded/i.test(msg);
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof AiCancelledError || !isVertexTransient(err) || attempt === RETRY_BACKOFFS_MS.length) throw err;
      const wait = RETRY_BACKOFFS_MS[attempt];
      const reason = err instanceof Error ? err.message.slice(0, 80) : String(err).slice(0, 80);
      console.warn(`[vertex/${label}] transient (attempt ${attempt + 1}/${RETRY_BACKOFFS_MS.length + 1}); backoff ${wait}ms — ${reason}`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// POST one generateContent call. Returns the parsed body or throws.
async function callGenerate(model: string, body: any, signal: AbortSignal, label: string): Promise<any> {
  const key = requireKey();
  const res = await fetch(modelUrl(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j?.error?.message || JSON.stringify(j?.error || text);
    } catch { /* keep raw text */ }
    throw new AiProviderError('vertex', label, `HTTP ${res.status}: ${String(msg).slice(0, 300)}`, res.status);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AiProviderError('vertex', label, `unparseable response: ${text.slice(0, 200)}`);
  }
}

// ─── Response reading ──────────────────────────────────────────────

/**
 * Vertex returns THOUGHT parts alongside the real answer. A part with
 * `thought: true` is the model's internal reasoning and must NOT be shown to
 * the user or parsed as the answer (verified live 2026-11-07: an image call
 * returned 2 thought parts + 2 real parts; a text call returned a thought
 * part carrying a thoughtSignature).
 */
function realParts(response: any): any[] {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return [];
  return parts.filter((p: any) => p && !p.thought);
}

function textOf(response: any): string {
  return realParts(response)
    .filter((p: any) => typeof p.text === 'string')
    .map((p: any) => p.text)
    .join('');
}

// Usage metadata. Vertex reports candidatesTokenCount + thoughtsTokenCount.
function usageOf(response: any): { promptTokens?: number; completionTokens?: number; totalTokens?: number } {
  const u = response?.usageMetadata;
  if (!u) return {};
  const p = u.promptTokenCount;
  const c = u.candidatesTokenCount;
  const t = u.totalTokenCount ?? (((p ?? 0) + (c ?? 0)) || undefined);
  return {
    ...(typeof p === 'number' ? { promptTokens: p } : {}),
    ...(typeof c === 'number' ? { completionTokens: c } : {}),
    ...(typeof t === 'number' ? { totalTokens: t } : {}),
  };
}

// The generationConfig we send on every call.
//
// thinkingConfig.thinkingBudget = 0 disables the thinking pass: without it
// gemini-3.8-flash burned 94-100 tokens on reasoning for a 1-token answer,
// and a 32-token maxOutputTokens was consumed ENTIRELY by thinking (the
// response came back finishReason=MAX_TOKENS with NO text part — verified
// live 2026-11-07). Disabling it is what makes a small budget safe.
//
// Note: gemini-4-argon does NOT accept thinkingBudget (400). It is last in
// the ladder and only reached when everything cheaper is exhausted.
function generationConfig(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    maxOutputTokens: 8192,
    thinkingConfig: { thinkingBudget: 0 },
    ...extra,
  };
}

// The base image + prompt + role-labelled refs layout mirrors
// gemini.provider.ts's imageEdit so both providers accept the same payload.
function refRoleLabel(role?: 'content' | 'style' | 'character'): string {
  switch (role) {
    case 'style':     return 'STYLE REFERENCE — apply this image\'s visual style (color palette, lighting, texture, mood) but NOT its subject matter:';
    case 'character': return 'CHARACTER/PRODUCT REFERENCE — keep this exact subject\'s identity, shape, and key features consistent in the output:';
    case 'content':   return 'CONTENT/COMPOSITION REFERENCE — follow this image\'s layout and composition:';
    default:          return 'REFERENCE IMAGE — use as visual guidance:';
  }
}

// JSON-mode responses are occasionally truncated. The same repair the Gemini
// provider uses keeps a partial payload from poisoning the caller's parser.
function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/[\[{][\s\S]*[\]}]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    throw new AiProviderError('vertex', 'json', `JSON parse failed. Response: ${text.slice(0, 200)}`);
  }
}

// A Gemini-shaped id only. A DashScope/xAI id falling through the chain to
// us must NOT be forwarded — Vertex would 404 on it.
// Which model ids this provider is willing to SERVE. A pinned model that
// belongs to another provider must be refused, not forwarded: Vertex would
// answer 404 "model not found" and the request would fall through the whole
// chain for nothing.
//
// The list is Google's model families ONLY. Qwen is deliberately absent even
// though the picker knows it: Qwen lives on Alibaba, and forwarding
// "qwen-image-3.0-pro" to a Google endpoint is a guaranteed 404.
function isVertexModelId(id: string | undefined): boolean {
  return !!id && /^(gemini|imagen|veo|nano|palm|bison|codey|learnlm|medlm)/i.test(id);
}

export const vertexProvider: AiProvider = {
  name: 'vertex',

  async text(req: TextRequest): Promise<ProviderResult<string | object>> {
    const ladder = readLadder('VERTEX_TEXT_LADDER', TEXT_LADDER);
    if (req.model && isVertexModelId(req.model)) ladder.unshift({ model: req.model });

    const start = Date.now();
    const temperature = typeof req.temperature === 'number' && Number.isFinite(req.temperature)
      ? Math.min(Math.max(req.temperature, 0), 2) : undefined;

    const result = await runModelLadder('vertex', 'text', ladder, async (entry) => {
      const body: any = {
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: generationConfig({
          ...(req.json ? { responseMimeType: 'application/json' } : {}),
          ...(temperature !== undefined ? { temperature } : {}),
          ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
        }),
      };
      // systemInstruction is a top-level field, not part of contents.
      if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };

      const response = await withRetry('text', () => abortableAttempt(
        'text', req.timeoutMs ?? TIMEOUT, req.signal,
        (signal) => callGenerate(entry.model, body, signal, 'text'),
      ));
      // Truncation guard: a JSON response cut off at the token cap parses as
      // malformed downstream. Surface it as a retryable error so the ladder
      // advances instead of poisoning the JSON parse.
      if (req.json && response?.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
        throw new AiProviderError('vertex', 'text', 'output truncated at the token cap (MAX_TOKENS) — response too large');
      }
      return response;
    });

    const model = result.modelUsed;
    const text = textOf(result.result);
    return {
      provider: 'vertex', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: req.json ? safeJsonParse(text || '{}') : text,
      ...usageOf(result.result),
    };
  },

  async image(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    const ladder = readLadder('VERTEX_IMAGE_LADDER', IMAGE_LADDER);
    if (req.model && isVertexModelId(req.model)) ladder.unshift({ model: req.model });

    // Ultra means high-res by default (2K) unless the caller asked for a
    // specific size — the same rule the Gemini provider applies, so the
    // Creative Studio "Ultra" button renders an 2K frame on both routes
    // instead of silently producing the default size.
    const effectiveSize = req.imageSize || (req.quality === 'ultra' ? '2K' : undefined);

    const start = Date.now();
    const result = await runModelLadder('vertex', 'image', ladder, async (entry) => {
      const imageConfig: Record<string, unknown> = {};
      if (req.aspectRatio) imageConfig.aspectRatio = req.aspectRatio;
      if (effectiveSize) imageConfig.imageSize = effectiveSize;
      const body = {
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: generationConfig({
          responseModalities: ['TEXT', 'IMAGE'],
          ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
        }),
      };
      const response = await withRetry('image', () => abortableAttempt(
        'image', IMAGE_TIMEOUT, req.signal,
        (signal) => callGenerate(entry.model, body, signal, 'image'),
      ));
      const part = realParts(response).find((p: any) => p.inlineData || p.inline_data);
      const inline = part?.inlineData || part?.inline_data;
      const b64 = inline?.data;
      if (!b64) {
        const finish = response?.candidates?.[0]?.finishReason || 'unknown';
        const safety = /RECITATION|SAFETY|PROHIBITED|IMAGE_RECITATION|SPII|BLOCK/i.test(String(finish))
          || response?.promptFeedback?.blockReason;
        throw new AiProviderError(
          'vertex', 'image',
          safety
            ? `generation declined by Vertex (${finish}) — content policy refused this prompt`
            : `empty image response (finishReason=${finish})`,
          safety ? 400 : 503,
        );
      }
      return { response, b64 };
    });

    const model = result.modelUsed;
    return {
      provider: 'vertex', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: { base64: result.result.b64 },
      ...usageOf(result.result.response),
    };
  },

  async imageEdit(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    const ladder = readLadder('VERTEX_IMAGE_EDIT_LADDER', IMAGE_EDIT_LADDER);
    if (req.model && isVertexModelId(req.model)) ladder.unshift({ model: req.model });

    const start = Date.now();
    const parts: any[] = [];
    if (req.imageBase64 && req.mimeType) {
      if ((req.referenceImages || []).some(r => r.role)) parts.push({ text: 'BASE IMAGE to edit:' });
      parts.push({ inlineData: { mimeType: req.mimeType, data: req.imageBase64 } });
    }
    for (const ref of req.referenceImages || []) {
      if (ref.role) parts.push({ text: refRoleLabel(ref.role) });
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
    }
    parts.push({ text: req.prompt });

    const imageConfig: Record<string, unknown> = {};
    if (req.aspectRatio) imageConfig.aspectRatio = req.aspectRatio;
    if (req.imageSize) imageConfig.imageSize = req.imageSize;

    const result = await runModelLadder('vertex', 'image_edit', ladder, async (entry) => {
      const body = {
        contents: [{ role: 'user', parts }],
        generationConfig: generationConfig({
          responseModalities: ['TEXT', 'IMAGE'],
          ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
        }),
      };
      const response = await withRetry('imageEdit', () => abortableAttempt(
        'imageEdit', IMAGE_TIMEOUT, req.signal,
        (signal) => callGenerate(entry.model, body, signal, 'imageEdit'),
      ));
      const part = realParts(response).find((p: any) => p.inlineData || p.inline_data);
      const b64 = (part?.inlineData || part?.inline_data)?.data;
      if (!b64) {
        const finish = response?.candidates?.[0]?.finishReason || 'unknown';
        const safety = /RECITATION|SAFETY|PROHIBITED|IMAGE_RECITATION|SPII|BLOCK/i.test(String(finish))
          || response?.promptFeedback?.blockReason;
        throw new AiProviderError(
          'vertex', 'imageEdit',
          safety
            ? `edit declined by Vertex (${finish}) — content/reference policy refused this edit`
            : `empty image-edit response (finishReason=${finish})`,
          safety ? 400 : 503,
        );
      }
      return { response, b64 };
    });

    const model = result.modelUsed;
    return {
      provider: 'vertex', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: { base64: result.result.b64 },
      ...usageOf(result.result.response),
    };
  },

  async video(_req: VideoRequest): Promise<ProviderResult<{ url: string }>> {
    // Vertex serves NO video model (every veo-* id 404s; omni is
    // Interactions-API-only and the Developer API is 402). Throwing here lets
    // the ai-router fall through to the next provider instead of hanging on a
    // model that can never answer.
    throw new AiProviderError(
      'vertex', 'video',
      'no Vertex video engine (veo-* is not served on Vertex; gemini-omni-flash-preview is Developer-API only)',
      404,
    );
  },

  async analysis(req: AnalysisRequest): Promise<ProviderResult<object>> {
    const start = Date.now();
    const response = await withRetry('analysis', () => abortableAttempt(
      'analysis', TIMEOUT, req.signal,
      (signal) => callGenerate(ANALYSIS_MODEL, {
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: req.mimeType, data: req.imageBase64 } },
            { text: req.prompt },
          ],
        }],
        generationConfig: generationConfig({ responseMimeType: 'application/json' }),
      }, signal, 'analysis'),
    ));
    return {
      provider: 'vertex', model: ANALYSIS_MODEL, latencyMs: Date.now() - start, fallbackUsed: false,
      output: safeJsonParse(textOf(response) || '{}'),
      ...usageOf(response),
    };
  },
};
