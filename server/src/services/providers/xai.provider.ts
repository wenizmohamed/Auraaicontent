import type { AiProvider, AnalysisRequest, ImageRequest, ProviderResult, TextRequest, VideoRequest } from './types.js';
import { AiProviderError } from './errors.js';

const BASE_URL = process.env.XAI_BASE_URL || 'https://api.x.ai/v1';
const TIMEOUT = parseInt(process.env.XAI_TIMEOUT_MS || '180000', 10);

function safeJsonParse(text: string, label: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/[\[{][\s\S]*[\]}]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    throw new AiProviderError('xai', label, `JSON parse failed. Response: ${text.slice(0, 200)}`);
  }
}

function getKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new AiProviderError('xai', 'init', 'XAI_API_KEY not set', 401);
  return key;
}

async function xaiFetch(path: string, body: object): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getKey()}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AiProviderError('xai', path, `${res.status}: ${text}`, res.status);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function pollVideo(requestId: string): Promise<string> {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/videos/${requestId}`, {
      headers: { 'Authorization': `Bearer ${getKey()}` },
    });
    if (!res.ok) throw new AiProviderError('xai', 'video-poll', `${res.status}`, res.status);
    const data = await res.json();
    if (data.status === 'done') return data.video?.url || data.url;
    if (data.status === 'failed' || data.status === 'expired') {
      throw new AiProviderError('xai', 'video', `Video ${data.status}`);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new AiProviderError('xai', 'video', 'timeout');
}

export const xaiProvider: AiProvider = {
  name: 'xai',

  async text(req: TextRequest): Promise<ProviderResult<string | object>> {
    const model = process.env.XAI_TEXT_MODEL || 'grok-4.20';
    const start = Date.now();
    // 8192 covers month-strategy JSON (~6KB typical) without tripping the
    // model's default cap that was truncating responses mid-string and
    // causing safeJsonParse to fail with "JSON parse failed" (incident
    // 2026-04-23, jobs 0b5c8a3c + earlier generate-month failures).
    // 16384 covers month-strategy JSON (~12KB typical).  Was 8192 and still
    // hit truncation on the Al Fardan 18-post brief+pillars payload — the
    // response would end mid-string and safeJsonParse couldn't recover.
    const maxTokens = req.maxTokens ?? (req.json ? 16384 : 2048);
    const data = await xaiFetch('/chat/completions', {
      model,
      temperature: req.temperature ?? 0.7,
      max_tokens: maxTokens,
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        { role: 'user', content: req.prompt },
      ],
      ...(req.json ? { response_format: { type: 'json_object' } } : {}),
    });
    const text = data.choices?.[0]?.message?.content ?? '';
    return {
      provider: 'xai', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: req.json ? safeJsonParse(text, 'text') : text,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      totalTokens: data.usage?.total_tokens,
    };
  },

  async image(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    const model = process.env.XAI_IMAGE_MODEL || 'grok-imagine-image';
    const start = Date.now();
    const data = await xaiFetch('/images/generations', {
      model, prompt: req.prompt, n: req.n ?? 1,
    });
    return {
      provider: 'xai', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: { url: data.data?.[0]?.url },
    };
  },

  async imageEdit(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    const model = process.env.XAI_IMAGE_MODEL || 'grok-imagine-image';
    const start = Date.now();
    const data = await xaiFetch('/images/edits', {
      model, prompt: req.prompt,
      image: { url: `data:${req.mimeType};base64,${req.imageBase64}`, type: 'image_url' },
    });
    return {
      provider: 'xai', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: { url: data.data?.[0]?.url ?? data.url },
    };
  },

  async video(req: VideoRequest): Promise<ProviderResult<{ url: string }>> {
    const model = process.env.XAI_VIDEO_MODEL || 'grok-imagine-video';
    const start = Date.now();
    // Build reference images: explicit URLs first, then fall back to imageBase64
    // so image-to-video requests from Gemini fallback still carry the source frame.
    const refImages = req.referenceImageUrls?.length
      ? req.referenceImageUrls.map(url => ({ url }))
      : req.imageBase64 && req.mimeType
        ? [{ url: `data:${req.mimeType};base64,${req.imageBase64}` }]
        : undefined;
    const data = await xaiFetch('/videos/generations', {
      model, prompt: req.prompt,
      duration: req.durationSeconds ?? 8,
      aspect_ratio: req.aspectRatio ?? '16:9',
      resolution: req.resolution ?? '720p',
      ...(refImages ? { reference_images: refImages } : {}),
    });
    const url = await pollVideo(data.request_id);
    return { provider: 'xai', model, latencyMs: Date.now() - start, fallbackUsed: false, output: { url } };
  },

  async analysis(_req: AnalysisRequest): Promise<never> {
    throw new AiProviderError('xai', 'analysis', 'xAI analysis not supported — use Gemini');
  },
};
