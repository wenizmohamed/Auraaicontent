/**
 * Per-(provider, task) circuit breaker for the AI fallback chain.
 *
 * model-chain.ts already soft-skips an individual MODEL that hit a quota error.
 * This adds the layer above it: when a whole PROVIDER keeps failing for a given
 * TASK — outage, deprecated key, region block, model-rot across every rung —
 * stop sending it the first attempt on every request. Right now an outage means
 * each call eats the provider's full timeout (text 70s, video 120s) BEFORE
 * falling through to the next provider. For a paying client during a Gemini
 * incident that's a full timeout tax on every single request.
 *
 * WHY THE KEY IS (provider, task) NOT just provider:
 *   video is the slow, flaky, high-timeout task. Veo returns retryable prose
 *   errors ("high demand", "internal server issue", "try again later") and
 *   safety rejections far more often than text does. With a provider-only key,
 *   4 video failures in 30s would trip the SHARED gemini breaker and stall
 *   text/image/analysis too — the exact cross-task latency inflation we saw in
 *   prod (a 27s prompt/improve caused by a Veo block tripping gemini). Keying
 *   by (provider, task) isolates the blast radius: gemini:video can be open
 *   while gemini:text stays closed. Outage protection is unchanged — text is
 *   the highest-volume task, so a real Gemini outage trips gemini:text fast.
 *
 * State machine, per (provider, task):
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
 * would trip the breaker on a bug and mask it. Additionally, SAFETY/CONTENT
 * blocks are excluded by the caller (ai-router) even though they're retryable:
 * a content-policy rejection is a property of the prompt, not provider health,
 * so it must never trip the breaker.
 *
 * SAFETY INVARIANT: the breaker never blocks the LAST usable provider. The
 * router asks `filterAvailable()` which guarantees ≥1 provider comes back even
 * if every breaker is open — a breaker that refuses all calls is strictly worse
 * than eating one timeout. Worst case we degrade to today's behaviour.
 */

type BreakerState = 'closed' | 'open' | 'half-open';

interface ProviderBreaker {
  provider: string;
  task: string;
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

// image_edit shares a provider's image capability/health, so it shares the
// image breaker rather than fragmenting into its own.
function normTask(task: string): string {
  return task === 'image_edit' ? 'image' : task;
}

function keyOf(provider: string, task: string): string {
  return `${provider}:${normTask(task)}`;
}

function get(provider: string, task: string): ProviderBreaker {
  const key = keyOf(provider, task);
  let b = breakers.get(key);
  if (!b) {
    b = {
      provider, task: normTask(task), state: 'closed',
      consecutiveFailures: 0, openedAt: 0, lastFailureReason: '', tripCount: 0,
    };
    breakers.set(key, b);
  }
  // Lazy transition open → half-open once the cooldown has elapsed, so callers
  // don't need a background timer. Read-time evaluation keeps it dependency-free.
  if (b.state === 'open' && Date.now() - b.openedAt >= COOLDOWN_MS) {
    b.state = 'half-open';
  }
  return b;
}

/** True if the (provider, task) breaker is open (skip it, pre-cooldown). */
export function isProviderOpen(provider: string, task: string): boolean {
  if (!ENABLED) return false;
  return get(provider, task).state === 'open';
}

/**
 * Reorder/filter an ordered provider list by breaker state for a given task.
 *   - drops providers whose breaker is `open` FOR THIS TASK
 *   - keeps `closed` and `half-open` (half-open gets its one probe)
 *   - GUARANTEES ≥1 provider: if everything is open, returns the original list
 *     unchanged (best-effort beats refusing the request).
 * Order within the kept set is preserved (primary stays first).
 */
export function filterAvailable<T extends { name: string }>(providers: T[], task: string): T[] {
  if (!ENABLED) return providers;
  const available = providers.filter(p => !isProviderOpen(p.name, task));
  return available.length > 0 ? available : providers;
}

/** Record a successful call — closes a half-open breaker, resets the counter. */
export function recordSuccess(provider: string, task: string): void {
  if (!ENABLED) return;
  const b = get(provider, task);
  if (b.state !== 'closed' || b.consecutiveFailures > 0) {
    if (b.state !== 'closed') {
      console.log(`[circuit] ${b.provider}:${b.task} recovered → closed`);
    }
    b.state = 'closed';
    b.consecutiveFailures = 0;
    b.lastFailureReason = '';
  }
}

/**
 * Record a retryable failure for a (provider, task). Trips the breaker to `open`
 * once consecutive retryable failures reach THRESHOLD, or immediately if a
 * half-open probe fails. Non-retryable failures AND safety/content blocks should
 * NOT be passed here (see module note + ai-router call site).
 */
export function recordFailure(provider: string, task: string, reason: string): void {
  if (!ENABLED) return;
  const b = get(provider, task);

  // A failed half-open probe means the provider is still down — re-open
  // immediately without waiting for THRESHOLD again.
  if (b.state === 'half-open') {
    b.state = 'open';
    b.openedAt = Date.now();
    b.lastFailureReason = reason.slice(0, 120);
    b.tripCount++;
    console.warn(`[circuit] ${b.provider}:${b.task} half-open probe failed → open ${COOLDOWN_MS}ms (${reason.slice(0, 80)})`);
    return;
  }

  b.consecutiveFailures++;
  b.lastFailureReason = reason.slice(0, 120);
  if (b.consecutiveFailures >= THRESHOLD && b.state === 'closed') {
    b.state = 'open';
    b.openedAt = Date.now();
    b.tripCount++;
    console.warn(`[circuit] ${b.provider}:${b.task} tripped → open ${COOLDOWN_MS}ms after ${b.consecutiveFailures} consecutive failures (${reason.slice(0, 80)})`);
  }
}

export interface CircuitSnapshot {
  provider: string;
  task: string;
  state: BreakerState;
  consecutiveFailures: number;
  tripCount: number;
  cooldownRemainingMs: number;
  lastFailureReason: string;
}

/** Snapshot for the dashboard /ai-stats endpoint. One row per (provider, task). */
export function getCircuitSnapshot(): CircuitSnapshot[] {
  const out: CircuitSnapshot[] = [];
  for (const b of breakers.values()) {
    // Touch state to apply any pending open → half-open transition.
    get(b.provider, b.task);
    out.push({
      provider: b.provider,
      task: b.task,
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
