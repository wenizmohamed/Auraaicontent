/**
 * Model-ladder fallback inside a single provider.
 *
 * The cross-provider fallback (gemini → xai → moonshot) lives in ai-router.ts.
 * This helper adds an INNER ladder: when Gemini Veo Pro returns 429, try
 * Veo Fast on the same provider before bubbling out to xAI. Most providers
 * meter Pro and Flash quotas separately, so a Pro 429 doesn't mean Flash is
 * also exhausted.
 *
 * It also keeps a tiny in-memory soft-skip cache: if model M just hit a
 * quota error in the last 60 seconds, skip M entirely on the next attempt
 * to save the user the latency + the 429 round-trip. Cleared automatically.
 */
import { AiProviderError, isRetryableAiError, isProviderWideCredentialError } from './errors.js';

interface SoftSkipEntry {
  until: number;     // unix ms
  reason: string;
}

const SKIP_CACHE = new Map<string, SoftSkipEntry>();
const SOFT_SKIP_MS = 60_000;            // 60s — short enough to retry, long enough to not waste
const QUOTA_PATTERN = /exceeded your current quota|resource has been exhausted|insufficient.?credit|insufficient.?balance|payment.?required|429|rate.?limit/i;

function shouldSoftSkip(model: string): { skip: true; reason: string } | { skip: false } {
  const e = SKIP_CACHE.get(model);
  if (!e) return { skip: false };
  if (Date.now() > e.until) {
    SKIP_CACHE.delete(model);
    return { skip: false };
  }
  return { skip: true, reason: e.reason };
}

function softSkipModel(model: string, reason: string) {
  SKIP_CACHE.set(model, {
    until: Date.now() + SOFT_SKIP_MS,
    reason: reason.slice(0, 120),
  });
}

export interface ModelLadderEntry {
  model: string;
  /** Optional model-specific override (e.g. fast variant uses lower max_tokens) */
  options?: Record<string, unknown>;
}

export interface ModelLadderResult<T> {
  result: T;
  modelUsed: string;
  modelsAttempted: string[];
}

/**
 * Run `attempt(model)` against each model in the ladder. Bails to the next
 * model when the error is retryable (quota / rate-limit / safety / network).
 * Throws the LAST error if every model in the ladder fails — the outer
 * cross-provider fallback in ai-router.ts will then try the next provider.
 *
 * Empty ladders / single-model ladders are supported and degrade to a
 * single attempt.
 */
export async function runModelLadder<T>(
  providerName: string,
  task: string,
  ladder: ModelLadderEntry[],
  attempt: (entry: ModelLadderEntry) => Promise<T>,
): Promise<ModelLadderResult<T>> {
  const attempted: string[] = [];
  let lastErr: unknown = null;
  let lastSkipReason = '';

  for (let i = 0; i < ladder.length; i++) {
    const entry = ladder[i];
    const skip = shouldSoftSkip(entry.model);
    if (skip.skip) {
      console.warn(`[ladder] ${providerName}/${task} SKIP ${entry.model} (recently failed: ${skip.reason})`);
      attempted.push(`${entry.model} (soft-skip)`);
      lastSkipReason = skip.reason;
      continue;
    }
    attempted.push(entry.model);
    try {
      const result = await attempt(entry);
      return { result, modelUsed: entry.model, modelsAttempted: attempted };
    } catch (err: any) {
      lastErr = err;
      const msg = err?.message || String(err);
      const isQuota = QUOTA_PATTERN.test(msg);
      // Dead model ids (deprecated/renamed upstream) get cached too — without
      // this every draft video paid a guaranteed 404 round-trip on the dead
      // rung before reaching a live model (grok-imagine-video-fast, 2026-07).
      const isDeadModel = /does not exist|not.?found|no longer available|has been deprecated/i.test(msg) && ((err as any)?.status === 404 || /404/.test(msg));
      if (isQuota || isDeadModel) {
        // Cache the skip — saves the next caller from a 429/404 round-trip.
        softSkipModel(entry.model, msg.slice(0, 80));
      }
      const retryable = isRetryableAiError(err);
      const providerWide = isProviderWideCredentialError(msg);
      const isLast = i === ladder.length - 1;
      console.warn(
        `[ladder] ${providerName}/${task} ${entry.model} failed (${providerWide ? 'provider-wide' : retryable ? 'retryable' : 'fatal'}): ${msg.slice(0, 120)}${isLast || !retryable || providerWide ? '' : ' — trying next model'}`,
      );
      if (providerWide) {
        // Key/subscription/group-wide failure: do not burn calls on sibling models
        // of the same provider; bubble straight out so ai-router hops to the next provider.
        break;
      }
      // The provider refused the user's INPUT (e.g. BytePlus
      // InputImageSensitiveContentDetected): every sibling model reads the same
      // input and refuses it too (seen 2026-11-14: three Seedance rungs in a row).
      // Hand over to the next provider instead. Output refusals still try the
      // next model, since a fresh render can pass.
      if (/Input(Image|Text|Video|Audio)?SensitiveContentDetected/i.test(msg)) {
        break;
      }
      if (!retryable || isLast) {
        // Either fatal (don't waste calls on the rest of the ladder), or last model in ladder
        if (!retryable) {
          break; // bail the ladder; outer router shouldn't retry on fatal either
        }
        // last model — fall through and throw lastErr below
      }
    }
  }
  throw lastErr || new AiProviderError(
    providerName,
    task,
    `all ${attempted.length} models soft-skipped (${lastSkipReason || 'temporarily unavailable'})`,
    503,
  );
}

/**
 * Read a colon-separated model ladder from env, falling back to a single
 * default. Format: "model-a:model-b:model-c". Whitespace tolerated.
 *
 * Used in providers like:
 *   readLadder('GEMINI_VIDEO_LADDER', [])   // Veo is retired; Omni runs on the Interactions API, not this ladder
 */
export function readLadder(envVar: string, defaults: string[]): ModelLadderEntry[] {
  const raw = process.env[envVar];
  const list = raw && raw.trim()
    ? raw.split(':').map(s => s.trim()).filter(Boolean)
    : defaults;
  return list.map(m => ({ model: m }));
}
