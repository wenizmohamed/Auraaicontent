import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { promises as fsp } from 'fs';
import type { AiProvider, AnalysisRequest, ImageRequest, ProviderResult, TextRequest, VideoRequest } from './types.js';
import { AiProviderError } from './errors.js';
import { storageService } from '../storage.service.js';

const TIMEOUT = parseInt(process.env.GEMINI_TIMEOUT_MS || '60000', 10);

// Retry budget before dropping to ai-router's cross-provider fallback.
// Retry only on Google's 503 "high demand" throttle + 429 rate-limit — those
// are short-lived (seconds) and worth a backoff. DO NOT retry on timeout:
// if Google hasn't responded in TIMEOUT ms the path is blocked, retrying
// burns another full TIMEOUT window and nginx (120s) will 504 the client
// before we fall to Grok.  (2026-04-23 Weni regression: "all models start
// with grok" — caused by retry-on-timeout stacking 4×120s = 8 min per call.)
const RETRY_BACKOFFS_MS = [500, 1500]; // 2 retries, ~2s total worst case

function getAI(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiProviderError('gemini', 'init', 'GEMINI_API_KEY not set', 401);
  return new GoogleGenAI({ apiKey: key });
}

function safeJsonParse(text: string, label: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/[\[{][\s\S]*[\]}]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    throw new AiProviderError('gemini', label, `JSON parse failed. Response: ${text.slice(0, 200)}`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AiProviderError('gemini', label, `timeout after ${ms}ms`)), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }).catch(e => { clearTimeout(timer); reject(e); });
  });
}

// Transient = 503 (Google throttle) + 429 (rate limit) ONLY. Timeout and
// network errors are NOT retryable here — the upper-level ai-router falls to
// Grok immediately on any non-transient failure, which is faster than burning
// another TIMEOUT window inside this provider. Permanent (400/401/403/404,
// safety, malformed) propagate unchanged.
function isGeminiTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as any)?.status ?? (err as any)?.statusCode;
  if (status === 503 || status === 429) return true;
  if (status && status >= 400 && status < 500 && status !== 429) return false;
  return /\b503\b|\b429\b|high demand|overloaded|rate.?limit|too many requests|try again later/i.test(msg);
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isGeminiTransient(err) || attempt === RETRY_BACKOFFS_MS.length) throw err;
      const wait = RETRY_BACKOFFS_MS[attempt];
      const reason = err instanceof Error ? err.message.slice(0, 80) : String(err).slice(0, 80);
      console.warn(`[gemini/${label}] transient (attempt ${attempt + 1}/${RETRY_BACKOFFS_MS.length + 1}); backoff ${wait}ms — ${reason}`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

export const geminiProvider: AiProvider = {
  name: 'gemini',

  async text(req: TextRequest): Promise<ProviderResult<string | object>> {
    const ai = getAI();
    // Default text model is gemini-3-flash-preview — 10x faster than 3.1-pro
    // for simple rewrites (creative/prompt/improve, generateMonth headlines)
    // and rarely hits 503. Analysis (vision) stays on 3.1-pro via a separate
    // env below.  (2026-04-23 fix for "all models start with grok" regression.)
    const model = process.env.GEMINI_TEXT_MODEL || 'gemini-3-flash-preview';
    const start = Date.now();
    const response = await withRetry('text', () => withTimeout(
      ai.models.generateContent({
        model,
        contents: req.system ? `${req.system}\n\n${req.prompt}` : req.prompt,
        config: req.json ? { responseMimeType: 'application/json' } : undefined,
      }),
      TIMEOUT, 'text',
    ));
    const text = response.text ?? '';
    return {
      provider: 'gemini', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: req.json ? safeJsonParse(text, 'text') : text,
    };
  },

  async image(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    const ai = getAI();
    const model = req.quality === 'ultra'
      ? (process.env.GEMINI_IMAGE_ULTRA_MODEL || 'imagen-4.0-ultra-generate-001')
      : (process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview');
    const start = Date.now();
    const response = await withRetry('image', () => withTimeout(
      ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: req.prompt }] }],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          ...(req.aspectRatio ? { imageConfig: { aspectRatio: req.aspectRatio } } : {}),
        },
      }),
      TIMEOUT, 'image',
    ));
    const part = (response as any).candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    return {
      provider: 'gemini', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: { base64: part?.inlineData?.data },
    };
  },

  async imageEdit(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    const ai = getAI();
    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview';
    const start = Date.now();
    const parts: any[] = [];
    if (req.imageBase64 && req.mimeType) {
      parts.push({ inlineData: { mimeType: req.mimeType, data: req.imageBase64 } });
    }
    for (const ref of req.referenceImages || []) {
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
    }
    parts.push({ text: req.prompt });
    const response = await withRetry('imageEdit', () => withTimeout(
      ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          ...(req.aspectRatio ? { imageConfig: { aspectRatio: req.aspectRatio } } : {}),
        },
      }),
      TIMEOUT, 'imageEdit',
    ));
    const part = (response as any).candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    return {
      provider: 'gemini', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: { base64: part?.inlineData?.data },
    };
  },

  async video(req: VideoRequest): Promise<ProviderResult<{ url: string }>> {
    const ai = getAI();
    const model = req.fast
      ? (process.env.GEMINI_VIDEO_FAST_MODEL || 'veo-3.1-fast-generate-preview')
      : (process.env.GEMINI_VIDEO_MODEL || 'veo-3.1-generate-preview');
    const start = Date.now();
    let operation = await ai.models.generateVideos({
      model,
      prompt: req.prompt,
      config: {
        aspectRatio: req.aspectRatio || '16:9',
        ...(req.resolution ? { resolution: req.resolution } : {}),
      },
      ...(req.imageBase64 && req.mimeType ? {
        image: { imageBytes: req.imageBase64, mimeType: req.mimeType },
      } : {}),
    });
    while (!operation.done) {
      await new Promise(r => setTimeout(r, 10000));
      operation = await ai.operations.getVideosOperation({ operation });
    }
    const file = (operation as any).response?.generatedVideos?.[0]?.video;
    if (!file?.uri) throw new AiProviderError('gemini', 'video', 'No video URI in response');

    // Gemini Veo returns a temporary, auth-required URL like
    //   https://generativelanguage.googleapis.com/v1beta/files/<id>:download?alt=media
    // The browser cannot load that directly (401/empty), and the URL expires
    // shortly after the operation completes. Download it via the SDK NOW (with
    // the API key embedded in the client) and persist via storageService so the
    // frontend gets a stable /uploads/... URL it can render with <video src>.
    const filename = `veo-${Date.now()}.mp4`;
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    await fsp.mkdir(uploadsDir, { recursive: true });
    const tmpPath = path.join(uploadsDir, `tmp-${filename}`);
    try {
      await ai.files.download({ file, downloadPath: tmpPath });
      const buf = await fsp.readFile(tmpPath);
      const { fileUrl } = await storageService.saveFile(buf, filename, 'video/mp4');
      return {
        provider: 'gemini', model, latencyMs: Date.now() - start, fallbackUsed: false,
        output: { url: fileUrl },
      };
    } finally {
      await fsp.unlink(tmpPath).catch(() => { /* ignore */ });
    }
  },

  async analysis(req: AnalysisRequest): Promise<ProviderResult<object>> {
    const ai = getAI();
    // Vision analysis needs 3.1-pro quality — uses its own env so flipping
    // GEMINI_TEXT_MODEL to flash doesn't downgrade image analysis.
    const model = process.env.GEMINI_ANALYSIS_MODEL || 'gemini-3.1-pro-preview';
    const start = Date.now();
    const response = await withRetry('analysis', () => withTimeout(
      ai.models.generateContent({
        model,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: req.mimeType, data: req.imageBase64 } },
            { text: req.prompt },
          ],
        }],
        config: { responseMimeType: 'application/json' },
      }),
      TIMEOUT, 'analysis',
    ));
    return {
      provider: 'gemini', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: safeJsonParse(response.text || '{}', 'analysis'),
    };
  },
};
