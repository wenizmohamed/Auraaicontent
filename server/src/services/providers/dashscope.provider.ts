// DashScope (Alibaba Model Studio "Token Plan", org "aura") provider.
//
// Verified live 2026-06-04 against the plan's exclusive base URLs:
//   - TEXT  : OpenAI-compatible  {BASE}/chat/completions   (BASE includes /compatible-mode/v1)
//             models: qwen3.8-max, qwen3.7-max/plus, qwen3.6-plus/flash,
//                     deepseek-v4-pro/flash/v3.2, glm-5.1/glm-5, MiniMax-M2.5,
//                     kimi-k2.6/k2.5 (qwen3.8-max verified on this base 2026-08-14)
//   - IMAGE : native multimodal-generation (sync, returns an OSS image URL)
//             {HOST}/api/v1/services/aigc/multimodal-generation/generation
//             models: qwen-image-3.0(-pro), qwen-image-2.0(-pro), wan2.7-image(-pro)
//   - VIDEO : PRIMARY engine since 2026-10-17 (Weni: Alibaba is the main for
//             image + video). Token Plan key serves wan3.0-video (all-in-one:
//             text, first frame, first+last frame, reference images; 2-30s,
//             480P/720P/1080P, native audio) and happyhorse-1.1 t2v/i2v/r2v
//             (verified live 2026-10-17 via /models + validation probes).
//             wan2.7 t2v/i2v/r2v + happyhorse-1.0 only exist on the older ws
//             workspace key (DASHSCOPE_VIDEO_API_KEY) and route there.
//
// Adds many models to Radix's multi-LLM orchestration. Text/analysis run through
// the SAME routeCall path as every other provider, so the knowledge + memory
// (RAG) enrichers apply automatically — no special wiring needed here.

import OpenAI from 'openai';
import type {
  AiProvider, AnalysisRequest, ImageRequest, ProviderResult, TextRequest, VideoRequest,
} from './types.js';
import { AiProviderError, AiCancelledError, abortReasonText, throwIfCancelled } from './errors.js';
import { storageService } from '../storage.service.js';

const BASE_URL = process.env.DASHSCOPE_BASE_URL
  || 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
// Native (DashScope) host for image synthesis — derive from the compatible base.
const NATIVE_URL = process.env.DASHSCOPE_NATIVE_URL
  || `${BASE_URL.replace(/\/compatible-mode\/v1\/?$/, '')}/api/v1/services/aigc/multimodal-generation/generation`;

const TEXT_MODEL = process.env.DASHSCOPE_TEXT_MODEL || 'qwen3.8-max';
const IMAGE_MODEL = process.env.DASHSCOPE_IMAGE_MODEL || 'qwen-image-3.0-pro';
// Only a DashScope-shaped id is honoured as an override. When a Gemini/Grok pick
// falls through the chain to us, its model id must NOT be forwarded (404
// "Model not exist" would turn a recoverable fallback into a dead end).
function dashscopeImageModel(requested?: string): string {
  return requested && /^(qwen-image|wan[\d.]+-image|z-image)/i.test(requested) ? requested : IMAGE_MODEL;
}
const TIMEOUT_MS = parseInt(process.env.DASHSCOPE_TIMEOUT_MS || '120000', 10);
// Image calls get their own budget (mirrors GEMINI_IMAGE_EDIT_TIMEOUT_MS): a
// 2K single-image edit on qwen-image-3.0-pro ran 71s live, a three-image
// role-labelled edit passed 120s and aborted (2026-10-17). nginx allows 300s
// on /api/ and the FE waits 290s, so 240s keeps room for one fallback hop.
const IMAGE_TIMEOUT_MS = parseInt(process.env.DASHSCOPE_IMAGE_TIMEOUT_MS || '240000', 10);

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
  // Only a DashScope-shaped id is honoured. Callers like the prompt enhancer
  // pass their Gemini model id ("gemini-flash-latest"); when Gemini is down
  // (402 credits depleted, 2026-10-17) and the call falls through to us, that
  // id must not be forwarded or every enhance dies on 404 "Model not exist".
  const requested = (req as any).model as string | undefined;
  const model = requested && /^(qwen|deepseek|glm|MiniMax|kimi)/i.test(requested) ? requested : TEXT_MODEL;
  const start = Date.now();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if ((req as TextRequest).system) messages.push({ role: 'system', content: (req as TextRequest).system! });
  messages.push({ role: 'user', content: req.prompt });

  const { signal, timeoutMs } = req as TextRequest;
  throwIfCancelled(signal, 'text');
  let r: OpenAI.Chat.ChatCompletion;
  try {
    r = await client.chat.completions.create({
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
    }, {
      ...(signal ? { signal } : {}),
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
    });
  } catch (err) {
    if (signal?.aborted) throw new AiCancelledError('text', abortReasonText(signal));
    throw err;
  }

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

  // qwen-image-3.0-pro requires EXACTLY ONE text item in the message (400
  // "The last message must contain exactly one text content item, got 3" —
  // every role-labelled multi-reference edit died on this, 2026-10-17). So the
  // images go first, in order, and ONE trailing text item carries the role
  // labels ("Image 1 is the base image to edit. Image 2: STYLE REFERENCE ...")
  // followed by the prompt.
  const content: any[] = [];
  const labels: string[] = [];
  const anyRole = (req.referenceImages || []).some(r => r.role);
  let n = 0;
  if (req.imageBase64 && req.mimeType) {
    content.push({ image: `data:${req.mimeType};base64,${req.imageBase64}` });
    n++;
    if (anyRole) labels.push(`Image ${n} is the BASE IMAGE to edit.`);
  }
  // Multi-image edit: include every additional reference frame too (B1: role-labeled).
  for (const ref of req.referenceImages || []) {
    if (ref?.base64 && ref?.mimeType) {
      content.push({ image: `data:${ref.mimeType};base64,${ref.base64}` });
      n++;
      if (ref.role) labels.push(`Image ${n}: ${refRoleLabel(ref.role)}`);
    }
  }
  content.push({ text: labels.length ? `${labels.join(' ')}\n\n${req.prompt}` : req.prompt });

  const res = await fetch(NATIVE_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: { messages: [{ role: 'user', content }] } }),
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Surface DashScope's own code + message first: the telemetry line keeps
    // ~100 chars, and the raw JSON prefix (request_id) used to eat all of it,
    // so a morning of image_edit 400s (2026-10-17) left no usable cause.
    let detail = body.slice(0, 300);
    try { const j = JSON.parse(body); if (j?.code || j?.message) detail = `${j.code || ''}: ${j.message || ''}`.slice(0, 300); } catch { /* keep raw */ }
    throw new AiProviderError('dashscope', req.imageBase64 ? 'image_edit' : 'image', `DashScope image ${res.status}: ${detail}`, res.status);
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
  const model = process.env.DASHSCOPE_VISION_MODEL || 'qwen3.7-plus';
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


// ─── Video ────────────────────────────────────────────────────────
// Two credential lanes:
//  - Token Plan (main key): wan3.0-video + happyhorse-1.1-* (verified 2026-10-17).
//  - Legacy ws workspace (DASHSCOPE_VIDEO_API_KEY): wan2.7-* + happyhorse-1.0-*.
//    Falls back to the main key when unset (those ids then 404 → next provider).
const TOKEN_PLAN_VIDEO = /^(wan3\.\d+-video|happyhorse-1\.1-)/i;
const VIDEO_MODEL_RE = /^(wan[\d.]+-(video|t2v|i2v|r2v)|happyhorse-[\d.]+-(t2v|i2v|r2v))/i;
const DEFAULT_VIDEO_MODEL = process.env.DASHSCOPE_VIDEO_MODEL || 'wan3.0-video';

type VideoMode = 't2v' | 'i2v' | 'r2v';

// Normalise the caller's engine pick to the model that fits the INPUT shape:
// a HappyHorse / Wan 2.7 t2v id with a start frame becomes its -i2v sibling,
// with product references its -r2v sibling. wan3.0-video is all-in-one.
function resolveVideoModel(requested: string | undefined, mode: VideoMode): string {
  const base = requested && VIDEO_MODEL_RE.test(requested) ? requested : DEFAULT_VIDEO_MODEL;
  if (/-video$/i.test(base)) return base;                 // wan3.0-video handles every mode
  const family = base.replace(/-(t2v|i2v|r2v)$/i, '');
  return `${family}-${mode}`;
}

// Billing tier suffix: Alibaba prices video per second BY RESOLUTION, and the
// cost meter keys off the model string, so the row carries the tier it was
// billed at (wan3.0-video = 720P baseline, wan3.0-video:1080p, :480p).
function billedModelId(model: string, resolution: '480P' | '720P' | '1080P'): string {
  return resolution === '720P' ? model : `${model}:${resolution.toLowerCase()}`;
}

async function generateVideo(req: VideoRequest): Promise<ProviderResult<{ url: string }>> {
  const refs = (req.referenceImages || []).filter(r => r?.base64 && r?.mimeType);
  const srcB64 = req.startImageBase64 || req.imageBase64;
  const srcMime = req.startMimeType || req.mimeType || 'image/jpeg';
  const mode: VideoMode = refs.length ? 'r2v' : srcB64 ? 'i2v' : 't2v';
  const model = resolveVideoModel(req.model, mode);
  const isWan3 = /^wan3\.\d+-video/i.test(model);
  const isHappyHorse = /^happyhorse/i.test(model);

  const onTokenPlan = TOKEN_PLAN_VIDEO.test(model);
  const key = onTokenPlan
    ? process.env.DASHSCOPE_API_KEY
    : (process.env.DASHSCOPE_VIDEO_API_KEY || process.env.DASHSCOPE_API_KEY);
  if (!key) throw new AiProviderError('dashscope', 'video', 'DASHSCOPE_API_KEY not set', 401);
  const host = (onTokenPlan ? BASE_URL : (process.env.DASHSCOPE_VIDEO_BASE_URL || BASE_URL))
    .replace(/\/compatible-mode\/v1\/?$/, '');

  // End frame: only wan3.0 does first+last on this plan — the rest 503 so the
  // router hands bookended clips to Veo.
  if (req.endImageBase64 && !isWan3) {
    throw new AiProviderError('dashscope', 'video', `${model} has no end-frame mode — Veo handles bookended clips`, 503);
  }
  // Reference images: wan3.0 takes up to 10, HappyHorse/Wan2.7 r2v take several;
  // cap at 10 and let the API validate the rest.
  const refMedia = refs.slice(0, 10).map(r => ({ type: 'reference_image', url: `data:${r.mimeType};base64,${r.base64}` }));
  const frameMedia = srcB64
    ? [
        { type: 'first_frame', url: `data:${srcMime};base64,${srcB64}` },
        ...(req.endImageBase64 ? [{ type: 'last_frame', url: `data:${req.endMimeType || 'image/jpeg'};base64,${req.endImageBase64}` }] : []),
      ]
    : [];
  const input: Record<string, unknown> = { prompt: req.prompt };
  if (mode === 'r2v') input.media = refMedia;
  else if (mode === 'i2v') input.media = frameMedia;

  // Resolution: 1080p only when asked (double the per-second price); 720P default.
  const resolution: '480P' | '720P' | '1080P' = req.resolution === '1080p' ? '1080P' : '720P';
  const ratio = req.aspectRatio === '9:16' ? '9:16' : '16:9';
  const wanted = Math.round(req.durationSeconds || 5);
  let parameters: Record<string, unknown>;
  if (isWan3) {
    // wan3.0-video: duration 2-30s, ratio adaptive by default for image input,
    // audio generated in the same pass (free), no watermark. prompt_extend is
    // Alibaba's own rewrite — our enhancer already ran, so it is off unless
    // DASHSCOPE_PROMPT_EXTEND=true.
    parameters = {
      resolution,
      duration: Math.min(Math.max(wanted, 2), 30),
      audio: process.env.DASHSCOPE_VIDEO_AUDIO !== 'false',
      watermark: false,
      prompt_extend: process.env.DASHSCOPE_PROMPT_EXTEND === 'true',
      ...(mode === 't2v' ? { ratio } : {}),
    };
  } else if (isHappyHorse) {
    // happyhorse-1.1: duration 3-15s, 480P/720P/1080P, watermark default ON → off.
    parameters = {
      resolution,
      duration: Math.min(Math.max(wanted, 3), 15),
      watermark: false,
      ...(mode === 't2v' ? { ratio } : {}),
    };
  } else {
    // wan2.7 family (legacy workspace): size only for t2v; i2v/r2v derive it.
    const size = req.aspectRatio === '9:16' ? '720*1280' : '1280*720';
    const duration = Math.min(Math.max(wanted, 3), 10);
    parameters = mode === 't2v' ? { size, duration } : { duration };
  }

  const start = Date.now();
  const budget = Number(process.env.DASHSCOPE_VIDEO_BUDGET_MS ?? 8 * 60 * 1000);
  const submitRes = await fetch(`${host}/api/v1/services/aigc/video-generation/video-synthesis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({ model, input, parameters }),
    signal: AbortSignal.timeout(60000),
  });
  const submitted: any = await submitRes.json().catch(() => ({}));
  const taskId = submitted?.output?.task_id;
  if (!submitRes.ok || !taskId) {
    throw new AiProviderError('dashscope', 'video', `${model} submit ${submitRes.status}: ${JSON.stringify(submitted).slice(0, 200)}`, submitRes.status === 200 ? 502 : submitRes.status);
  }

  let videoUrl: string | undefined;
  while (Date.now() - start < budget) {
    throwIfCancelled(req.signal, 'video');
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
      // Content-filter rejections surface as DataInspectionFailed; keep the
      // code in the message so the router's safety-block detection can re-run.
      throw new AiProviderError('dashscope', 'video', `${model} task ${status}: ${st?.output?.code || ''} ${(st?.output?.message || '').slice(0, 200)}`.trim());
    }
  }
  if (!videoUrl) throw new AiProviderError('dashscope', 'video', `${model} poll budget exhausted (${Math.round(budget / 1000)}s)`);

  const dl = await fetch(videoUrl, { signal: AbortSignal.timeout(120000) });
  if (!dl.ok) throw new AiProviderError('dashscope', 'video', `${model} video download ${dl.status}`, dl.status);
  const buf = Buffer.from(await dl.arrayBuffer());
  const { fileUrl } = await storageService.saveFile(buf, `${model.replace(/[^a-z0-9.]+/gi, '-')}-${Date.now()}.mp4`, 'video/mp4');
  return {
    provider: 'dashscope', model: billedModelId(model, resolution), latencyMs: Date.now() - start, fallbackUsed: false,
    output: { url: fileUrl },
  };
}

export const dashscopeProvider: AiProvider = {
  name: 'dashscope',
  text: (req) => chat(req, !!req.json),
  analysis: (req) => analyze(req),
  image: (req) => generateImage(req, dashscopeImageModel(req.model)),
  imageEdit: (req) => generateImage(req, dashscopeImageModel(req.model)),
  video: (req: VideoRequest) => generateVideo(req),
};
