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
