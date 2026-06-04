// DashScope (Alibaba Model Studio "Token Plan", org "aura") provider.
//
// Verified live 2026-06-04 against the plan's exclusive base URLs:
//   - TEXT  : OpenAI-compatible  {BASE}/chat/completions   (BASE includes /compatible-mode/v1)
//             models: qwen3.7-max, qwen3.6-plus/flash, deepseek-v4-pro/flash/v3.2,
//                     glm-5.1/glm-5, MiniMax-M2.5, kimi-k2.6/k2.5
//   - IMAGE : native multimodal-generation (sync, returns an OSS image URL)
//             {HOST}/api/v1/services/aigc/multimodal-generation/generation
//             models: qwen-image-2.0(-pro), wan2.7-image(-pro)
//   - VIDEO : NOT in the plan quota (every video model → "Model not exist").
//             video() throws NotSupported so the router falls through to Veo/Grok.
//
// Adds many models to Radix's multi-LLM orchestration. Text/analysis run through
// the SAME routeCall path as every other provider, so the knowledge + memory
// (RAG) enrichers apply automatically — no special wiring needed here.

import OpenAI from 'openai';
import type {
  AiProvider, AnalysisRequest, ImageRequest, ProviderResult, TextRequest, VideoRequest,
} from './types.js';

const BASE_URL = process.env.DASHSCOPE_BASE_URL
  || 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
// Native (DashScope) host for image synthesis — derive from the compatible base.
const NATIVE_URL = process.env.DASHSCOPE_NATIVE_URL
  || `${BASE_URL.replace(/\/compatible-mode\/v1\/?$/, '')}/api/v1/services/aigc/multimodal-generation/generation`;

const TEXT_MODEL = process.env.DASHSCOPE_TEXT_MODEL || 'qwen3.7-max';
const IMAGE_MODEL = process.env.DASHSCOPE_IMAGE_MODEL || 'qwen-image-2.0-pro';
const TIMEOUT_MS = parseInt(process.env.DASHSCOPE_TIMEOUT_MS || '120000', 10);

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) throw new Error('DASHSCOPE_API_KEY is not set — DashScope provider unavailable');
    _client = new OpenAI({ apiKey: key, baseURL: BASE_URL, timeout: TIMEOUT_MS });
  }
  return _client;
}

async function chat(req: TextRequest | AnalysisRequest, json: boolean): Promise<ProviderResult<string | object>> {
  const client = getClient();
  const model = (req as any).model || TEXT_MODEL;
  const start = Date.now();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if ((req as TextRequest).system) messages.push({ role: 'system', content: (req as TextRequest).system! });
  messages.push({ role: 'user', content: req.prompt });

  const r = await client.chat.completions.create({
    model,
    messages,
    max_tokens: (req as TextRequest).maxTokens ?? 4096,
    ...((req as TextRequest).temperature != null ? { temperature: (req as TextRequest).temperature } : {}),
    ...(json ? { response_format: { type: 'json_object' as const } } : {}),
  });

  // Some Qwen/DeepSeek "reasoning" models stream the answer into reasoning_content
  // and leave content empty — fall back so we never return ''.
  const choice = r.choices[0]?.message as { content?: string | null; reasoning_content?: string | null } | undefined;
  let text = choice?.content ?? '';
  if (!text && choice?.reasoning_content) text = choice.reasoning_content;

  const output: string | object = json ? safeJson(text) : text;
  return {
    provider: 'dashscope', model: r.model || model, output,
    latencyMs: Date.now() - start, fallbackUsed: false,
    promptTokens: r.usage?.prompt_tokens, completionTokens: r.usage?.completion_tokens,
    totalTokens: r.usage?.total_tokens,
  };
}

function safeJson(s: string): object {
  try {
    // tolerate ```json fences some models add
    const cleaned = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(cleaned);
  } catch { return { raw: s }; }
}

// Native multimodal-generation image call (sync → OSS URL). Supports image-edit
// when a source frame is supplied (content carries {image: dataURL}).
async function generateImage(req: ImageRequest, model: string): Promise<ProviderResult<{ url?: string; base64?: string }>> {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error('DASHSCOPE_API_KEY is not set — DashScope provider unavailable');
  const start = Date.now();

  const content: any[] = [];
  if (req.imageBase64 && req.mimeType) {
    content.push({ image: `data:${req.mimeType};base64,${req.imageBase64}` });
  }
  content.push({ text: req.prompt });

  const res = await fetch(NATIVE_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: { messages: [{ role: 'user', content }] } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`DashScope image ${res.status}: ${body.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const parts: any[] = data?.output?.choices?.[0]?.message?.content ?? [];
  const url = parts.find((p) => p?.image)?.image;
  if (!url) throw new Error(`DashScope image: no image in response (${JSON.stringify(data).slice(0, 200)})`);

  return {
    provider: 'dashscope', model, output: { url },
    latencyMs: Date.now() - start, fallbackUsed: false,
  };
}

export const dashscopeProvider: AiProvider = {
  name: 'dashscope',
  text: (req) => chat(req, !!req.json),
  analysis: (req) => chat(req, true) as Promise<ProviderResult<object>>,
  image: (req) => generateImage(req, (req as any).model || IMAGE_MODEL),
  imageEdit: (req) => generateImage(req, (req as any).model || IMAGE_MODEL),
  video: async (_req: VideoRequest): Promise<ProviderResult<{ url: string }>> => {
    // Not in the "aura" plan quota — let the router fall through to Veo/Grok.
    throw new Error('DashScope: video generation is not available on this plan');
  },
};
