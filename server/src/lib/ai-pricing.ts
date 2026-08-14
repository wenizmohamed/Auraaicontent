// Per-million-token pricing for the providers in our fallback chain. Keep
// this in sync with the providers' published pricing pages — outdated
// prices skew the per-org cost numbers on the admin dashboard and bill
// orgs either too much or too little.
//
// Last verified 2026-05-21 from:
//   - ai.google.dev/gemini-api/docs/pricing
//   - docs.x.ai/docs/models
//   - platform.kimi.ai/docs/pricing/chat-k26.md
//
// TIERED MODELS — Gemini 3.x charges higher per-token rates above 200k
// tokens of prompt. We use the ≤200k tier as the baseline for billing —
// real chatbot turns are well under that. Long-context jobs are
// under-attributed by ~2× but those are rare enough to not matter for
// per-user cost reports. To bill exactly: add prompt-length awareness in
// computeCostUsd (Phase 2).
//
// VIDEO — Veo + grok-imagine-video are billed per generated SECOND, not
// per call. Pass `durationSeconds` to computeCostUsd so the row reflects
// the real clip length. Without duration we fall back to a default 8s
// assumption — better than zero, but flag in metadata so the admin view
// can mark these as approximate.

export interface PricePoint {
  promptPerM: number;       // USD per 1M prompt tokens
  completionPerM: number;   // USD per 1M completion tokens
  perCall?: number;         // USD per generated artifact (one image)
  perSecond?: number;       // USD per second of generated video
}

export const AI_PRICING: Record<string, PricePoint> = {
  // ─── Gemini ─────────────────────────────────────────────────────
  // gemini-3.1-pro-preview: $2/$12 (≤200k) – $4/$18 (>200k). Baseline ≤200k.
  'gemini-3.1-pro-preview':            { promptPerM: 2.00, completionPerM: 12.00 },
  // gemini-3.1-flash-lite-preview: $0.25/$1.50 text. Audio prompt rate higher.
  'gemini-3.1-flash-lite-preview':     { promptPerM: 0.25, completionPerM: 1.50 },
  // gemini-3.1-flash-image-preview: $0.50 input / $60 output (output is
  // priced per IMAGE not per-token in disguise). Effective ~$0.045/img
  // at low-res, $0.151/img at high-res; perCall set to a 1024px midpoint.
  'gemini-3.1-flash-image-preview':    { promptPerM: 0.50, completionPerM: 60.00, perCall: 0.10 },
  // gemini-3.1-flash-image: GA of the preview above, same card ($0.50 in /
  // $60 image-out per M ≈ $0.067 per 1K image). Verified live 2026-08-14.
  'gemini-3.1-flash-image':            { promptPerM: 0.50, completionPerM: 60.00, perCall: 0.10 },
  // nano-banana-pro = gemini-3-pro-image family: $2.00 in / $120 image-out
  // per M ≈ $0.134 per 1K/2K image, $0.24 at 4K (Google card 2026-08-14).
  'nano-banana-pro-preview':           { promptPerM: 2.00, completionPerM: 120.00, perCall: 0.15 },
  'gemini-3-pro-image':                { promptPerM: 2.00, completionPerM: 120.00, perCall: 0.14 },  // GA premium image (ultra tier)
  // imagen-4.0-ultra: $0.06/image (unchanged).
  'imagen-4.0-ultra-generate-001':     { promptPerM: 0,    completionPerM: 0,    perCall: 0.06 },
  // veo-3.1-generate-preview: $0.40 (720p) – $0.60 (4k) per SECOND of video.
  // Default to mid ($0.50/s); admin view should multiply by clip duration.
  'veo-3.1-generate-preview':          { promptPerM: 0,    completionPerM: 0,    perSecond: 0.50 },
  // veo-3.1-fast-generate-preview: $0.10 – $0.30 per second. Mid: $0.20/s.
  'veo-3.1-fast-generate-preview':     { promptPerM: 0,    completionPerM: 0,    perSecond: 0.20 },
  // veo-3.1-lite-generate-preview: $0.05 (720p) / $0.08 (1080p) per second.
  'veo-3.1-lite-generate-preview':     { promptPerM: 0,    completionPerM: 0,    perSecond: 0.05 },
  // gemini-omni-flash-preview (video via Interactions API): $17.50/1M video
  // tokens ≈ $0.10/s of 720p (Google pricing page, verified 2026-07-02).
  'gemini-omni-flash-preview':         { promptPerM: 0,    completionPerM: 0,    perSecond: 0.10 },
  // wan2.7 t2v (DashScope ws workspace): list price not published on the
  // catalog page — ESTIMATE $0.10/s pending console verification.
  'wan2.7-t2v':                        { promptPerM: 0,    completionPerM: 0,    perSecond: 0.10 },
  'wan2.7-t2v-2026-06-12':             { promptPerM: 0,    completionPerM: 0,    perSecond: 0.10 },
  // wan2.7 i2v + r2v: same DashScope video tier as t2v, and the Creative Studio
  // engine picker quotes users $0.10/s for both. Unpriced until 2026-08-02 —
  // every image→video and Reference→Video clip logged a $0 UsageEvent while
  // video is ~97% of AI spend. The boot guard only audits *_MODEL env vars, so
  // hardcoded provider rungs like these must be priced by hand.
  'wan2.7-i2v':                        { promptPerM: 0,    completionPerM: 0,    perSecond: 0.10 },
  'wan2.7-i2v-2026-04-25':             { promptPerM: 0,    completionPerM: 0,    perSecond: 0.10 },
  'wan2.7-r2v':                        { promptPerM: 0,    completionPerM: 0,    perSecond: 0.10 },
  'wan2.7-r2v-2026-06-12':             { promptPerM: 0,    completionPerM: 0,    perSecond: 0.10 },
  // veo-2.0-generate-001: legacy fallback, $0.05/sec (Google deprecated tier).
  'veo-2.0-generate-001':              { promptPerM: 0,    completionPerM: 0,    perSecond: 0.05 },
  // gemini-embedding-2-preview: $0.20/M for text; multimodal climbs higher.
  'gemini-embedding-2-preview':        { promptPerM: 0.20, completionPerM: 0 },
  // ── "-latest" aliases actually configured in prod .env (GEMINI_*_MODEL).
  // These are the rolling pointers Google exposes; without them every text/
  // analysis/chat call was costed at $0. Mapped to their versioned price.
  'gemini-pro-latest':                 { promptPerM: 2.00, completionPerM: 12.00 }, // = 3.1 Pro
  // gemini-3.7-flash: $0.75/$3.75 promo through 2026-12-31, then $1.50/$7.50
  // (Google pricing page, verified 2026-08-14). Bump these two on 2027-01-01.
  'gemini-3.7-flash':                  { promptPerM: 0.75, completionPerM: 3.75 },
  'gemini-flash-latest':               { promptPerM: 0.75, completionPerM: 3.75 },  // rolling alias = newest stable flash (3.7)
  // gemini-3.5-flash: real card is $1.50/$9.00 — the $0.30/$2.50 recorded
  // here until 2026-08-14 was the OLD 2.5-flash tier (under-recorded ~5x).
  'gemini-3.5-flash':                  { promptPerM: 1.50, completionPerM: 9.00 },
  'gemini-flash-lite-latest':          { promptPerM: 0.25, completionPerM: 1.50 },  // = flash-lite
  'gemini-2.5-flash':                  { promptPerM: 0.15, completionPerM: 0.60 },  // legacy flash
  'gemini-2.0-flash':                  { promptPerM: 0.10, completionPerM: 0.40 },  // text ladder floor rung — was UNPRICED ($0 leak)
  // imagen standard (non-ultra). ~$0.04/image; ultra above is $0.06.
  'imagen-4.0-generate-001':           { promptPerM: 0,    completionPerM: 0,    perCall: 0.04 },
  // imagen fast tier (~$0.02/image) — rung 3 of the standard-image ladder in
  // gemini.provider.ts; was unpriced (logged $0).
  'imagen-4.0-fast-generate-001':      { promptPerM: 0,    completionPerM: 0,    perCall: 0.02 },

  // ─── Anthropic Claude (assistant via chat.ts CLAUDE_ASSISTANT_MODEL) ──
  // Claude Sonnet 4: $3/M input, $15/M output.
  'claude-sonnet-4-20250514':          { promptPerM: 3.00, completionPerM: 15.00 },
  'claude-sonnet-5':                   { promptPerM: 3.00, completionPerM: 15.00 },  // newest sonnet (assistant model; Anthropic key currently unset)

  // ─── xAI Grok ───────────────────────────────────────────────────
  // grok-4.20 was $5/$15 a few months ago; xAI cut it sharply in 2026.
  'grok-4.20':                         { promptPerM: 1.25, completionPerM: 2.50 },
  // grok-4.5 / 4.6: $2.00/$6.00 (≤200k) per xAI's live /v1/language-models,
  // 2026-08-14. 4.5 completion was wrongly $10 here (over-recorded 67%).
  'grok-4.5':                          { promptPerM: 2.00, completionPerM: 6.00 },
  'grok-4.6':                          { promptPerM: 2.00, completionPerM: 6.00 },  // newest grok flagship
  // grok-imagine image: $0.02 per generated image (was $0.07).
  'grok-imagine-image':                { promptPerM: 0,    completionPerM: 0,    perCall: 0.02 },
  'grok-imagine-image-quality':        { promptPerM: 0,    completionPerM: 0,    perCall: 0.05 },  // $0.05 per live xAI API 2026-08-14 (was mis-recorded 0.03)
  'grok-imagine-image-2.0':            { promptPerM: 0,    completionPerM: 0,    perCall: 0.04 },  // newest image gen, $0.04/img (docs + API standard tier)
  // grok-imagine video: $0.05 per SECOND of clip (was modeled as flat per-call).
  'grok-imagine-video':                { promptPerM: 0,    completionPerM: 0,    perSecond: 0.05 },
  'grok-imagine-video-1.5':            { promptPerM: 0,    completionPerM: 0,    perSecond: 0.08 },  // $0.08/s per xAI docs 2026-08-14 (was mis-recorded 0.05)
  'grok-imagine-video-fast':           { promptPerM: 0,    completionPerM: 0,    perSecond: 0.03 },

  // ─── Moonshot Kimi ──────────────────────────────────────────────
  // kimi-k2.6: $0.16 cache-hit / $0.95 cache-miss input, $4 output.
  // We don't track cache state per call; use cache-miss rate (worst case)
  // so cost reports never under-attribute. If cache-aware accounting is
  // added later, swap to a weighted average.
  'kimi-k2.6':                         { promptPerM: 0.95, completionPerM: 4.00 },
  // k3 (1M ctx): public API card $3/$15 (2026-08-14). Our key is a flat-rate
  // Kimi plan, so this is the shadow-price of the equivalent public API —
  // keeps k3 usage visible in cost reports instead of logging $0.
  'k3':                                { promptPerM: 3.00, completionPerM: 15.00 },

  // ─── DashScope (Alibaba Model Studio "Token Plan") ──────────────
  // APPROXIMATE intl per-M rates (verify vs the plan's unit billing — the
  // plan bills a fixed quota of "units", so these are for the cost meter
  // only). Text via OpenAI-compatible; image is per generated image.
  'qwen3.7-max':                       { promptPerM: 1.60, completionPerM: 6.40 },
  // qwen3.8-max: $2.00/$6.00 intl (multiple published sources, 2026-08-14).
  'qwen3.8-max':                       { promptPerM: 2.00, completionPerM: 6.00 },
  'qwen3.7-plus':                      { promptPerM: 0.40, completionPerM: 1.60 },  // vision-capable plus tier (intl card 2026-08-14)
  'qwen3.6-plus':                      { promptPerM: 0.40, completionPerM: 1.20 },
  'qwen3.6-flash':                     { promptPerM: 0.05, completionPerM: 0.40 },
  'deepseek-v4-pro':                   { promptPerM: 0.55, completionPerM: 2.20 },
  'deepseek-v4-flash':                 { promptPerM: 0.14, completionPerM: 0.28 },
  'deepseek-v3.2':                     { promptPerM: 0.28, completionPerM: 0.42 },
  'glm-5.1':                           { promptPerM: 0.60, completionPerM: 2.20 },
  'glm-5':                             { promptPerM: 0.60, completionPerM: 2.20 },
  'MiniMax-M2.5':                      { promptPerM: 0.30, completionPerM: 1.20 },
  'kimi-k2.5':                         { promptPerM: 0.60, completionPerM: 2.50 },
  // Image models (per generated image).
  'qwen-image-2.0':                    { promptPerM: 0, completionPerM: 0, perCall: 0.025 },
  'qwen-image-2.0-pro':                { promptPerM: 0, completionPerM: 0, perCall: 0.05 },
  // qwen-image-3.0-pro: $0.036 per 1K image / $0.071 at 2K (Alibaba card
  // 2026-08-14); flat midpoint since DashScope usage doesn't report the tier.
  'qwen-image-3.0-pro':                { promptPerM: 0, completionPerM: 0, perCall: 0.05 },
  'wan2.7-image':                      { promptPerM: 0, completionPerM: 0, perCall: 0.025 },
  'wan2.7-image-pro':                  { promptPerM: 0, completionPerM: 0, perCall: 0.05 },
};

// Every model name that has an explicit price. Used by the coverage guard
// (test + boot check) to assert that every model configured in .env is priced.
export const PRICED_MODELS: string[] = Object.keys(AI_PRICING);

// True when the model has an explicit price entry. Lets callers record
// metadata.priced=false instead of writing a misleading $0 (Phase 1).
export function isPriced(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(AI_PRICING, model);
}

// Boot-time coverage guard (Phase 2): scan env for every configured model name
// (any *_MODEL var) and report those with no price — they would silently log
// $0. Call once at startup so a new model in .env can't quietly break the cost
// meter (it did for the gemini "-latest" aliases + Claude until 2026-06-29).
export function auditConfiguredModelPricing(env: NodeJS.ProcessEnv = process.env): string[] {
  const models = new Set<string>();
  for (const [k, v] of Object.entries(env)) {
    if (v && /_MODEL$/.test(k)) models.add(v.trim());
  }
  const unpriced = [...models].filter((m) => m && !isPriced(m));
  if (unpriced.length) {
    console.warn(`[ai-pricing] ${unpriced.length} configured model(s) have NO price (usage will log $0): ${unpriced.join(', ')} — add them to AI_PRICING.`);
  } else {
    console.log('[ai-pricing] model pricing coverage OK — all configured models priced.');
  }
  return unpriced;
}

// Models we've already warned about, so the log isn't spammed once per call.
const warnedUnpriced = new Set<string>();

export function priceFor(model: string): PricePoint {
  const p = AI_PRICING[model];
  if (!p) {
    // Loud-but-once: an unpriced model is tracked as a call but costed at $0,
    // silently undercounting spend. Surfacing it means adding a new model to
    // .env can't quietly break the cost meter (it did for the gemini "-latest"
    // aliases + Claude assistant until 2026-06-29).
    if (!warnedUnpriced.has(model)) {
      warnedUnpriced.add(model);
      console.warn(`[ai-pricing] no price for model "${model}" — usage tracked but costed $0. Add it to AI_PRICING.`);
    }
    return { promptPerM: 0, completionPerM: 0 };
  }
  return p;
}

// Default assumed duration for video calls when the caller doesn't pass
// one. Most Veo + grok-imagine clips default to 8s in our request shapes
// (see services/providers/xai.provider.ts:142). Better than logging $0.
export const DEFAULT_VIDEO_DURATION_S = 8;

export function computeCostUsd(
  model: string,
  promptTokens?: number,
  completionTokens?: number,
  calls = 1,
  durationSeconds?: number,
): number {
  const p = priceFor(model);
  const promptCost = ((promptTokens ?? 0) / 1_000_000) * p.promptPerM;
  const completionCost = ((completionTokens ?? 0) / 1_000_000) * p.completionPerM;
  // perCall on an image model is a STAND-IN for the per-image output-token cost
  // (an image is ~1.3k output tokens). From 2026-08-02 the providers' real token
  // counts are captured, so when we have measured tokens AND token pricing, the
  // tokens ARE the cost. Adding perCall on top would double-bill every image.
  // perCall still applies when the provider reported no tokens, and for models
  // priced ONLY per call (imagen: promptPerM/completionPerM are 0).
  const hasTokenPricing = p.promptPerM > 0 || p.completionPerM > 0;
  const measuredOutputTokens = (completionTokens ?? 0) > 0;
  const callCost = hasTokenPricing && measuredOutputTokens ? 0 : (p.perCall ?? 0) * calls;
  // Per-second video pricing — falls back to the 8s default if caller didn't
  // pass duration (so we still record some non-zero cost). When duration IS
  // known the row is accurate to the second.
  const secondsCost = p.perSecond
    ? (durationSeconds ?? DEFAULT_VIDEO_DURATION_S) * p.perSecond * calls
    : 0;
  return Number((promptCost + completionCost + callCost + secondsCost).toFixed(6));
}
