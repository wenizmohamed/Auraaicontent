// Enrichment health counters — answers the operational question "is RAG /
// memory retrieval actually firing in prod, or silently no-op'ing?".
//
// Both enrichers (knowledge-enricher, memory-enricher) are best-effort and
// string-in/string-out: on any miss they return the prompt untouched and stay
// invisible. Without instrumentation you can't tell a healthy "no relevant
// hits" from a broken "embeddings never populated / query embed throwing every
// time". These in-memory counters make the difference observable via
// /api/dashboard/ai-stats.
//
// Process-local + global (mirrors the telemetry ring buffer); resets on
// restart. Per-org breakdown is out of scope — this is a health gauge, not
// billing.

export type EnrichType = 'memory' | 'knowledge';

interface EnrichStat {
  gated: number;        // returned early WITHOUT a retrieval round-trip
                        // (skip flag / no orgId / empty prompt / zero-count gate)
  ran: number;          // performed the embedding + retrieval round-trip
  injected: number;     // ran AND prepended ≥1 item to the prompt
  empty: number;        // ran but found nothing above threshold (ran - injected)
  failed: number;       // retrieval threw (caught) — the silent-breakage case
  hits: number;         // total items prepended across all calls
  lastInjectedAt: string | null;
}

function blank(): EnrichStat {
  return { gated: 0, ran: 0, injected: 0, empty: 0, failed: 0, hits: 0, lastInjectedAt: null };
}

const stats: Record<EnrichType, EnrichStat> = {
  memory: blank(),
  knowledge: blank(),
};

// The enricher skipped retrieval entirely (cheap path).
export function recordGated(type: EnrichType): void {
  stats[type].gated++;
}

// The enricher ran a real retrieval. `injectedCount` = items prepended (0 = found
// nothing usable). Call this ONLY when an embedding/retrieval round-trip happened.
export function recordRan(type: EnrichType, injectedCount: number): void {
  const s = stats[type];
  s.ran++;
  if (injectedCount > 0) {
    s.injected++;
    s.hits += injectedCount;
    s.lastInjectedAt = new Date().toISOString();
  } else {
    s.empty++;
  }
}

// Retrieval was attempted but threw (and was caught). This is the case that
// looks identical to "no hits" from the outside — the whole point of the gauge.
export function recordFailed(type: EnrichType): void {
  stats[type].failed++;
}

export interface EnrichmentHealth extends EnrichStat {
  type: EnrichType;
  injectionRate: number; // injected / ran, rounded % (0 when ran=0)
}

export function getEnrichmentHealth(): EnrichmentHealth[] {
  return (Object.keys(stats) as EnrichType[]).map((type) => {
    const s = stats[type];
    return {
      type,
      ...s,
      injectionRate: s.ran > 0 ? Math.round((s.injected / s.ran) * 100) : 0,
    };
  });
}
