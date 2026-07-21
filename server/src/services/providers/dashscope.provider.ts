// DashScope (Alibaba Model Studio "Token Plan", org "aura") provider.
//
// Verified live 2026-06-04 against the plan's exclusive base URLs:
//   - TEXT  : OpenAI-compatible  {BASE}/chat/completions   (BASE includes /compatible-mode/v1)
//             models: qwen3.7-max, qwen3.6-plus/flash, deepseek-v4-pro/flash/v3.2,
//                     glm-5.1/glm-5, MiniMax-M2.5, kimi-k2.6/k2.5
//   - IMAGE : native multimodal-generation (sync, returns an OSS image URL)
//             {HOST}/api/v1/services/aigc/multimodal-generation/generation
//             models: qwen-image-2.0(-pro), wan2.7-image(-pro)
//   - VIDEO : LIVE since 2026-07-03 on the ws-5idw8yndpkd149fa workspace key —
//             Wan 2.7 t2v via native video-synthesis (async task + poll). Text→
//             video only; image-conditioned throws 503 so Veo keeps those.
//
// Adds many models to Radix's multi-LLM orchestration. Text/analysis run through
// the SAME routeCall path as every other provider, so the knowledge + memory
// (RAG) enrichers apply automatically — no special wiring needed here.

import OpenAI from 'openai';
import type {
  AiProvider, AnalysisRequest, ImageRequest, ProviderResult, TextRequest, VideoRequest,
} from './types.js';
import { AiProviderError } from './errors.js';
import { storageService } from '../storage.service.js';

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
    // 16384 (was 4096): qwen3.7-max is a reasoning model, so thinking + answer
    // share this budget. A month plan (18-30 posts) needs ~7-11K output tokens;
    // at 4096 EVERY calendar that fell through to DashScope truncated → invalid
    // posts array → whole generation failed. This is the second half of the
    // "gemini fails → Qwen → job dies" chain.
    max_tokens: (req as TextRequest).maxTokens ?? 16384,
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
  video: async (req: VideoRequest): Promise<ProviderResult<{ url: string }>> => {
    // Wan 2.7 text→video (verified live 2026-07-03: submit → PENDING → poll
    // /api/v1/tasks/{id} → SUCCEEDED in ~2.5min with an EXPIRING OSS url, so
    // the clip is persisted to our storage immediately). Image-conditioned
    // requests are not wired (wan i2v needs a public img_url) — 503 keeps
    // them on Veo via the router.
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) throw new AiProviderError('dashscope', 'video', 'DASHSCOPE_API_KEY not set', 401);
    if (req.imageBase64 || req.startImageBase64 || req.endImageBase64 || req.referenceImages?.length) {
      throw new AiProviderError('dashscope', 'video', 'wan image-to-video not wired — Veo handles image-conditioned', 503);
    }
    const model = req.model && /wan/i.test(req.model) ? req.model : (process.env.DASHSCOPE_VIDEO_MODEL || 'wan2.7-t2v');
    const host = BASE_URL.replace(/\/compatible-mode\/v1\/?$/, '');
    const size = req.aspectRatio === '9:16' ? '720*1280' : '1280*720';
    const duration = Math.min(Math.max(Math.round(req.durationSeconds || 5), 3), 10);
    const start = Date.now();
    const budget = Number(process.env.DASHSCOPE_VIDEO_BUDGET_MS ?? 8 * 60 * 1000);

    const submitRes = await fetch(`${host}/api/v1/services/aigc/video-generation/video-synthesis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({ model, input: { prompt: req.prompt }, parameters: { size, duration } }),
      signal: AbortSignal.timeout(60000),
    });
    const submitted: any = await submitRes.json().catch(() => ({}));
    const taskId = submitted?.output?.task_id;
    if (!submitRes.ok || !taskId) {
      throw new AiProviderError('dashscope', 'video', `wan submit ${submitRes.status}: ${JSON.stringify(submitted).slice(0, 200)}`, submitRes.status === 200 ? 502 : submitRes.status);
    }

    let videoUrl: string | undefined;
    while (Date.now() - start < budget) {
      await new Promise(r => setTimeout(r, 10000));
      const poll = await fetch(`${host}/api/v1/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000),
      });
      const st: any = await poll.json().catch(() => ({}));
      const status = st?.output?.task_status;
      if (status === 'SUCCEEDED') {
        videoUrl = st.output.video_url || st.output.results?.[0]?.url;
        break;
      }
      if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
        throw new AiProviderError('dashscope', 'video', `wan task ${status}: ${JSON.stringify(st?.output || {}).slice(0, 200)}`);
      }
    }
    if (!videoUrl) throw new AiProviderError('dashscope', 'video', `wan poll budget exhausted (${Math.round(budget / 1000)}s)`);

    const dl = await fetch(videoUrl, { signal: AbortSignal.timeout(120000) });
    if (!dl.ok) throw new AiProviderError('dashscope', 'video', `wan video download ${dl.status}`, dl.status);
    const buf = Buffer.from(await dl.arrayBuffer());
    const { fileUrl } = await storageService.saveFile(buf, `wan-${Date.now()}.mp4`, 'video/mp4');
    return {
      provider: 'dashscope', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: { url: fileUrl },
    };
  },
};
