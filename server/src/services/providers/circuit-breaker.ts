/**
 * Per-provider circuit breaker for the AI fallback chain.
 *
 * model-chain.ts already soft-skips an individual MODEL that hit a quota error.
 * This adds the layer above it: when a whole PROVIDER (gemini / xai) keeps
 * failing — outage, deprecated key, region block, model-rot across every rung —
 * stop sending it the first attempt on every request. Right now an outage means
 * each call eats the provider's full timeout (text 70s, video 120s) BEFORE
 * falling through to the next provider. For a paying client during a Gemini
 * incident that's a full timeout tax on every single request.
 *
 * State machine, per provider:
 *   closed     → normal; every call attempts it
 *   open       → tripped; skip it (go straight to fallback) until cooldown ends
 *   half-open  → cooldown elapsed; allow probe traffic. Success → closed, fail → open
 *
 * Half-open has no in-flight lock: if many requests arrive simultaneously while
 * half-open they all probe (not exactly one). That's an acceptable v1 tradeoff —
 * a burst of probes during recovery is harmless, and a probe-in-flight flag adds
 * concurrency complexity we don't need yet. Worst case a still-down provider
 * eats N timeouts on the recovery tick instead of one.
 *
 * Only RETRYABLE failures count toward tripping. A 400/401 (bad payload, bad
 * key) is the caller's fault, not the provider being down — counting those
 * would trip the breaker on a bug and mask it.
 *
 * SAFETY INVARIANT: the breaker never blocks the LAST usable provider. The
 * router asks `filterAvailable()` which guarantees ≥1 provider comes back even
 * if every breaker is open — a breaker that refuses all calls is strictly worse
 * than eating one timeout. Worst case we degrade to today's behaviour.
 */

type BreakerState = 'closed' | 'open' | 'half-open';

interface ProviderBreaker {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number;          // unix ms the breaker last tripped
  lastFailureReason: string;
  tripCount: number;         // lifetime trips — surfaced in telemetry
}

const ENABLED = process.env.AI_CIRCUIT_BREAKER_ENABLED !== 'false';
// N consecutive retryable failures trip the breaker. 4 ≈ "this isn't a blip".
const THRESHOLD = Number(process.env.AI_CB_THRESHOLD) || 4;
// How long to stay open before allowing a half-open probe.
const COOLDOWN_MS = Number(process.env.AI_CB_COOLDOWN_MS) || 30_000;

const breakers = new Map<string, ProviderBreaker>();

function get(provider: string): ProviderBreaker {
  let b = breakers.get(provider);
  if (!b) {
    b = { state: 'closed', consecutiveFailures: 0, openedAt: 0, lastFailureReason: '', tripCount: 0 };
    breakers.set(provider, b);
  }
  // Lazy transition open → half-open once the cooldown has elapsed, so callers
  // don't need a background timer. Read-time evaluation keeps it dependency-free.
  if (b.state === 'open' && Date.now() - b.openedAt >= COOLDOWN_MS) {
    b.state = 'half-open';
  }
  return b;
}

/** True if the provider should be skipped right now (breaker open, pre-cooldown). */
export function isProviderOpen(provider: string): boolean {
  if (!ENABLED) return false;
  return get(provider).state === 'open';
}

/**
 * Reorder/filter an ordered provider list by breaker state.
 *   - drops providers whose breaker is `open`
 *   - keeps `closed` and `half-open` (half-open gets its one probe)
 *   - GUARANTEES ≥1 provider: if everything is open, returns the original list
 *     unchanged (best-effort beats refusing the request).
 * Order within the kept set is preserved (primary stays first).
 */
export function filterAvailable<T extends { name: string }>(providers: T[]): T[] {
  if (!ENABLED) return providers;
  const available = providers.filter(p => !isProviderOpen(p.name));
  return available.length > 0 ? available : providers;
}

/** Record a successful call — closes a half-open breaker, resets the counter. */
export function recordSuccess(provider: string): void {
  if (!ENABLED) return;
  const b = get(provider);
  if (b.state !== 'closed' || b.consecutiveFailures > 0) {
    if (b.state !== 'closed') {
      console.log(`[circuit] ${provider} recovered → closed`);
    }
    b.state = 'closed';
    b.consecutiveFailures = 0;
    b.lastFailureReason = '';
  }
}

/**
 * Record a retryable failure. Trips the breaker to `open` once consecutive
 * retryable failures reach THRESHOLD, or immediately if a half-open probe
 * fails. Non-retryable failures should NOT be passed here (see module note).
 */
export function recordFailure(provider: string, reason: string): void {
  if (!ENABLED) return;
  const b = get(provider);

  // A failed half-open probe means the provider is still down — re-open
  // immediately without waiting for THRESHOLD again.
  if (b.state === 'half-open') {
    b.state = 'open';
    b.openedAt = Date.now();
    b.lastFailureReason = reason.slice(0, 120);
    b.tripCount++;
    console.warn(`[circuit] ${provider} half-open probe failed → open ${COOLDOWN_MS}ms (${reason.slice(0, 80)})`);
    return;
  }

  b.consecutiveFailures++;
  b.lastFailureReason = reason.slice(0, 120);
  if (b.consecutiveFailures >= THRESHOLD && b.state === 'closed') {
    b.state = 'open';
    b.openedAt = Date.now();
    b.tripCount++;
    console.warn(`[circuit] ${provider} tripped → open ${COOLDOWN_MS}ms after ${b.consecutiveFailures} consecutive failures (${reason.slice(0, 80)})`);
  }
}

export interface CircuitSnapshot {
  provider: string;
  state: BreakerState;
  consecutiveFailures: number;
  tripCount: number;
  cooldownRemainingMs: number;
  lastFailureReason: string;
}

/** Snapshot for the dashboard /ai-stats endpoint. */
export function getCircuitSnapshot(): CircuitSnapshot[] {
  const out: CircuitSnapshot[] = [];
  for (const [provider, b] of breakers) {
    // Touch state to apply any pending open → half-open transition.
    get(provider);
    out.push({
      provider,
      state: b.state,
      consecutiveFailures: b.consecutiveFailures,
      tripCount: b.tripCount,
      cooldownRemainingMs: b.state === 'open' ? Math.max(0, COOLDOWN_MS - (Date.now() - b.openedAt)) : 0,
      lastFailureReason: b.lastFailureReason,
    });
  }
  return out;
}

/** Test/ops escape hatch — force every breaker back to closed. */
export function resetAllCircuits(): void {
  breakers.clear();
}
