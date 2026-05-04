import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { promises as fsp } from 'fs';
import type { AiProvider, AnalysisRequest, ImageRequest, ProviderResult, TextRequest, VideoRequest } from './types.js';
import { AiProviderError } from './errors.js';
import { storageService } from '../storage.service.js';
import { runModelLadder, readLadder } from './model-chain.js';

const TIMEOUT = parseInt(process.env.GEMINI_TIMEOUT_MS || '60000', 10);
// Separate budget for image paths.  Google's nano-banana edit model
// (gemini-3.1-flash-image-preview) is currently dead for our API key
// (verified 2026-04-23: direct curl hangs → 70s timeout, no response).
// Short budget here makes the ai-router fall to xai/grok-imagine-image in
// seconds instead of making the user wait a full minute per image edit.
const IMAGE_EDIT_TIMEOUT = parseInt(process.env.GEMINI_IMAGE_EDIT_TIMEOUT_MS || '15000', 10);

// Retry budget before dropping to ai-router's cross-provider fallback.
// Retry only on Google's 503 "high demand" throttle + 429 rate-limit — those
// are short-lived (seconds) and worth a backoff. DO NOT retry on timeout:
// if Google hasn't responded in TIMEOUT ms the path is blocked, retrying
// burns another full TIMEOUT window and nginx (120s) will 504 the client
// before we fall to Grok.  (2026-04-23 Weni regression: "all models start
// with grok" — caused by retry-on-timeout stacking 4×120s = 8 min per call.)
const RETRY_BACKOFFS_MS = [500, 1500]; // 2 retries, ~2s total worst case

let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (_ai) return _ai;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiProviderError('gemini', 'init', 'GEMINI_API_KEY not set', 401);
  _ai = new GoogleGenAI({ apiKey: key });
  return _ai;
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
    // Model ladder: Pro → Flash-Lite → 2.5-Flash. When Pro 429s on quota the
    // ladder auto-tries Flash on the same provider before crossing to xAI.
    // Override via GEMINI_TEXT_LADDER (colon-sep). Single-model env still works.
    const ladder = readLadder('GEMINI_TEXT_LADDER', [
      process.env.GEMINI_TEXT_MODEL || 'gemini-3.1-pro-preview',
      process.env.GEMINI_FLASH_TEXT_MODEL || 'gemini-3.1-flash-lite-preview',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
    ]);
    const start = Date.now();

    const ladderResult = await runModelLadder('gemini', 'text', ladder, async (entry) =>
      withRetry('text', () => withTimeout(
        ai.models.generateContent({
          model: entry.model,
          contents: req.system ? `${req.system}\n\n${req.prompt}` : req.prompt,
          config: req.json ? { responseMimeType: 'application/json' } : undefined,
        }),
        TIMEOUT, 'text',
      )),
    );
    const response = ladderResult.result;
    const model = ladderResult.modelUsed;
    const text = response.text ?? '';
    const usage = (response as any).usageMetadata;
    return {
      provider: 'gemini', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: req.json ? safeJsonParse(text, 'text') : text,
      promptTokens: usage?.promptTokenCount,
      completionTokens: usage?.candidatesTokenCount,
      totalTokens: usage?.totalTokenCount,
    };
  },

  async image(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    const ai = getAI();
    // Model ladder: ultra requests get the heavy imagen first then drop to
    // gemini-flash-image; standard requests start with flash-image and ladder
    // through imagen-fast → imagen-3. Override via GEMINI_IMAGE_LADDER /
    // GEMINI_IMAGE_ULTRA_LADDER (colon-sep).
    const defaultLadder = req.quality === 'ultra'
      ? readLadder('GEMINI_IMAGE_ULTRA_LADDER', [
          process.env.GEMINI_IMAGE_ULTRA_MODEL || 'imagen-4.0-ultra-generate-001',
          'imagen-4.0-generate-001',
          'gemini-3.1-flash-image-preview',
        ])
      : readLadder('GEMINI_IMAGE_LADDER', [
          process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview',
          'imagen-4.0-generate-001',
          'imagen-3.0-generate-002',
        ]);
    const start = Date.now();

    const ladderResult = await runModelLadder('gemini', 'image', defaultLadder, async (entry) => {
      // Branch on model family — imagen-* uses generateImages(), gemini-*-image-*
      // uses generateContent() with responseModalities. Wrong dispatch = silent hang.
      const isImagen = /^imagen-/i.test(entry.model);
      if (isImagen) {
        const r = await withRetry('image', () => withTimeout(
          ai.models.generateImages({
            model: entry.model,
            prompt: req.prompt,
            config: {
              numberOfImages: 1,
              ...(req.aspectRatio ? { aspectRatio: req.aspectRatio } : {}),
            },
          }),
          TIMEOUT, 'image',
        ));
        return { kind: 'imagen' as const, response: r };
      }
      const r = await withRetry('image', () => withTimeout(
        ai.models.generateContent({
          model: entry.model,
          contents: [{ parts: [{ text: req.prompt }] }],
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
            ...(req.aspectRatio ? { imageConfig: { aspectRatio: req.aspectRatio } } : {}),
          },
        }),
        TIMEOUT, 'image',
      ));
      return { kind: 'gemini' as const, response: r };
    });

    const model = ladderResult.modelUsed;
    if (ladderResult.result.kind === 'imagen') {
      const base64 = ladderResult.result.response.generatedImages?.[0]?.image?.imageBytes;
      return {
        provider: 'gemini', model, latencyMs: Date.now() - start, fallbackUsed: false,
        output: { base64 },
      };
    }
    const part = (ladderResult.result.response as any).candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    return {
      provider: 'gemini', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: { base64: part?.inlineData?.data },
    };
  },

  async imageEdit(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    const ai = getAI();
    // Edit needs nano-banana (gemini-*-image-*), NOT imagen — imagen-4.0
    // is text-to-image only and returns 404 on :generateContent.  Separate
    // env so flipping GEMINI_IMAGE_MODEL=imagen-* (for generate) does not
    // break the edit path. (2026-04-23 root-caused via systematic-debugging.)
    const model = process.env.GEMINI_IMAGE_EDIT_MODEL
      || 'gemini-3.1-flash-image-preview';
    const start = Date.now();
    const parts: any[] = [];
    if (req.imageBase64 && req.mimeType) {
      parts.push({ inlineData: { mimeType: req.mimeType, data: req.imageBase64 } });
    }
    for (const ref of req.referenceImages || []) {
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
    }
    parts.push({ text: req.prompt });
    // Image-edit only works via gemini-*-image-* (nano-banana) on the public
    // API.  When that model is throttled/dead at Google's end, the shorter
    // IMAGE_EDIT_TIMEOUT lets ai-router fall to xai/grok-imagine-image fast
    // instead of making the user wait the full TEXT-grade timeout per click.
    const response = await withRetry('imageEdit', () => withTimeout(
      ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          ...(req.aspectRatio ? { imageConfig: { aspectRatio: req.aspectRatio } } : {}),
        },
      }),
      IMAGE_EDIT_TIMEOUT, 'imageEdit',
    ));
    const part = (response as any).candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    return {
      provider: 'gemini', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: { base64: part?.inlineData?.data },
    };
  },

  async video(req: VideoRequest): Promise<ProviderResult<{ url: string }>> {
    const ai = getAI();
    // Model ladder: try Veo Pro → Veo Fast → Veo 2 (Pro and Fast meter
    // separately; Veo 2 is older and may have leftover quota even when
    // 3.1 is exhausted). Override via GEMINI_VIDEO_LADDER env (colon-sep).
    const defaultLadder = req.fast
      ? ['veo-3.1-fast-generate-preview', 'veo-3.1-generate-preview', 'veo-2.0-generate-001']
      : ['veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-2.0-generate-001'];
    const ladder = readLadder('GEMINI_VIDEO_LADDER', defaultLadder);
    const start = Date.now();

    const ladderResult = await runModelLadder('gemini', 'video', ladder, async (entry) => {
      let operation = await ai.models.generateVideos({
        model: entry.model,
        prompt: req.prompt,
        config: {
          aspectRatio: req.aspectRatio || '16:9',
          // personGeneration is required for image-to-video on most regions —
          // 'allow_adult' lets the model render people from the source image
          // instead of immediately filtering everything containing humans.
          personGeneration: 'allow_adult' as any,
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
      return operation;
    });
    const operation = ladderResult.result;
    const model = ladderResult.modelUsed;
    // Veo can return done:true with NO video — typically because of a safety
    // filter, an invalid image, or quota exhaustion. The previous code threw
    // a generic "No video URI" which made these indistinguishable. Now we
    // inspect operation.error first, then the safety-filter fields on the
    // response, before falling back to a verbose dump.
    const op: any = operation;
    if (op.error) {
      throw new AiProviderError('gemini', 'video', `Veo operation error: ${op.error.message || JSON.stringify(op.error).slice(0, 200)}`);
    }
    // Common safety-block field names across Veo versions
    const blocked =
      op.response?.raiMediaFilteredReasons?.[0] ||
      op.response?.generatedVideos?.[0]?.raiFilteredReason ||
      op.response?.generatedVideos?.[0]?.video?.filteredReason;
    if (blocked) {
      throw new AiProviderError('gemini', 'video', `Veo safety-filtered: ${blocked}`);
    }
    // Try multiple URI paths — the SDK shape has shifted between versions.
    const file =
      op.response?.generatedVideos?.[0]?.video ||
      op.response?.video ||
      op.response?.videos?.[0];
    if (!file?.uri) {
      const shape = JSON.stringify(op.response || op).slice(0, 400);
      console.warn(`[gemini/video] No URI in operation. Shape: ${shape}`);
      throw new AiProviderError('gemini', 'video', `No video URI in response (shape: ${shape.slice(0, 120)}…)`);
    }

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
    const usage = (response as any).usageMetadata;
    return {
      provider: 'gemini', model, latencyMs: Date.now() - start, fallbackUsed: false,
      output: safeJsonParse(response.text || '{}', 'analysis'),
      promptTokens: usage?.promptTokenCount,
      completionTokens: usage?.candidatesTokenCount,
      totalTokens: usage?.totalTokenCount,
    };
  },
};
