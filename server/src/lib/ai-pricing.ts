// Per-million-token pricing for the providers in our fallback chain. Keep
// this in sync with provider pricing pages — outdated prices skew the
// per-org cost numbers we show on the admin dashboard. Last updated 2026-04-29.
//
// All prices are USD per 1M tokens. Image/video pricing is per-call (the
// router doesn't get a token count back from those endpoints).

export interface PricePoint {
  promptPerM: number;     // USD per 1M prompt tokens
  completionPerM: number; // USD per 1M completion tokens
  perCall?: number;       // for image/video — USD per generated artifact
}

export const AI_PRICING: Record<string, PricePoint> = {
  // ─── Gemini ─────────────────────────────────────────────────────
  'gemini-3.1-pro-preview':            { promptPerM: 1.25, completionPerM: 10.00 },
  'gemini-3.1-flash-lite-preview':     { promptPerM: 0.10, completionPerM: 0.40 },
  'gemini-3.1-flash-image-preview':    { promptPerM: 0.30, completionPerM: 2.50, perCall: 0.039 },
  'imagen-4.0-ultra-generate-001':     { promptPerM: 0,    completionPerM: 0,    perCall: 0.06 },
  'veo-3.1-generate-preview':          { promptPerM: 0,    completionPerM: 0,    perCall: 0.50 },
  'veo-3.1-fast-generate-preview':     { promptPerM: 0,    completionPerM: 0,    perCall: 0.20 },
  'gemini-embedding-2-preview':        { promptPerM: 0.15, completionPerM: 0 },

  // ─── xAI Grok ───────────────────────────────────────────────────
  'grok-4.20':                         { promptPerM: 5.00, completionPerM: 15.00 },
  'grok-imagine-image':                { promptPerM: 0,    completionPerM: 0,    perCall: 0.07 },
  'grok-imagine-video':                { promptPerM: 0,    completionPerM: 0,    perCall: 0.40 },

  // ─── Moonshot Kimi ──────────────────────────────────────────────
  'kimi-k2.6':                         { promptPerM: 0.60, completionPerM: 2.40 },
};

export function priceFor(model: string): PricePoint {
  return AI_PRICING[model] ?? { promptPerM: 0, completionPerM: 0 };
}

export function computeCostUsd(model: string, promptTokens?: number, completionTokens?: number, calls = 1): number {
  const p = priceFor(model);
  const promptCost = ((promptTokens ?? 0) / 1_000_000) * p.promptPerM;
  const completionCost = ((completionTokens ?? 0) / 1_000_000) * p.completionPerM;
  const callCost = (p.perCall ?? 0) * calls;
  return Number((promptCost + completionCost + callCost).toFixed(6));
}
