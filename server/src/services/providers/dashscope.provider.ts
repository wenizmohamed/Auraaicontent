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
import { AiProviderError } from './errors.js';

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

// B1: per reference-image role guidance (mirrors gemini.provider).
function refRoleLabel(role?: 'content' | 'style' | 'character'): string {
  switch (role) {
    case 'style':     return 'STYLE REFERENCE — apply this image\'s visual style (color, lighting, texture, mood) but NOT its subject:';
    case 'character': return 'CHARACTER/PRODUCT REFERENCE — keep this subject\'s identity and key features consistent:';
    case 'content':   return 'CONTENT/COMPOSITION REFERENCE — follow this image\'s layout and composition:';
    default:          return 'REFERENCE IMAGE — visual guidance:';
  }
}

// Native multimodal-generation image call (sync → OSS URL). Supports image-edit
// when a source frame is supplied (content carries {image: dataURL}).
async function generateImage(req: ImageRequest, model: string): Promise<ProviderResult<{ url?: string; base64?: string }>> {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error('DASHSCOPE_API_KEY is not set — DashScope provider unavailable');
  const start = Date.now();

  const content: any[] = [];
  const anyRole = (req.referenceImages || []).some(r => r.role);
  if (req.imageBase64 && req.mimeType) {
    if (anyRole) content.push({ text: 'BASE IMAGE to edit:' });
    content.push({ image: `data:${req.mimeType};base64,${req.imageBase64}` });
  }
  // Multi-image edit: include every additional reference frame too (B1: role-labeled).
  for (const ref of req.referenceImages || []) {
    if (ref?.base64 && ref?.mimeType) {
      if (ref.role) content.push({ text: refRoleLabel(ref.role) });
      content.push({ image: `data:${ref.mimeType};base64,${ref.base64}` });
    }
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

// Vision analysis — AnalysisRequest carries an image; send it as multimodal
// content to a VISION-capable model (qwen3.6-plus understands images). The old
// path routed to text-only chat() and dropped the image → hallucinations.
async function analyze(req: AnalysisRequest): Promise<ProviderResult<object>> {
  const client = getClient();
  const model = process.env.DASHSCOPE_VISION_MODEL || 'qwen3.6-plus';
  const start = Date.now();
  const r = await client.chat.completions.create({
    model,
    max_tokens: 2048,
    response_format: { type: 'json_object' as const },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: req.prompt },
        ...(req.imageBase64 && req.mimeType
          ? [{ type: 'image_url' as const, image_url: { url: `data:${req.mimeType};base64,${req.imageBase64}` } }]
          : []),
      ] as any,
    }],
  });
  const text = (r.choices[0]?.message as any)?.content ?? '';
  return {
    provider: 'dashscope', model: r.model || model, output: safeJson(text),
    latencyMs: Date.now() - start, fallbackUsed: false,
    promptTokens: r.usage?.prompt_tokens, completionTokens: r.usage?.completion_tokens, totalTokens: r.usage?.total_tokens,
  };
}

export const dashscopeProvider: AiProvider = {
  name: 'dashscope',
  text: (req) => chat(req, !!req.json),
  analysis: (req) => analyze(req),
  image: (req) => generateImage(req, (req as any).model || IMAGE_MODEL),
  imageEdit: (req) => generateImage(req, (req as any).model || IMAGE_MODEL),
  video: async (_req: VideoRequest): Promise<ProviderResult<{ url: string }>> => {
    // Not in the "aura" plan quota — 503 so the router falls through to Veo/Grok
    // (retryable) rather than breaking the chain with a plain Error.
    throw new AiProviderError('dashscope', 'video', 'video generation not on this plan', 503);
  },
};
