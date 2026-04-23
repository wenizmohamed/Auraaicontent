// Kimi (Moonshot AI) provider — OpenAI-compatible API.  Stub-wired for the
// orchestrator router; not invoked by any route until MOONSHOT_API_KEY is
// set + a routing rule promotes it.
//
// Endpoint: https://api.moonshot.ai/v1
// Models  : kimi-k2-instruct (latest), moonshot-v1-128k, moonshot-v1-32k
//
// Use case in Radix: long-context analysis (128k context window) — feed an
// entire client's content history + brief + competitors into a single call
// without the multi-round chunking Claude/Grok would need.

import OpenAI from 'openai';

const BASE_URL = process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1';
const MODEL = process.env.MOONSHOT_MODEL || 'kimi-k2-instruct';

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
  maxTokens = 2048,
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
  const text = r.choices[0]?.message?.content ?? '';
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
