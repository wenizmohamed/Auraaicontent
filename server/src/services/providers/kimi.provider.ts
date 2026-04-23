// Kimi (Moonshot AI) provider — OpenAI-compatible API.
//
// Endpoint: https://api.moonshot.ai/v1
// Auth    : Authorization: Bearer ${MOONSHOT_API_KEY}
// Models  :
//   - kimi-k2-turbo-preview ← DEFAULT. Non-thinking, fast, predictable.
//   - kimi-k2.6              ← THINKING model — puts output in
//                              reasoning_content first; needs max_tokens
//                              ≥4096 or content comes back empty
//                              (finish_reason='length').
//   - kimi-k2-thinking-turbo ← Faster thinking variant
//   - moonshot-v1-128k       ← v1 series, 128K context, plain chat
//   - moonshot-v1-128k-vision-preview ← multimodal long-context
//
// Use case in Radix: long-context analysis (128K-256K) — feed an entire
// client's content history + brief + competitor scrape into a single call
// without the multi-round chunking Grok would need.

import OpenAI from 'openai';

const BASE_URL = process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1';
const MODEL = process.env.MOONSHOT_MODEL || 'kimi-k2-turbo-preview';

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const key = process.env.MOONSHOT_API_KEY;
    if (!key) throw new Error('MOONSHOT_API_KEY is not set — Kimi provider unavailable');
    _client = new OpenAI({ apiKey: key, baseURL: BASE_URL });
  }
  return _client;
}

export async function callKimi(
  system: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  maxTokens = 4096,
  json = false,
): Promise<string> {
  const client = getClient();
  const start = Date.now();
  const r = await client.chat.completions.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, ...messages],
    ...(json ? { response_format: { type: 'json_object' as const } } : {}),
  });
  // Thinking models (kimi-k2.6, kimi-k2-thinking) put their final answer in
  // `content` after streaming the chain of thought into `reasoning_content`.
  // If `content` is empty but reasoning has data, fall back to reasoning so
  // we never silently return ''.
  const choice = r.choices[0]?.message as
    | { content?: string | null; reasoning_content?: string | null }
    | undefined;
  let text = choice?.content ?? '';
  if (!text && choice?.reasoning_content) text = choice.reasoning_content;
  const latency = Date.now() - start;
  console.log(`[kimi] ${MODEL} ${latency}ms, ${text.length} chars`);
  return text;
}

export interface KimiStatus {
  configured: boolean;
  baseURL: string;
  model: string;
}

export function kimiStatus(): KimiStatus {
  return {
    configured: !!process.env.MOONSHOT_API_KEY,
    baseURL: BASE_URL,
    model: MODEL,
  };
}
