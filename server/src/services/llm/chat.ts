// Chat-with-fallback — single helper used by every LLM consumer (assistant
// route, agent loop, agent tools).  Tries providers in order; returns the
// first one that succeeds.  Logs each failure but only throws if the entire
// chain is exhausted.
//
// 2026-04-23: Weni's directive — Gemini is the PRIMARY provider because the
// API key is billed to the Radix company card.  Grok secondary, Kimi K2
// tertiary.  Override per-call by passing a custom chain.
//
// 2026-04-23 (pm): Google's OpenAI-compat shim now exposes the full Gemini 3
// family (gemini-3-flash-preview, gemini-3.1-pro-preview, -flash-lite, etc.)
// Verified live at /v1beta/openai/models.  GEMINI_CHAT_MODEL defaults to
// gemini-3-flash-preview (thinking model, 1M context, $1/$6 per 1M).
// Native @google/genai SDK path in gemini.provider.ts stays on 3.1-pro for
// analyze/video.
//
// Every provider exposes the OpenAI Chat Completions surface:
//   - Gemini: https://generativelanguage.googleapis.com/v1beta/openai/
//   - xAI:    https://api.x.ai/v1
//   - Kimi:   https://api.moonshot.ai/v1
// so the same `client.chat.completions.create(...)` call works for all
// three.  Stream + tool-use + JSON mode are supported by all three.
//
// THINKING-MODEL HAZARD: Gemini 3 + Kimi K2.6 + Gemini 2.5 Pro burn tokens on
// reasoning_content BEFORE emitting `content`.  A max_tokens of 16 can come
// back with empty content + finish_reason=length.  Caller must pass
// max_tokens ≥ 1024 or accept that reasoning may consume the whole budget.
// chatText() falls back to `reasoning_content` when `content` is empty so
// the text always reflects SOMETHING the model produced.

import OpenAI from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletion,
  ChatCompletionChunk,
} from 'openai/resources/chat/completions';

export type ProviderName = 'gemini' | 'xai' | 'moonshot';

export interface ProviderClient {
  client: OpenAI;
  model: string;
  provider: ProviderName;
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const XAI_BASE = process.env.XAI_BASE_URL || 'https://api.x.ai/v1';
const MOONSHOT_BASE = process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1';

const cache = new Map<ProviderName, OpenAI>();

function clientFor(p: ProviderName): ProviderClient {
  let cached = cache.get(p);
  if (p === 'gemini') {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY missing');
    if (!cached) {
      cached = new OpenAI({ apiKey: key, baseURL: GEMINI_BASE });
      cache.set(p, cached);
    }
    // GEMINI_CHAT_MODEL drives the OpenAI-compat path (this file).
    // Default is gemini-3-flash-preview — thinking model, 1M ctx, fn-calling
    // + structured outputs.  Native SDK path (gemini.provider.ts → analyze +
    // image) uses GEMINI_TEXT_MODEL = gemini-3.1-pro-preview separately.
    const model = process.env.GEMINI_CHAT_MODEL || 'gemini-3-flash-preview';
    return { client: cached, model, provider: p };
  }
  if (p === 'xai') {
    const key = process.env.XAI_API_KEY;
    if (!key) throw new Error('XAI_API_KEY missing');
    if (!cached) {
      cached = new OpenAI({ apiKey: key, baseURL: XAI_BASE });
      cache.set(p, cached);
    }
    return { client: cached, model: process.env.XAI_TEXT_MODEL || 'grok-4-fast-reasoning', provider: p };
  }
  // moonshot
  const key = process.env.MOONSHOT_API_KEY;
  if (!key) throw new Error('MOONSHOT_API_KEY missing');
  if (!cached) {
    cached = new OpenAI({ apiKey: key, baseURL: MOONSHOT_BASE });
    cache.set(p, cached);
  }
  return { client: cached, model: process.env.MOONSHOT_MODEL || 'kimi-k2-turbo-preview', provider: p };
}

// Default chain — Gemini PRIMARY (Radix company-card key), Grok fallback,
// Kimi tertiary.  Override per-call when a feature has a different routing
// preference (e.g. agent orchestrator wants the model named in AGENT_MODEL).
export const DEFAULT_CHAIN: ProviderName[] = ['gemini', 'xai', 'moonshot'];

function resolveChain(env: string | undefined, fallbackChain: ProviderName[] = DEFAULT_CHAIN): ProviderName[] {
  if (!env) return fallbackChain;
  const parsed = env.split(',').map((s) => s.trim()).filter(Boolean) as ProviderName[];
  return parsed.length ? parsed : fallbackChain;
}

interface FallbackResult<T> {
  result: T;
  provider: ProviderName;
  model: string;
  fallbackUsed: boolean;
  attempts: Array<{ provider: ProviderName; error: string }>;
}

// HTTP status codes that warrant a retry on the SAME provider before
// dropping to the fallback (transient throttle/server-side glitch).
// 503 = "high demand" Google throttle on gemini-3.1-pro-preview.  429 =
// rate-limit (xAI / Kimi).  These are NOT model-availability problems —
// retrying with backoff lets Gemini stay primary so we don't waste fallback
// budget on transient spikes.  4xx other than 429 = client error, no retry.
function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; code?: string | number; message?: string };
  if (e.status === 503 || e.status === 429) return true;
  // OpenAI SDK exposes status sometimes as `code` for legacy errors
  if (e.code === 503 || e.code === 429) return true;
  const msg = (e.message || '').toLowerCase();
  return msg.includes('high demand') || msg.includes('overloaded') ||
         msg.includes('rate limit') || msg.includes('try again later');
}

const RETRY_BACKOFFS_MS = [400, 1200, 3500]; // ~5s total upper bound

async function tryWithBackoff<T>(p: ProviderName, fn: (ctx: ProviderClient) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    try {
      const ctx = clientFor(p);
      return await fn(ctx);
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err) || attempt === RETRY_BACKOFFS_MS.length) throw err;
      const wait = RETRY_BACKOFFS_MS[attempt];
      console.warn(`[llm-fallback] ${p} transient (attempt ${attempt + 1}); backoff ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// Generic try-each-in-order helper. The caller decides what to do with the
// client/model (chat completion non-streaming, streaming, tool-use, etc).
// Each provider gets up to 4 attempts (1 initial + 3 backoffs) on transient
// 503/429 BEFORE rolling to the next provider.  Hard errors (401, 404, 400)
// fall through immediately.
export async function withFallback<T>(
  fn: (ctx: ProviderClient) => Promise<T>,
  options: { chain?: ProviderName[]; chainEnv?: string } = {},
): Promise<FallbackResult<T>> {
  const chain = resolveChain(options.chainEnv, options.chain ?? DEFAULT_CHAIN);
  const attempts: Array<{ provider: ProviderName; error: string }> = [];
  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    try {
      const result = await tryWithBackoff(p, fn);
      const ctx = clientFor(p);
      return { result, provider: ctx.provider, model: ctx.model, fallbackUsed: i > 0, attempts };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attempts.push({ provider: p, error: msg.slice(0, 300) });
      console.error(`[llm-fallback] ${p} failed (${i + 1}/${chain.length}): ${msg.slice(0, 200)}`);
    }
  }
  const summary = attempts.map((a) => `${a.provider}:${a.error.slice(0, 80)}`).join(' | ');
  throw new Error(`All providers failed: ${summary}`);
}

// Sugar: non-streaming chat completion with fallback. Returns text + meta.
export interface ChatTextResult {
  text: string;
  provider: ProviderName;
  model: string;
  latencyMs: number;
  fallbackUsed: boolean;
}

export async function chatText(
  params: Omit<ChatCompletionCreateParamsNonStreaming, 'model' | 'stream'>,
  options?: { chain?: ProviderName[]; chainEnv?: string },
): Promise<ChatTextResult> {
  const start = Date.now();
  const out = await withFallback(async ({ client, model }) => {
    const r: ChatCompletion = await client.chat.completions.create({ ...params, model, stream: false });
    const choice = r.choices?.[0]?.message as
      | { content?: string | null; reasoning_content?: string | null }
      | undefined;
    let text = choice?.content ?? '';
    if (!text && choice?.reasoning_content) text = choice.reasoning_content;
    return text;
  }, options);
  return {
    text: out.result,
    provider: out.provider,
    model: out.model,
    latencyMs: Date.now() - start,
    fallbackUsed: out.fallbackUsed,
  };
}

// Sugar: streaming chat completion with fallback. Returns the live stream
// from the first provider that DIDN'T immediately reject. Once the stream
// is yielding chunks we don't switch providers (mid-stream switch would
// drop partial output + duplicate work). Caller iterates as usual.
export async function chatStream(
  params: Omit<ChatCompletionCreateParamsStreaming, 'model' | 'stream'>,
  options?: { chain?: ProviderName[]; chainEnv?: string; signal?: AbortSignal },
): Promise<{
  stream: AsyncIterable<ChatCompletionChunk>;
  provider: ProviderName;
  model: string;
  fallbackUsed: boolean;
}> {
  const out = await withFallback(async ({ client, model }) => {
    const stream = await client.chat.completions.create(
      { ...params, model, stream: true },
      { signal: options?.signal },
    );
    return stream;
  }, { chain: options?.chain, chainEnv: options?.chainEnv });
  return { stream: out.result, provider: out.provider, model: out.model, fallbackUsed: out.fallbackUsed };
}

// Diagnostic: which providers in the chain currently have credentials set.
export function chainStatus(chain: ProviderName[] = DEFAULT_CHAIN): Array<{ provider: ProviderName; configured: boolean; model: string }> {
  return chain.map((p) => {
    const envKey = p === 'gemini' ? 'GEMINI_API_KEY' : p === 'xai' ? 'XAI_API_KEY' : 'MOONSHOT_API_KEY';
    const modelEnv = p === 'gemini' ? (process.env.GEMINI_CHAT_MODEL || 'gemini-3-flash-preview')
      : p === 'xai' ? (process.env.XAI_TEXT_MODEL || 'grok-4-fast-reasoning')
      : (process.env.MOONSHOT_MODEL || 'kimi-k2-turbo-preview');
    return { provider: p, configured: !!process.env[envKey], model: modelEnv };
  });
}
