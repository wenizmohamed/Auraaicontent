// Chat-with-fallback — single helper used by every LLM consumer (assistant
// route, agent loop, agent tools).  Tries providers in order; returns the
// first one that succeeds.  Logs each failure but only throws if the entire
// chain is exhausted.
//
// 2026-04-23: Weni's directive — Gemini 3.1 Pro is the PRIMARY model
// everywhere because the API key is billed to the Radix company card.
// Grok is the secondary, Kimi K2 is the tertiary.  Override per-call by
// passing a custom chain.
//
// Every provider exposes the OpenAI Chat Completions surface:
//   - Gemini: https://generativelanguage.googleapis.com/v1beta/openai/
//   - xAI:    https://api.x.ai/v1
//   - Kimi:   https://api.moonshot.ai/v1
// so the same `client.chat.completions.create(...)` call works for all
// three.  Stream + tool-use + JSON mode are supported by all three (Gemini
// added them when they shipped the OpenAI-compat layer).

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
    // GEMINI_CHAT_MODEL is the OpenAI-compat-compatible name — Google's
    // OpenAI shim doesn't expose `gemini-3.1-pro-preview` (only the
    // 2.5 family).  Native SDK paths (gemini.provider.ts → analyze + image)
    // keep GEMINI_TEXT_MODEL = gemini-3.1-pro-preview separately.
    const model = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash';
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

// Generic try-each-in-order helper. The caller decides what to do with the
// client/model (chat completion non-streaming, streaming, tool-use, etc).
export async function withFallback<T>(
  fn: (ctx: ProviderClient) => Promise<T>,
  options: { chain?: ProviderName[]; chainEnv?: string } = {},
): Promise<FallbackResult<T>> {
  const chain = resolveChain(options.chainEnv, options.chain ?? DEFAULT_CHAIN);
  const attempts: Array<{ provider: ProviderName; error: string }> = [];
  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    try {
      const ctx = clientFor(p);
      const result = await fn(ctx);
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
    const modelEnv = p === 'gemini' ? (process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash')
      : p === 'xai' ? (process.env.XAI_TEXT_MODEL || 'grok-4-fast-reasoning')
      : (process.env.MOONSHOT_MODEL || 'kimi-k2-turbo-preview');
    return { provider: p, configured: !!process.env[envKey], model: modelEnv };
  });
}
