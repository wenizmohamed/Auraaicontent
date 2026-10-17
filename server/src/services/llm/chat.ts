// Chat-with-fallback — single helper used by every LLM consumer (assistant
// route, agent loop, agent tools).  Tries providers in order; returns the
// first one that succeeds.  Logs each failure but only throws if the entire
// chain is exhausted.
//
// 2026-10-17: Weni's directive — Alibaba DashScope (qwen3.8-max) is PRIMARY,
// Grok secondary, Gemini third, Kimi last. Override per-call by passing a
// custom chain (ASSISTANT_PROVIDER_CHAIN / AGENT_PROVIDER_CHAIN env).
//
// 2026-04-28: Models updated to current generation. GEMINI_CHAT_MODEL defaults
// to gemini-3.1-pro-preview. xAI defaults to grok-4.20. Kimi defaults to kimi-k2.6.
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
import { db } from '../../db/prisma.js';
import { computeCostUsd, isPriced } from '../../lib/ai-pricing.js';
import { assertOrgBudget } from '../../lib/budget.js';
import { enrichWithKnowledge } from '../../lib/knowledge-enricher.js';
import { enrichWithMemory } from '../../lib/memory-enricher.js';
import { enrichWithBrandKit } from '../../lib/brand-kit-enricher.js';
import { filterAvailable, recordSuccess, recordFailure } from '../providers/circuit-breaker.js';
import { isRetryableAiError, isSafetyBlock } from '../providers/errors.js';

export type ProviderName = 'gemini' | 'xai' | 'moonshot' | 'dashscope';

// RAG grounding for the chat stack. ai-router already enriches creative/text
// generation with the client's knowledge base + learned memory + brand kit;
// chat.ts (assistant/agent/research) did NOT — so the assistant, the app's
// most-used surface and the persistent-memory USP, answered ungrounded. This
// enriches the LAST user turn with the same three sources when a caller opts in
// (enrich:true) and an org+client are present. Best-effort: each enricher is a
// no-op when the client has no KB / the org has no learnings / no brand kit, so
// this can never make a message worse — only more grounded.
async function enrichLastUserTurn(
  messages: ChatCompletionCreateParamsNonStreaming['messages'],
  meta: UsageMeta | undefined,
): Promise<ChatCompletionCreateParamsNonStreaming['messages']> {
  if (!meta?.orgId || !meta?.clientId) return messages;
  // find the last user message with plain-string content (skip multimodal)
  let idx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && typeof messages[i].content === 'string') { idx = i; break; }
  }
  if (idx === -1) return messages;
  const original = messages[idx].content as string;
  if (!original.trim()) return messages;
  try {
    let enriched = await enrichWithKnowledge(original, meta.orgId, meta.clientId, original, {});
    enriched = await enrichWithMemory(enriched, meta.orgId, meta.clientId, original, {});
    enriched = await enrichWithBrandKit(enriched, meta.clientId, { orgId: meta.orgId });
    if (enriched === original) return messages; // nothing added → leave untouched
    const clone = messages.slice();
    clone[idx] = { ...clone[idx], content: enriched } as typeof clone[number];
    return clone;
  } catch {
    return messages; // enrichment must never break the chat path
  }
}

// Usage tracking — mirrors ai-router.persistUsage so the chatText/chatStream
// path (assistant chatbot + agent loop + 4 agent tools) writes UsageEvent
// rows just like ai-router does. Without this the per-user usage chart in
// admin only ever shows generation jobs, not the chatbot which is the
// most-used surface. Fire-and-forget — DB write failures must not break LLM
// responses. orgId is required (no orgId = unscoped legacy caller = skip).
export interface UsageMeta {
  orgId?: string;
  userId?: string;
  clientId?: string;
  jobId?: string;
}
function persistChatUsage(meta: UsageMeta | undefined, model: string, provider: ProviderName, p?: number, c?: number, t?: number) {
  if (!meta?.orgId) {
    // Surface it: a silent skip is how token tracking develops blind spots.
    // Mirrors the same warning in ai-router.persistUsage.
    console.warn(`[chat] usage NOT tracked — missing orgId for model=${model}`);
    return;
  }
  const priced = isPriced(model);  // Phase 1: a real $0 vs cost-unknown.
  void db.usageEvent.create({
    data: {
      orgId: meta.orgId,
      userId: meta.userId ?? null,
      kind: 'ai.text',
      units: t ?? 0,
      costUsd: computeCostUsd(model, p, c, 1),
      ref: meta.jobId ?? meta.clientId ?? null,
      metadata: { model, task: 'text', provider, priced, promptTokens: p, completionTokens: c, surface: 'chat', ...(priced ? {} : { unpricedModel: model }) },
    },
  }).catch((err: any) => {
    console.warn('[chat] usage persist failed:', err?.message || err);
  });
}

export interface ProviderClient {
  client: OpenAI;
  model: string;
  provider: ProviderName;
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const XAI_BASE = process.env.XAI_BASE_URL || 'https://api.x.ai/v1';
const MOONSHOT_BASE = process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1';
const DASHSCOPE_BASE = process.env.DASHSCOPE_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

const cache = new Map<ProviderName, OpenAI>();

function clientFor(p: ProviderName, geminiModelOverride?: string): ProviderClient {
  let cached = cache.get(p);
  if (p === 'gemini') {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY missing');
    if (!cached) {
      cached = new OpenAI({ apiKey: key, baseURL: GEMINI_BASE });
      cache.set(p, cached);
    }
    // A caller (the agent) can force a reasoning-tier model on the gemini hop
    // without changing GEMINI_CHAT_MODEL, which the assistant shares. The
    // override applies ONLY to gemini: the xai/dashscope fallbacks keep their
    // own ids, since a gemini model string would 400 on those endpoints.
    const model = geminiModelOverride || process.env.GEMINI_CHAT_MODEL || 'gemini-3.1-pro-preview';
    return { client: cached, model, provider: p };
  }
  if (p === 'xai') {
    const key = process.env.XAI_API_KEY;
    if (!key) throw new Error('XAI_API_KEY missing');
    if (!cached) {
      cached = new OpenAI({ apiKey: key, baseURL: XAI_BASE });
      cache.set(p, cached);
    }
    return { client: cached, model: process.env.XAI_TEXT_MODEL || 'grok-4.20', provider: p };
  }
  if (p === 'dashscope') {
    // Alibaba Qwen. Already the third hop for creative work in ai-router, but it
    // was never a provider in THIS stack, so the agent and assistant had only two
    // providers and died if both failed. Verified live 2026-08-02: qwen3.7-max
    // does OpenAI-style tool calling on our endpoint and returns finish_reason
    // 'tool_calls' correctly.
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) throw new Error('DASHSCOPE_API_KEY missing');
    if (!cached) {
      cached = new OpenAI({ apiKey: key, baseURL: DASHSCOPE_BASE });
      cache.set(p, cached);
    }
    // Honour a per-call override when it is a DashScope-shaped id (the agent's
    // AGENT_MODEL); a Gemini id falling through the chain must not be forwarded.
    const dsModel = geminiModelOverride && /^(qwen|deepseek|glm|MiniMax|kimi)/i.test(geminiModelOverride)
      ? geminiModelOverride : (process.env.DASHSCOPE_TEXT_MODEL || 'qwen3.8-max');
    return { client: cached, model: dsModel, provider: p };
  }
  // moonshot
  const key = process.env.MOONSHOT_API_KEY;
  if (!key) throw new Error('MOONSHOT_API_KEY missing');
  if (!cached) {
    cached = new OpenAI({ apiKey: key, baseURL: MOONSHOT_BASE });
    cache.set(p, cached);
  }
  return { client: cached, model: process.env.MOONSHOT_MODEL || 'kimi-k2.6', provider: p };
}

// Default chain — Gemini PRIMARY (Radix company-card key), Grok fallback,
// Kimi tertiary.  Override per-call when a feature has a different routing
// preference (e.g. agent orchestrator wants the model named in AGENT_MODEL).
// moonshot/kimi restored 2026-08-14 — fresh Kimi plan key on the
// api.kimi.com/coding/v1 base (MOONSHOT_BASE_URL), model k3 (1M context).
// It had been dropped 2026-07-21 when the old key 401'd access_terminated.
// Final rung: only reached when gemini + xai + dashscope all fail.
// 2026-10-17: Alibaba first everywhere (qwen3.8-max), Grok, then Gemini, then Kimi.
export const DEFAULT_CHAIN: ProviderName[] = ['dashscope', 'xai', 'gemini', 'moonshot'];

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

async function tryWithBackoff<T>(p: ProviderName, fn: (ctx: ProviderClient) => Promise<T>, geminiModelOverride?: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    try {
      const ctx = clientFor(p, geminiModelOverride);
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
  options: { chain?: ProviderName[]; chainEnv?: string; geminiModel?: string } = {},
): Promise<FallbackResult<T>> {
  const resolved = resolveChain(options.chainEnv, options.chain ?? DEFAULT_CHAIN);
  // Shared circuit-breaker (unified with ai-router): drop providers whose 'text'
  // breaker is open so a capped/down provider (e.g. gemini hitting its monthly
  // spend cap) isn't re-hit on every assistant/agent/research call — and so a
  // trip observed here also protects the ai-router stack, and vice-versa.
  // filterAvailable guarantees ≥1 provider even if every breaker is open.
  const chain = filterAvailable(resolved.map((name) => ({ name })), 'text').map((p) => p.name as ProviderName);
  const attempts: Array<{ provider: ProviderName; error: string }> = [];
  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    try {
      const result = await tryWithBackoff(p, fn, options.geminiModel);
      const ctx = clientFor(p, options.geminiModel);
      recordSuccess(p, 'text');
      return { result, provider: ctx.provider, model: ctx.model, fallbackUsed: i > 0, attempts };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Only trip the breaker for real provider-down errors (rate-limit / 5xx /
      // spend-cap). A 400/401 bad-request or a safety block is not the provider
      // being unhealthy — recording it would wrongly open the shared breaker.
      if (isRetryableAiError(err) && !isSafetyBlock(msg)) recordFailure(p, 'text', msg);
      attempts.push({ provider: p, error: msg.slice(0, 300) });
      console.error(`[llm-fallback] ${p} failed (${i + 1}/${chain.length}): ${msg.slice(0, 200)}`);
    }
  }
  const summary = attempts.map((a) => `${a.provider}:${a.error.slice(0, 80)}`).join(' | ');
  throw new Error(`All providers failed: ${summary}`);
}

// Tool-call history is provider-shaped. Gemini 3 signs each tool-calling step
// (tool_calls[0].extra_content.google.thought_signature) and rejects the next
// request with a 400 when that signature is missing. Other providers do not
// know the field. So, per provider, right before the request:
//  - gemini: keep real signatures; where a step has none (it was produced by a
//    fallback provider) add Google's documented validator-skip value so one
//    foreign step does not push the whole run off Gemini.
//  - everyone else: strip extra_content.
const GEMINI_SKIP_SIGNATURE = 'skip_thought_signature_validator';

export function shapeToolHistoryFor<M extends { role: string }>(provider: ProviderName, messages: M[]): M[] {
  return messages.map((m) => {
    const calls = (m as { tool_calls?: Array<Record<string, any>> }).tool_calls;
    if (m.role !== 'assistant' || !Array.isArray(calls) || calls.length === 0) return m;
    if (provider === 'gemini') {
      if (calls[0]?.extra_content?.google?.thought_signature) return m;
      const first = { ...calls[0], extra_content: { google: { thought_signature: GEMINI_SKIP_SIGNATURE } } };
      return { ...m, tool_calls: [first, ...calls.slice(1)] };
    }
    if (!calls.some((c) => c && 'extra_content' in c)) return m;
    return { ...m, tool_calls: calls.map(({ extra_content: _drop, ...rest }) => rest) };
  });
}

// Sugar: non-streaming chat completion with fallback. Returns text + meta.
export interface ChatTextResult {
  text: string;
  provider: ProviderName;
  model: string;
  latencyMs: number;
  fallbackUsed: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export async function chatText(
  params: Omit<ChatCompletionCreateParamsNonStreaming, 'model' | 'stream'>,
  options?: { chain?: ProviderName[]; chainEnv?: string; meta?: UsageMeta; enrich?: boolean },
): Promise<ChatTextResult> {
  // Spend gate — mirror ai-router so the chat stack (assistant/agent/research)
  // honours the same monthly org budget cap. No-op when orgId/budget absent.
  await assertOrgBudget(options?.meta?.orgId);
  const start = Date.now();
  // RAG grounding (opt-in): enrich the user's turn with KB + memory + brand kit.
  const messages = options?.enrich
    ? await enrichLastUserTurn(params.messages, options.meta)
    : params.messages;
  const out = await withFallback(async ({ client, model, provider }) => {
    const r: ChatCompletion = await client.chat.completions.create({ ...params, messages: shapeToolHistoryFor(provider, messages), model, stream: false });
    const choice = r.choices?.[0]?.message as
      | { content?: string | null; reasoning_content?: string | null }
      | undefined;
    let text = choice?.content ?? '';
    if (!text && choice?.reasoning_content) text = choice.reasoning_content;
    return { text, usage: r.usage };
  }, options);
  persistChatUsage(
    options?.meta,
    out.model,
    out.provider,
    out.result.usage?.prompt_tokens,
    out.result.usage?.completion_tokens,
    out.result.usage?.total_tokens,
  );
  return {
    text: out.result.text,
    provider: out.provider,
    model: out.model,
    latencyMs: Date.now() - start,
    fallbackUsed: out.fallbackUsed,
    promptTokens: out.result.usage?.prompt_tokens,
    completionTokens: out.result.usage?.completion_tokens,
    totalTokens: out.result.usage?.total_tokens,
  };
}

// Sugar: streaming chat completion with fallback. Returns the live stream
// from the first provider that DIDN'T immediately reject. Once the stream
// is yielding chunks we don't switch providers (mid-stream switch would
// drop partial output + duplicate work). Caller iterates as usual.
export async function chatStream(
  params: Omit<ChatCompletionCreateParamsStreaming, 'model' | 'stream'>,
  options?: { chain?: ProviderName[]; chainEnv?: string; signal?: AbortSignal; meta?: UsageMeta; enrich?: boolean; modelOverride?: string },
): Promise<{
  stream: AsyncIterable<ChatCompletionChunk>;
  provider: ProviderName;
  model: string;
  fallbackUsed: boolean;
}> {
  // Spend gate — same monthly org budget cap as ai-router / chatText.
  await assertOrgBudget(options?.meta?.orgId);
  // RAG grounding (opt-in), mirroring chatText: enrich the last user turn
  // with the client's knowledge base + learned memory + brand kit. The agent
  // loop passes enrich:true so agent runs are grounded like the assistant.
  // Best-effort by construction: enrichLastUserTurn catches internally and
  // returns the original messages, so grounding can never break a stream.
  const messages = options?.enrich
    ? await enrichLastUserTurn(params.messages, options.meta)
    : params.messages;
  // stream_options.include_usage = true makes Gemini / xAI / Kimi emit one
  // final chunk containing prompt+completion token counts. Without this,
  // the streaming path can't be priced and every chatbot turn would be a
  // 0-token UsageEvent. Caller-provided stream_options wins so anyone who
  // already turned it off doesn't get overridden silently.
  const paramsWithUsage: ChatCompletionCreateParamsStreaming = {
    ...params,
    messages,
    stream: true,
    stream_options: { include_usage: true, ...(params as any).stream_options },
  } as ChatCompletionCreateParamsStreaming;
  const out = await withFallback(async ({ client, model, provider }) => {
    const stream = await client.chat.completions.create(
      { ...paramsWithUsage, messages: shapeToolHistoryFor(provider, paramsWithUsage.messages), model },
      { signal: options?.signal },
    );
    return stream;
  }, { chain: options?.chain, chainEnv: options?.chainEnv, geminiModel: options?.modelOverride });

  // Wrap the stream so we tap into each chunk for usage, then re-yield to
  // the caller. The final chunk (when include_usage works) carries `usage`.
  // We fire-and-forget the UsageEvent insert when the iterator is exhausted.
  // If the caller break/throws mid-stream we still persist whatever usage
  // we saw — better partial data than none.
  const upstream = out.result as AsyncIterable<ChatCompletionChunk>;
  const wrapped: AsyncIterable<ChatCompletionChunk> = {
    async *[Symbol.asyncIterator]() {
      let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
      try {
        for await (const chunk of upstream) {
          if ((chunk as any).usage) usage = (chunk as any).usage;
          yield chunk;
        }
      } finally {
        persistChatUsage(
          options?.meta,
          out.model,
          out.provider,
          usage?.prompt_tokens,
          usage?.completion_tokens,
          usage?.total_tokens,
        );
      }
    },
  };
  return { stream: wrapped, provider: out.provider, model: out.model, fallbackUsed: out.fallbackUsed };
}

// Diagnostic: which providers in the chain currently have credentials set.
export function chainStatus(chain: ProviderName[] = DEFAULT_CHAIN): Array<{ provider: ProviderName; configured: boolean; model: string }> {
  return chain.map((p) => {
    const envKey = p === 'gemini' ? 'GEMINI_API_KEY'
      : p === 'xai' ? 'XAI_API_KEY'
      : p === 'dashscope' ? 'DASHSCOPE_API_KEY'
      : 'MOONSHOT_API_KEY';
    const modelEnv = p === 'gemini' ? (process.env.GEMINI_CHAT_MODEL || 'gemini-3.1-pro-preview')
      : p === 'xai' ? (process.env.XAI_TEXT_MODEL || 'grok-4.7')
      : p === 'dashscope' ? (process.env.DASHSCOPE_TEXT_MODEL || 'qwen3.8-max')
      : (process.env.MOONSHOT_MODEL || 'kimi-k2.6');
    return { provider: p, configured: !!process.env[envKey], model: modelEnv };
  });
}
