import type { FastifyReply } from 'fastify';

// Retryable errors that should trigger fallback to the next provider
// Non-retryable errors (bad request, auth, safety) should NOT fallback

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
  /safety/i,
  /blocked/i,
  /content.?filter/i,
  /malformed/i,
  /invalid.*payload/i,
  /missing.*required/i,
];

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
    const status = allRateLimited ? 429 : 503;

    super(
      allRateLimited
        ? `All AI providers rate-limited for ${task}. Try again shortly.`
        : `All AI providers failed for ${task} (${providerNames}). ${failures[failures.length - 1]?.message || 'Unknown error'}`,
    );

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
export function sendAiError(reply: FastifyReply, err: unknown, fallbackMessage: string) {
  if (err instanceof AllProvidersFailedError) {
    return reply.status(err.statusCode).send({
      error: err.message,
      providers: err.failures,
    });
  }
  const e = err as { statusCode?: number; message?: string } | null;
  const status = e?.statusCode ?? 502;
  return reply.status(status).send({
    error: e?.message ?? fallbackMessage,
  });
}
