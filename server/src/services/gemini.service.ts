import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';

// ─── Client singleton ────────────────────────────────────────────

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!_client) {
    if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
    _client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
  return _client;
}

// ─── Model map (kept for embeddings + any direct Gemini paths) ──

export const MODELS = {
  planner: env.GEMINI_FLASH_TEXT_MODEL,    // gemini-3.1-flash-lite-preview
  strategist: env.GEMINI_TEXT_MODEL,        // gemini-3.1-pro-preview
  image: env.GEMINI_IMAGE_MODEL,            // gemini-3.1-flash-image-preview
  video: env.GEMINI_VIDEO_MODEL,            // veo-3.1-generate-preview
  embedding: env.GEMINI_EMBEDDING_MODEL,    // gemini-embedding-2-preview
} as const;

// ─── generateText (legacy — use aiRouter.text() for new code) ───

export async function generateText(
  prompt: string,
  model: string = MODELS.planner,
): Promise<string> {
  const client = getClient();
  const response = await client.models.generateContent({ model, contents: prompt });
  const text = response.text;
  if (!text) throw new Error(`Gemini returned empty response (model: ${model})`);
  return text;
}

// ─── generateJson (legacy — use aiRouter.text({ json: true })) ──

export async function generateJson<T>(
  prompt: string,
  model: string = MODELS.planner,
): Promise<T> {
  const client = getClient();
  const response = await client.models.generateContent({
    model,
    contents: prompt + '\n\nReturn ONLY valid JSON. No markdown, no code fences.',
    config: { responseMimeType: 'application/json' },
  });

  const text = response.text || '';
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/[\[{][\s\S]*[\]}]/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error(`Failed to parse JSON from Gemini (model: ${model}). Raw: ${text.slice(0, 200)}`);
  }
}

// ─── embedText (stays Gemini-only — no xAI embeddings) ──────────

// Query-embedding cache + 429 backoff (2026-07-03 audit: the preview
// embedding model's low RPM quota intermittently 429'd and knowledge
// injection silently dropped to 0%). Cache repeated queries (retrieval
// re-embeds similar prompts constantly) and retry once through the burst.
const EMBED_CACHE = new Map<string, { vec: number[]; at: number }>();
const EMBED_CACHE_TTL = 15 * 60 * 1000;
const EMBED_CACHE_MAX = 500;

export async function embedText(text: string): Promise<number[]> {
  const key = text.length <= 512 ? text : text.slice(0, 256) + '\u0000' + text.length + '\u0000' + text.slice(-256);
  const hit = EMBED_CACHE.get(key);
  if (hit && Date.now() - hit.at < EMBED_CACHE_TTL) return hit.vec;
  let client;
  try {
    client = getClient();
  } catch {
    throw new GeminiUnavailableError('Gemini API key not configured. Knowledge embedding requires Gemini.');
  }
  try {
    let response;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await client.models.embedContent({
          model: MODELS.embedding,
          contents: text,
        });
        break;
      } catch (err: any) {
        const m = err?.message || String(err);
        if (attempt < 2 && /rate.?limit|429|too many requests|quota/i.test(m)) {
          await new Promise(r => setTimeout(r, attempt === 0 ? 800 : 2500));
          continue;
        }
        throw err;
      }
    }
    const embedding = response.embeddings?.[0]?.values;
    if (!embedding?.length) throw new Error('Gemini returned empty embedding');
    if (EMBED_CACHE.size >= EMBED_CACHE_MAX) EMBED_CACHE.delete(EMBED_CACHE.keys().next().value!);
    EMBED_CACHE.set(key, { vec: embedding, at: Date.now() });
    return embedding;
  } catch (err: any) {
    if (err instanceof GeminiUnavailableError) throw err;
    // Wrap raw Google SDK errors with a clean message
    const msg = err?.message || String(err);
    if (/rate.?limit|429|too many requests|quota/i.test(msg)) {
      throw new GeminiUnavailableError('Gemini rate-limited. Knowledge embedding temporarily unavailable.');
    }
    if (/403|permission|denied|billing/i.test(msg)) {
      throw new GeminiUnavailableError('Gemini permission denied. Check API key and billing.');
    }
    throw new GeminiUnavailableError(`Gemini embedding failed: ${msg.slice(0, 150)}`);
  }
}

/**
 * Clean error for Gemini-only features (knowledge embedding/retrieval).
 * Signals to the caller that this feature requires Gemini and it's currently unavailable.
 */
export class GeminiUnavailableError extends Error {
  public statusCode = 503;
  public geminiOnly = true;
  constructor(message: string) {
    super(message);
    this.name = 'GeminiUnavailableError';
  }
}
