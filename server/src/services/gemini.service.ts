import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { db } from '../db/prisma.js';
import { computeCostUsd, isPriced } from '../lib/ai-pricing.js';

// Tenant context for cost attribution on embedding calls. Optional so callers
// without an org (there shouldn't be any in prod) still work — they just skip
// the UsageEvent write rather than crash.
export interface EmbedContext { orgId?: string | null; userId?: string | null; clientId?: string | null }

// Record an embedding call in the UsageEvent meter. Fire-and-forget: embedding
// spend was previously invisible (never metered) — this closes that blind spot.
// The preview embedContent API doesn't return a token count, so we estimate at
// ~4 chars/token (Gemini's rough ratio); good enough for cost attribution.
function recordEmbedUsage(text: string, ctx?: EmbedContext): void {
  if (!ctx?.orgId) {
    console.warn('[embed] usage NOT tracked — missing orgId (caller did not pass EmbedContext)');
    return;
  }
  const model = MODELS.embedding;
  const promptTokens = Math.max(1, Math.ceil(text.length / 4));
  const priced = isPriced(model);
  void db.usageEvent.create({
    data: {
      orgId: ctx.orgId,
      userId: ctx.userId ?? null,
      kind: 'embedding',
      units: promptTokens,
      costUsd: computeCostUsd(model, promptTokens, 0, 1),
      ref: ctx.clientId ?? null,
      metadata: {
        model, task: 'embedding', provider: 'gemini', priced,
        promptTokens, completionTokens: 0,
        ...(priced ? {} : { unpricedModel: model }),
      },
    },
  }).catch(() => { /* metering must never break the embed path */ });
}

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
// Embeddings feed best-effort knowledge/memory retrieval that runs BEFORE every
// text call (month plan included). Without a ceiling a hung embed request
// blocked generation indefinitely; callers already treat a failure as "no
// knowledge context" and carry on.
const EMBED_TIMEOUT_MS = parseInt(process.env.GEMINI_EMBED_TIMEOUT_MS || '15000', 10);

// DashScope embedding fallback (2026-10-13): embedText is Gemini-only, so every
// 403/quota blip silently disabled knowledge+memory injection for all
// generations ("Knowledge retrieval failed, continuing without it" in every
// pm2 log). text-embedding-v4 on the Alibaba workspace key carries the lane.
//
// DIMENSION LOCK (2026-11-05): the stored chunk vectors are 3072-dim Gemini
// embeddings. text-embedding-v4 returns 1024 by default and caps at 2048 —
// it can NEVER produce 3072. So when Gemini is down, this fallback returned a
// shorter vector, cosineSimilarity's length guard returned 0 for EVERY chunk,
// and retrieveContext happily returned the first N chunks in arbitrary order
// (a query for "ceramic coating" served CSS junk and the lead-gen pack).
// Silent garbage is worse than no context, so the fallback must refuse to
// serve a vector it cannot compare against the store.
const STORED_EMBED_DIMS = 3072;
async function dashscopeEmbed(text: string): Promise<number[]> {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error('DASHSCOPE_API_KEY not set');
  const base = process.env.DASHSCOPE_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
  const res = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: process.env.DASHSCOPE_EMBED_MODEL || 'text-embedding-v4', input: text.slice(0, 8000) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`dashscope embed ${res.status}`);
  const data = await res.json() as any;
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || !vec.length) throw new Error('dashscope embed: empty vector');
  if (vec.length !== STORED_EMBED_DIMS) {
    // A different embedding space. Comparing it to 3072-dim Gemini vectors
    // is meaningless, so fail loudly instead of serving arbitrary chunks.
    throw new Error(
      `dashscope embed: ${vec.length}-dim vector cannot be compared against the ${STORED_EMBED_DIMS}-dim store ` +
      `(different embedding space — refusing to serve unranked results)`,
    );
  }
  return vec;
}

export async function embedText(text: string, ctx?: EmbedContext): Promise<number[]> {
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
          config: { abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS) },
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
    recordEmbedUsage(text, ctx); // meter the (real, non-cached) embedding call
    return embedding;
  } catch (err: any) {
    // Fallback lane: Gemini down → DashScope embedding before giving up.
    try {
      const vec = await dashscopeEmbed(text);
      console.warn('[gemini/embedding] primary failed — served by dashscope fallback');
      EMBED_CACHE.set(key, { vec, at: Date.now() });
      return vec;
    } catch (fbErr: any) {
      console.warn('[gemini/embedding] dashscope fallback also failed:', fbErr?.message || fbErr);
    }
    if (err instanceof GeminiUnavailableError) throw err;
    // Wrap raw Google SDK errors with a clean message
    const msg = err?.message || String(err);
    // ORDER MATTERS, twice over:
    //  1. A drained prepaid balance answers 402, and letting the /billing/i
    //     branch swallow it reported "permission denied" — sending the
    //     operator hunting for a key/permission problem that does not exist.
    //  2. The free tier's quota message ("You exceeded your current quota,
    //     please check your plan and billing details") CONTAINS the word
    //     "billing", so a /billing/i body regex misreads a rate limit as a
    //     drained balance. Judge on the status and on the specific phrases.
    const status = err?.status ?? err?.statusCode ?? err?.code;
    if (status === 429 || /rate.?limit|too many requests|exceeded your current quota|\b429\b/i.test(msg)) {
      throw new GeminiUnavailableError('Gemini rate-limited. Knowledge embedding temporarily unavailable.');
    }
    if (status === 402 || /payment.?required|prepayment|insufficient.?(credit|balance|funds)|\b402\b/i.test(msg)) {
      throw new GeminiUnavailableError('Gemini credits depleted. Top up the Google AI Studio balance to resume knowledge embedding.');
    }
    if (/403|permission|denied/i.test(msg)) {
      throw new GeminiUnavailableError('Gemini permission denied. Check the API key.');
    }
    throw new GeminiUnavailableError(`Gemini embedding failed: ${msg.slice(0, 150)}`);
  }
}

/**
 * Batch embedding via Gemini's `batchEmbedContents` endpoint (2026-11-05).
 *
 * WHY: re-embedding the 6,117 orphaned chunks one HTTP call at a time took
 * days of wall clock at the 429 rate limit. `batchEmbedContents` embeds up
 * to 100 texts in ONE call and returns the same 3072-dim vectors, so the
 * backfill finishes in minutes.
 *
 * The batch endpoint has no DashScope fallback on purpose: the fallback lane
 * produces a different-dimensional vector, which would poison the store. A
 * batch either comes back at 3072 dims or it fails loudly.
 */
export async function embedBatch(texts: string[], ctx?: EmbedContext): Promise<number[][]> {
  if (!texts.length) return [];
  const key = env.GEMINI_API_KEY;
  if (!key) throw new GeminiUnavailableError('Gemini API key not configured. Knowledge embedding requires Gemini.');

  const model = MODELS.embedding;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents?key=${key}`;

  // The free tier's requests-per-minute cap answers 429 on a burst. A batch
  // of 100 is 100 embed operations against that cap, so it trips easily.
  // Retry with exponential backoff before giving up — otherwise a bulk
  // backfill stops dead on a transient burst limit.
  const MAX_ATTEMPTS = 4;
  let response: Response | null = null;
  let lastBody = '';
  let lastStatus = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: texts.map(t => ({
            model: `models/${model}`,
            content: { parts: [{ text: t }] },
          })),
        }),
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS * 4),
      });
    } catch (err: any) {
      if (attempt === MAX_ATTEMPTS - 1) {
        throw new GeminiUnavailableError(`Gemini batch embedding failed: ${err?.message || String(err)}`);
      }
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }

    if (response.ok) break;
    lastStatus = response.status;
    lastBody = await response.text().catch(() => '');
    // Only a rate limit is worth retrying. A 402 (drained balance) or a 400
    // (bad request) will not fix itself.
    if (response.status === 429 && attempt < MAX_ATTEMPTS - 1) {
      const waitMs = 3000 * Math.pow(2, attempt);
      console.warn(`[gemini/embedding] batch rate-limited (429), retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    break;
  }

  if (!response || !response.ok) {
    const body = lastBody;
    const status = lastStatus || response?.status || 0;
    // ORDER MATTERS. The free tier's quota message is
    //   "You exceeded your current quota, please check your plan and billing details."
    // which contains the word "billing" — so a body-text regex for /billing/i
    // misreads a RATE LIMIT as a drained balance. Judge on the STATUS first.
    if (status === 429 || /rate.?limit|too many requests/i.test(body)) {
      throw new GeminiUnavailableError('Gemini rate-limited. Knowledge embedding temporarily unavailable.');
    }
    if (status === 402 || /payment.?required|prepayment|insufficient.?(credit|balance|funds)/i.test(body)) {
      throw new GeminiUnavailableError('Gemini credits depleted. Top up the Google AI Studio balance to resume knowledge embedding.');
    }
    throw new GeminiUnavailableError(`Gemini batch embedding failed (HTTP ${status}): ${body.replace(/\s+/g, ' ').slice(0, 150)}`);
  }

  const body = await response.json() as { embeddings?: { values: number[] }[] };
  const vectors = body.embeddings || [];
  if (vectors.length !== texts.length) {
    throw new GeminiUnavailableError(`Gemini batch embedding returned ${vectors.length} vectors for ${texts.length} inputs.`);
  }
  recordEmbedUsage(texts.join('\n').slice(0, 20000), ctx);
  return vectors.map(v => v.values);
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
