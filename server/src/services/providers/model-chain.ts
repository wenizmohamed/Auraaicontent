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
import { isRetryableAiError } from './errors.js';

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

  for (let i = 0; i < ladder.length; i++) {
    const entry = ladder[i];
    const skip = shouldSoftSkip(entry.model);
    if (skip.skip) {
      console.warn(`[ladder] ${providerName}/${task} SKIP ${entry.model} (recently failed: ${skip.reason})`);
      attempted.push(`${entry.model} (soft-skip)`);
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
      const isLast = i === ladder.length - 1;
      console.warn(
        `[ladder] ${providerName}/${task} ${entry.model} failed (${retryable ? 'retryable' : 'fatal'}): ${msg.slice(0, 120)}${isLast || !retryable ? '' : ' — trying next model'}`,
      );
      if (!retryable || isLast) {
        // Either fatal (don't waste calls on the rest of the ladder), or last model in ladder
        if (!retryable) {
          break; // bail the ladder; outer router shouldn't retry on fatal either
        }
        // last model — fall through and throw lastErr below
      }
    }
  }
  throw lastErr || new Error(`[ladder] ${providerName}/${task} all ${attempted.length} models failed without error`);
}

/**
 * Read a colon-separated model ladder from env, falling back to a single
 * default. Format: "model-a:model-b:model-c". Whitespace tolerated.
 *
 * Used in providers like:
 *   readLadder('GEMINI_VIDEO_LADDER', ['veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-2.0-generate-001'])
 */
export function readLadder(envVar: string, defaults: string[]): ModelLadderEntry[] {
  const raw = process.env[envVar];
  const list = raw && raw.trim()
    ? raw.split(':').map(s => s.trim()).filter(Boolean)
    : defaults;
  return list.map(m => ({ model: m }));
}
