import type { AiProvider, AnalysisRequest, ImageRequest, ProviderResult, TextRequest, VideoRequest } from './types.js';
import { AiProviderError } from './errors.js';
import { storageService } from '../storage.service.js';
import { runModelLadder, readLadder } from './model-chain.js';

const BASE_URL = process.env.XAI_BASE_URL || 'https://api.x.ai/v1';
const TIMEOUT = parseInt(process.env.XAI_TIMEOUT_MS || '180000', 10);


// Balanced-root extraction: walks the text from the first bracket and cuts
// where the root closes. Handles Gemini's occasional trailing garbage (e.g.
// a stray "]\n]" after a valid array — live incident 2026-07-03 that 503'd
// ~40% of copywriting calls because the greedy regex swallowed the junk).
function balancedJsonSlice(text: string): string | null {
  const start = text.search(/[\[{]/);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function safeJsonParse(text: string, label: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/[\[{][\s\S]*[\]}]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    const balanced = balancedJsonSlice(text);
    if (balanced) {
      try { return JSON.parse(balanced); } catch {}
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


// xAI returns a usage block on image endpoints too (prompt tokens + generated
// image tokens). Text already captured it; image/imageEdit did not, so those
// UsageEvents recorded zero tokens. Undefined fields stay undefined.
function xaiUsage(data: any): { promptTokens?: number; completionTokens?: number; totalTokens?: number } {
  const u = data?.usage;
  if (!u) return {};
  const p = u.prompt_tokens ?? u.input_tokens;
  const c = u.completion_tokens ?? u.output_tokens ?? u.generated_image_tokens;
  const t = u.total_tokens ?? (((p ?? 0) + (c ?? 0)) || undefined);
  return {
    ...(typeof p === 'number' ? { promptTokens: p } : {}),
    ...(typeof c === 'number' ? { completionTokens: c } : {}),
    ...(typeof t === 'number' ? { totalTokens: t } : {}),
  };
}

export const xaiProvider: AiProvider = {
  name: 'xai',

  async text(req: TextRequest): Promise<ProviderResult<string | object>> {
    const model = process.env.XAI_TEXT_MODEL || 'grok-4.6';
    const start = Date.now();
    // 8192 covers month-strategy JSON (~6KB typical) without tripping the
    // model's default cap that was truncating responses mid-string and
    // causing safeJsonParse to fail with "JSON parse failed" (incident
    // 2026-04-23, jobs 0b5c8a3c + earlier generate-month failures).
    // 16384 covers month-strategy JSON (~12KB typical).  Was 8192 and still
    // hit truncation on the Al Fardan 18-post brief+pillars payload — the
    // response would end mid-string and safeJsonParse couldn't recover.
    // 32000 for JSON (was 16384): grok-4.20 is now a reasoning model — thinking
    // tokens share this budget, so a month-plan JSON needs headroom or content
    // comes back empty/truncated. xai is now the 2nd text hop, so it must handle
    // full calendars.
    const maxTokens = req.maxTokens ?? (req.json ? 32000 : 2048);
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
    const model = process.env.XAI_IMAGE_MODEL || 'grok-imagine-image-2.0';
    const start = Date.now();
    // aspect_ratio: xAI enum verified live 2026-07-02 —
    // 1:1, 3:4, 4:3, 9:16, 16:9, 2:3, 3:2, 9:19.5, 19.5:9. Map the nano-only
    // ratios to the nearest legal one instead of 422ing.
    const GROK_ASPECTS = new Set(['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '9:19.5', '19.5:9']);
    const GROK_NEAREST: Record<string, string> = { '4:5': '3:4', '5:4': '4:3', '21:9': '16:9' };
    const ar = req.aspectRatio
      ? (GROK_ASPECTS.has(req.aspectRatio) ? req.aspectRatio : GROK_NEAREST[req.aspectRatio])
      : undefined;
    // b64_json (verified live): xAI's hosted image URLs are ephemeral — base64
    // goes straight into our own storage like the Gemini path, so gallery
    // images can't rot when xAI's link expires.
    const data = await xaiFetch('/images/generations', {
      model, prompt: req.prompt, n: req.n ?? 1,
      response_format: 'b64_json',
      ...(ar ? { aspect_ratio: ar } : {}),
    });
    const b64 = data.data?.[0]?.b64_json;
    const url = data.data?.[0]?.url;
    if (!b64 && !url) throw new AiProviderError('xai', 'image', 'empty image response', 503);
    return {
      provider: 'xai', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: b64 ? { base64: b64 } : { url },
      ...xaiUsage(data),
    };
  },

  async imageEdit(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    const model = process.env.XAI_IMAGE_MODEL || 'grok-imagine-image-2.0';
    const start = Date.now();
    const data = await xaiFetch('/images/edits', {
      model, prompt: req.prompt,
      image: { url: `data:${req.mimeType};base64,${req.imageBase64}`, type: 'image_url' },
    });
    const url = data.data?.[0]?.url ?? data.url;
    if (!url) throw new AiProviderError('xai', 'imageEdit', 'empty image-edit response', 503);
    return {
      provider: 'xai', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: { url },
      ...xaiUsage(data),
    };
  },

  async video(req: VideoRequest): Promise<ProviderResult<{ url: string }>> {
    // Model ladder: grok-imagine-video-1.5 primary (newest, i2v-capable,
    // $0.08/s), base grok-imagine-video as the cheaper t2v-only fallback.
    // Override via XAI_VIDEO_LADDER (colon-sep).
    // Ladder matches xAI's LIVE /v1/video-generation-models (checked
    // 2026-08-14): only base + 1.5 exist; '-fast' and '-2' stay removed.
    const ladder = readLadder('XAI_VIDEO_LADDER', [
      process.env.XAI_VIDEO_MODEL || 'grok-imagine-video-1.5',
      'grok-imagine-video',
    ]);
    // Honor req.fast (drafts): pull grok-imagine-video-fast ($0.03/s) ahead of
    // the standard model so the cheap/fast variant runs first. Keeps the rest of
    // the ladder order intact as fallbacks. Default (fast falsy) is unchanged.
    if (req.fast) {
      ladder.sort((a, b) => {
        const fa = a.model.includes('-fast') ? 0 : 1;
        const fb = b.model.includes('-fast') ? 0 : 1;
        return fa - fb;
      });
    }
    // Image-to-video: grok-imagine-video-1.5 is the i2v-capable model (the base
    // grok-imagine-video is text-to-video only, 400s on a start frame). Run 1.5
    // first whenever a source/start frame is present.
    if (req.startImageBase64 || req.imageBase64) {
      ladder.sort((a, b) => (a.model.includes('1.5') ? 0 : 1) - (b.model.includes('1.5') ? 0 : 1));
    }
    const start = Date.now();
    // Frame conditioning (2026-06-04 fix): a SOURCE/START frame must go in xAI's
    // image-to-video `image` field (= "use this as the starting frame"), NOT
    // `reference_images` (= a loose style hint that's prompt-dominated and only
    // honored when the prompt cites @Image1 — which we never do). Sending the
    // product image as reference_images is exactly why Grok returned a different
    // product. Resolve start like Veo does: explicit start, else legacy image.
    // `reference_images` is reserved for genuine URL references with no start
    // frame. The two are mutually exclusive xAI modes — never send both.
    // NOTE: Grok's /videos/generations has no documented last_frame, so it can't
    // honor an END frame; image→video + bookended requests are routed to Veo by
    // the router (ai-router preferredPrimary), so Grok only runs here as a
    // degrade-safe fallback.
    const startB64 = req.startImageBase64 || req.imageBase64;
    const startMime = req.startMimeType || req.mimeType;
    const imageField = startB64 && startMime
      ? { image: { url: `data:${startMime};base64,${startB64}` } }
      : req.referenceImageUrls?.length
        ? { reference_images: req.referenceImageUrls.map(url => ({ url })) }
        : {};

    const ladderResult = await runModelLadder('xai', 'video', ladder, async (entry) => {
      const data = await xaiFetch('/videos/generations', {
        model: entry.model, prompt: req.prompt,
        duration: req.durationSeconds ?? 8,
        aspect_ratio: req.aspectRatio ?? '16:9',
        resolution: req.resolution ?? '720p',
        ...imageField,
      });
      return await pollVideo(data.request_id);
    });
    // Persist the clip to our storage (2026-07-03): vidgen.x.ai URLs are (a)
    // blocked by our CSP (default-src 'self', no media-src) so hot-linked
    // players render BROKEN in the UI, and (b) ephemeral. Every other video
    // engine already persists; Grok was the odd one out — 40 broken History
    // rows traced to this.
    const remoteUrl = ladderResult.result;
    let url = remoteUrl;
    try {
      const dl = await fetch(remoteUrl, { signal: AbortSignal.timeout(120000) });
      if (dl.ok) {
        const buf = Buffer.from(await dl.arrayBuffer());
        const saved = await storageService.saveFile(buf, `grok-${Date.now()}.mp4`, 'video/mp4');
        url = saved.fileUrl;
      }
    } catch (e: any) {
      console.warn(`[xai/video] persist failed (${e?.message}); returning remote url`);
    }
    return { provider: 'xai', model: ladderResult.modelUsed, latencyMs: Date.now() - start, fallbackUsed: false, output: { url } };
  },

  async analysis(_req: AnalysisRequest): Promise<never> {
    // 503 → retryable so the analysis chain falls THROUGH to the next provider
    // (dashscope) instead of breaking here. (A statusless throw was treated as
    // non-retryable and killed analysis fallback past Gemini.)
    throw new AiProviderError('xai', 'analysis', 'xAI analysis not supported — falling through', 503);
  },
};
