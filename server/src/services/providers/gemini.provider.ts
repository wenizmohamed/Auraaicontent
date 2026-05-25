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
// Was 15000 (deliberately short to fail-fast to xAI), but xAI ran out of
// credits 2026-05-05 and Gemini imageEdit can take 60-180s under load —
// the short timeout caused every imageEdit to surface PROVIDER UNAVAILABLE.
// 240000 lets Gemini complete; if that becomes painful again, re-add a
// shorter ceiling once xAI billing is restored.
const IMAGE_EDIT_TIMEOUT = parseInt(process.env.GEMINI_IMAGE_EDIT_TIMEOUT_MS || '240000', 10);

// Retry budget before dropping to ai-router's cross-provider fallback.
// Retry only on Google's 503 "high demand" throttle + 429 rate-limit — those
// are short-lived (seconds) and worth a backoff. DO NOT retry on timeout:
// if Google hasn't responded in TIMEOUT ms the path is blocked, retrying
// burns another full TIMEOUT window and nginx (120s) will 504 the client
// before we fall to Grok.  (2026-04-23 Weni regression: "all models start
// with grok" — caused by retry-on-timeout stacking 4×120s = 8 min per call.)
const RETRY_BACKOFFS_MS = [500, 1500]; // 2 retries, ~2s total worst case

// ─── Anatomy-stability PromptEnricher ──────────────────────────────
// Workshop feedback 2026-05-06 (Haneen Malak): body movements inconsistency,
// limbs warp generation-to-generation. Gemini 3.1 Flash Image + Imagen-4 both
// drift on human anatomy unless explicitly told to stay coherent. Append
// stability tokens whenever the prompt mentions body/pose/anatomy/limbs/
// portrait/full-body. Token list mirrors the canonical Imagen-4 anatomy
// stabilizers + the Gemini negative-prompt pattern recommended by DeepMind.
// Idempotent: re-enriching an already-enriched prompt is a no-op.
const BODY_KEYWORDS = /\b(body|bodies|pose|posing|anatomy|anatomical|limb|limbs|portrait|full[\s-]?body|figure|silhouette|standing|sitting|walking|running|dancing|stretching|yoga|workout|model|person|man|woman|girl|boy|child|character|hands?|fingers?|arms?|legs?|feet|knees?|elbows?|shoulders?)\b/i;
const STABILITY_TOKENS = ', anatomically correct, coherent limbs, natural proportions, stable anatomy, well-formed hands';
function enrichBodyPrompt(prompt: string): string {
  if (!prompt) return prompt;
  if (prompt.includes('anatomically correct')) return prompt; // idempotent
  if (!BODY_KEYWORDS.test(prompt)) return prompt;
  return prompt.trim().replace(/[.,;]\s*$/, '') + STABILITY_TOKENS;
}

let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (_ai) return _ai;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiProviderError('gemini', 'init', 'GEMINI_API_KEY not set', 401);
  _ai = new GoogleGenAI({ apiKey: key });
  return _ai;
}

// Best-effort repair for Gemini responses that get truncated mid-stream
// (common at high content lengths — workshop 2026-05-06 generate-month bug).
// Strategy: trim non-JSON wrapper, close unterminated string, close unbalanced
// brackets. Not a full JSON5 parser, just enough to recover the structured
// payload when the only damage is "ran out of tokens".
function repairTruncatedJson(text: string): string {
  let s = text.trim();
  const firstBrace = s.search(/[\[{]/);
  if (firstBrace > 0) s = s.slice(firstBrace);
  // Close an unterminated string (odd number of unescaped quotes).
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') inString = !inString;
  }
  if (inString) s += '"';
  // Drop a trailing comma before the missing close bracket.
  s = s.replace(/,\s*$/, '');
  // Balance brackets.
  const stack: string[] = [];
  inString = false;
  escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' && stack[stack.length - 1] === '{') stack.pop();
    else if (c === ']' && stack[stack.length - 1] === '[') stack.pop();
  }
  while (stack.length) {
    const open = stack.pop();
    s += open === '{' ? '}' : ']';
  }
  return s;
}

function safeJsonParse(text: string, label: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/[\[{][\s\S]*[\]}]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    // Last resort: repair a truncated payload (workshop fix 2026-05-06).
    try {
      const repaired = repairTruncatedJson(text);
      const parsed = JSON.parse(repaired);
      console.warn(`[gemini/${label}] truncated JSON repaired (${text.length} → ${repaired.length} chars)`);
      return parsed;
    } catch {}
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
          // json:true means we usually want a structured payload (e.g. monthly
          // content plan with 18-30 posts). The default token budget can truncate
          // mid-array; bump explicitly to avoid the workshop "truncated JSON" bug.
          config: req.json
            ? { responseMimeType: 'application/json', maxOutputTokens: 32768 }
            : { maxOutputTokens: 8192 },
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
    // Anatomy-stability enrichment (workshop 2026-05-06 #2 — Haneen)
    const enrichedPrompt = enrichBodyPrompt(req.prompt);
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
            prompt: enrichedPrompt,
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
          contents: [{ parts: [{ text: enrichedPrompt }] }],
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
    // Anatomy-stability enrichment (workshop 2026-05-06 #2 — Haneen)
    const enrichedPrompt = enrichBodyPrompt(req.prompt);
    const parts: any[] = [];
    if (req.imageBase64 && req.mimeType) {
      parts.push({ inlineData: { mimeType: req.mimeType, data: req.imageBase64 } });
    }
    for (const ref of req.referenceImages || []) {
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
    }
    parts.push({ text: enrichedPrompt });
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
      // personGeneration field is intentionally omitted: Google's accepted
      // enum has churned twice in 2026-05-04 alone — 'allow_adult' and
      // 'dont_allow' deprecated, then 'allow_all' rejected by Pro while
      // accepted by Fast. Pro/Fast have different validators. Omitting
      // works on both and uses the model's default safety policy.
      // Re-add only with an env-driven opt-in once the enum stabilizes.
      // Start-frame resolution: explicit startImageBase64 wins over the legacy
      // imageBase64 field (which currently doubles as the start frame). End
      // frame is workshop 2026-05-06 #3 — pass via `lastFrame` per Veo 3.1
      // SDK shape so the model interpolates between two known anchors instead
      // of randomly extrapolating from a single starting still.
      const startB64 = req.startImageBase64 || req.imageBase64;
      const startMime = req.startMimeType || req.mimeType;
      const hasStart = !!(startB64 && startMime);
      const hasEnd = !!(req.endImageBase64 && req.endMimeType);
      let operation = await ai.models.generateVideos({
        model: entry.model,
        prompt: enrichBodyPrompt(req.prompt),
        config: {
          aspectRatio: req.aspectRatio || '16:9',
          ...(req.resolution ? { resolution: req.resolution } : {}),
          ...(process.env.GEMINI_VIDEO_PERSON_GENERATION
            ? { personGeneration: process.env.GEMINI_VIDEO_PERSON_GENERATION as any }
            : {}),
          // End frame (workshop 2026-05-06 #3). lastFrame is a field of
          // GenerateVideosConfig — NOT a top-level generateVideos param. The
          // previous code spread it at the top level behind an `as any`, so the
          // SDK silently dropped it: Veo only ever saw the start frame and
          // free-ran to a random ending (Haneen: "doesn't end as the image I
          // add", faces drifting, mushy motion). Two real anchors let Veo
          // interpolate instead of extrapolate. lastFrame is image-to-video
          // only, so it also requires a start frame.
          ...(hasStart && hasEnd
            ? { lastFrame: { imageBytes: req.endImageBase64, mimeType: req.endMimeType } }
            : {}),
          // Identity stability: when conditioning on real frames, steer Veo away
          // from re-inventing the subject mid-clip ("changing people's faces ...
          // things get mushy"). Set GEMINI_VIDEO_NEGATIVE="" to opt out.
          ...(hasStart
            ? {
                negativePrompt:
                  process.env.GEMINI_VIDEO_NEGATIVE ??
                  'face morphing, identity change, distorted faces, warping, melting, extra fingers, blurry, low quality',
              }
            : {}),
        },
        ...(hasStart ? {
          image: { imageBytes: startB64, mimeType: startMime },
        } : {}),
      });
      // Symmetry with xAI: client-side 10-min deadline on the poll loop so a
      // hung getVideosOperation can't hold a slot forever. Veo's server-side
      // deadline is ~10min anyway; this just bounds the failure mode.
      const deadline = Date.now() + 10 * 60 * 1000;
      while (!operation.done) {
        if (Date.now() > deadline) {
          throw new AiProviderError('gemini', 'video', 'poll deadline exceeded after 10min');
        }
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
