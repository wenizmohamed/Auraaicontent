import type { FastifyReply } from 'fastify';

// Retryable errors that should trigger fallback to the next provider
// Non-retryable errors (bad request, auth, malformed payload) should NOT fallback
//
// Safety-filter / blocked / content-filter errors ARE retryable across providers
// because each provider has different content policies (e.g. Veo refuses
// photorealistic children but xAI Grok image-to-video might accept them).
// They were previously NON-retryable on the assumption that "policy = bad
// request" — but that assumed all providers share the same policy, which they
// don't.

const RETRYABLE_PATTERNS = [
  /timeout/i,
  /ETIMEDOUT/,
  /ECONNREFUSED/,
  /ECONNRESET/,
  /rate.?limit/i,
  /429/,
  /too many requests/i,
  /5\d{2}/,
  /server error/i,
  /service unavailable/i,
  /internal server error/i,
  /gateway timeout/i,
  /bad gateway/i,
  /temporarily unavailable/i,
  /overloaded/i,
  /fetch failed/i,
  /network/i,
  /ENOTFOUND/,
  /socket hang up/i,
  /aborted/i,
  // Veo wording — Google's video model returns these prose errors instead
  // of HTTP-style codes. Without these, every "high demand" or "internal
  // issue" hit was bailing the chain before fallback could fire (incident
  // 2026-05-05, jobs 7f02fdc2 + 2a893571 on radix-api PID 141449).
  /high demand/i,
  /internal server issue/i,
  /try again later/i,
  /try again in a few minutes/i,
  /spikes in demand/i,
  // Cross-provider safety differences — see comment above
  /safety/i,
  /blocked/i,
  /content.?filter/i,
  /safety.?filter/i,
];

const NON_RETRYABLE_PATTERNS = [
  /400/,
  /bad request/i,
  /401/,
  /403/,
  /unauthorized/i,
  /forbidden/i,
  /invalid.*key/i,
  /api.?key/i,
  /malformed/i,
  /invalid.*payload/i,
  /missing.*required/i,
];

/** True if the message indicates the content itself was rejected by a safety
 *  policy — useful for surfacing a smart "all providers refused this content"
 *  message when every fallback also blocked. */
export function isSafetyBlock(msg: string): boolean {
  return /safety|blocked|content.?filter|policy|prohibited|child|photorealistic/i.test(msg);
}

export function isRetryableAiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as any)?.status || (err as any)?.statusCode;

  // Explicit non-retryable check first
  if (NON_RETRYABLE_PATTERNS.some(p => p.test(msg))) return false;
  if (status && status >= 400 && status < 500 && status !== 429) return false;

  // Then check retryable patterns
  if (RETRYABLE_PATTERNS.some(p => p.test(msg))) return true;
  if (status === 429 || (status && status >= 500)) return true;

  // Default: don't fallback on unknown errors
  return false;
}

export class AiProviderError extends Error {
  constructor(
    public provider: string,
    public task: string,
    message: string,
    public statusCode?: number,
  ) {
    super(`[${provider}/${task}] ${message}`);
    this.name = 'AiProviderError';
  }
}

export interface ProviderFailure {
  provider: string;
  message: string;
  retryable: boolean;
}

/**
 * Thrown when ALL providers in the fallback chain have failed.
 * Carries per-provider failure summaries and a synthesized HTTP status code.
 */
export class AllProvidersFailedError extends Error {
  public failures: ProviderFailure[];
  public statusCode: number;

  constructor(task: string, failures: ProviderFailure[]) {
    const providerNames = failures.map(f => f.provider).join(', ');
    const allRateLimited = failures.length > 0 && failures.every(f =>
      /rate.?limit|429|too many requests/i.test(f.message),
    );
    const allSafetyBlocked = failures.length > 0 && failures.every(f => isSafetyBlock(f.message));
    const status = allRateLimited ? 429 : allSafetyBlocked ? 422 : 503;

    // Distinguish billing-quota exhaustion ("you exceeded your plan") from
    // burst rate-limiting ("too many requests in a window"). The first needs
    // a billing top-up; the second needs the user to wait.
    const allBillingExhausted = failures.length > 0 && failures.every(f =>
      /exceeded your current quota|resource has been exhausted|insufficient.?credit|insufficient.?balance|payment.?required|billing|plan and billing/i.test(f.message),
    );

    // Per-provider top-up links so the error can guide the user to the right place.
    const TOP_UP_LINKS: Record<string, string> = {
      gemini: 'https://aistudio.google.com/usage',
      xai: 'https://console.x.ai/',
      moonshot: 'https://platform.moonshot.cn/console',
    };

    let msg: string;
    if (allBillingExhausted) {
      const links = failures
        .map(f => TOP_UP_LINKS[f.provider])
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i);
      const linkHint = links.length ? ` Top up: ${links.join(' or ')}.` : '';
      msg = `Out of ${task} credits on every provider (${providerNames}).${linkHint}`;
    } else if (allRateLimited) {
      msg = `All AI providers rate-limited for ${task}. Wait ~60s and retry — if it persists, your provider plan may be exhausted (Gemini: https://aistudio.google.com/usage · xAI: https://console.x.ai/).`;
    } else if (allSafetyBlocked) {
      // Surface the actual block reason from the last provider so the user
      // can adjust the source material. Most provider errors include "Sorry,
      // we can't ..." which is itself a clear UI-grade message.
      const lastReason = failures[failures.length - 1]?.message || '';
      msg = `Every provider declined this content for safety reasons. ${lastReason.replace(/^\[[^\]]+\]\s*/, '').slice(0, 240)}`;
    } else {
      msg = `All AI providers failed for ${task} (${providerNames}). ${failures[failures.length - 1]?.message || 'Unknown error'}`;
    }

    super(msg);

    this.name = 'AllProvidersFailedError';
    this.failures = failures;
    this.statusCode = status;
  }
}

/**
 * Send a structured AI error response. Maps AllProvidersFailedError to the correct
 * HTTP status (429 for rate-limit, 503 for unavailable) and includes per-provider
 * failure summaries. Falls back to 502 for generic errors.
 */
export function sendAiError(reply: FastifyReply, err: any, fallbackMessage: string) {
  if (err instanceof AllProvidersFailedError) {
    return reply.status(err.statusCode).send({
      error: err.message,
      providers: err.failures,
    });
  }
  const status = err?.statusCode || 502;
  return reply.status(status).send({
    error: err?.message || fallbackMessage,
  });
}
