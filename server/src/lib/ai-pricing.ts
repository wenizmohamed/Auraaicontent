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
  // gemini-4-argon: the current flagship generation. $2.00 in / $10.00 out per
  // 1M THROUGH 2026-11-30, then $4.00 / $20.00 from 2026-12-01. Verified live
  // 2026-11-05 (it is in the live catalog and answers generateContent).
  // Bump these two numbers on 2026-12-01.
  'gemini-4-argon':                    { promptPerM: 2.00, completionPerM: 10.00 },
  // gemini-3.1-pro-preview: $2/$12 (≤200k) – $4/$18 (>200k). Baseline ≤200k.
  'gemini-3.1-pro-preview':            { promptPerM: 2.00, completionPerM: 12.00 },
  // gemini-3.1-flash-lite-preview: $0.25/$1.50 text. Audio prompt rate higher.
  'gemini-3.1-flash-lite-preview':     { promptPerM: 0.25, completionPerM: 1.50 },
  // gemini-3.1-flash-image-preview: $0.50 input / $60 output (output is
  // priced per IMAGE not per-token in disguise). Per image: $0.045 at 0.5K,
  // $0.067 at 1K, $0.101 at 2K, $0.151 at 4K (Google card 2026-11-05).
  'gemini-3.1-flash-image-preview':    { promptPerM: 0.50, completionPerM: 60.00, perCall: 0.067 },
  // gemini-3.1-flash-image: GA of the preview above, same card. Verified live
  // 2026-08-14, repriced per-image 2026-11-05.
  'gemini-3.1-flash-image':            { promptPerM: 0.50, completionPerM: 60.00, perCall: 0.067 },
  // gemini-nano-banana-2.1: the CURRENT nano-banana (newer than 3.1-flash-
  // image). $1.50 in / $30 per 1M image-out. Per image: $0.0336 at 1K,
  // $0.0504 at 2K, $0.113 at 4K. Verified live 2026-11-05.
  'gemini-nano-banana-2.1':            { promptPerM: 1.50, completionPerM: 30.00, perCall: 0.034 },
  // nano-banana-pro = gemini-3-pro-image family: $2.00 in / $120 image-out
  // per M ≈ $0.134 per 1K/2K image, $0.24 at 4K (Google card 2026-08-14).
  'nano-banana-pro-preview':           { promptPerM: 2.00, completionPerM: 120.00, perCall: 0.15 },
  'gemini-3-pro-image':                { promptPerM: 2.00, completionPerM: 120.00, perCall: 0.14 },  // GA premium image (ultra tier)
  // gemini-3-pro-image-preview: same card as the GA id ($2 in / $120 image-out
  // per M ≈ $0.134 per 1K/2K image). Live 2026-11-05.
  'gemini-3-pro-image-preview':        { promptPerM: 2.00, completionPerM: 120.00, perCall: 0.14 },
  // gemini-3.1-flash-lite-image (Nano Banana 2 Lite): $0.25 in / $30 image-out
  // per M = $0.0336 per 1K image. Live 2026-11-05.
  'gemini-3.1-flash-lite-image':       { promptPerM: 0.25, completionPerM: 30.00, perCall: 0.034 },
  // gemini-2.5-flash-image (Nano Banana): $0.30 in, $0.039 per image output.
  // Google marks it deprecated (shutdown 2027-03-15) but it still renders.
  'gemini-2.5-flash-image':            { promptPerM: 0.30, completionPerM: 0.00, perCall: 0.039 },
  // imagen-4.0-ultra: $0.06/image (unchanged). The whole imagen-4.0-* family
  // hit Google's scheduled shutdown on 2026-08-17 — every id 404s now
  // (verified live 2026-11-05). Rows kept so a stale id is still priced
  // rather than logged $0.
  'imagen-4.0-ultra-generate-001':     { promptPerM: 0,    completionPerM: 0,    perCall: 0.06 },
  // veo-3.1-* ids were RETIRED by Google (404 on every call, 2026-10-30). Rows
  // kept so a stale id is still priced rather than logged $0.
  // veo-3.1-generate-preview: $0.40 (720p) - $0.60 (4k) per SECOND of video.
  // Default to mid ($0.50/s); admin view should multiply by clip duration.
  'veo-3.1-generate-preview':          { promptPerM: 0,    completionPerM: 0,    perSecond: 0.50 },
  // veo-3.1-fast-generate-preview: $0.10 – $0.30 per second. Mid: $0.20/s.
  'veo-3.1-fast-generate-preview':     { promptPerM: 0,    completionPerM: 0,    perSecond: 0.20 },
  // veo-3.1-lite-generate-preview: $0.05 (720p) / $0.08 (1080p) per second.
  'veo-3.1-lite-generate-preview':     { promptPerM: 0,    completionPerM: 0,    perSecond: 0.05 },
  // gemini-omni-flash-preview (video via Interactions API): $17.50/1M video
  // tokens ≈ $0.10/s of 720p (Google pricing page, verified 2026-07-02).
  'gemini-omni-flash-preview':         { promptPerM: 0,    completionPerM: 0,    perSecond: 0.10 },
  // wan2.7 t2v: the Alibaba workspace catalog publishes $0.10/s at 720P and
  // $0.15/s at 1080P (price API, verified 2026-11-04).
  'wan2.7-t2v':                        { promptPerM: 0,    completionPerM: 0,    perSecond: 0.10 },
  'wan2.7-t2v-2026-06-12':             { promptPerM: 0,    completionPerM: 0,    perSecond: 0.10 },
  // wan2.7 1080P tier: the workspace catalog publishes $0.15/s at 1080P
  // (720P is $0.10/s, verified on the Alibaba workspace price API 2026-11-04).
  // Without this row a 1080P wan2.7 clip bills at the 720P rate.
  'wan2.7-t2v:1080p':                  { promptPerM: 0,    completionPerM: 0,    perSecond: 0.15 },
  'wan2.7-t2v-2026-06-12:1080p':       { promptPerM: 0,    completionPerM: 0,    perSecond: 0.15 },
  // wan2.7 i2v + r2v: same DashScope video tier as t2v. The Creative Studio
  // engine picker quotes users $0.10/s for both. Priced by hand because the
  // boot guard only audits *_MODEL env vars, so hardcoded provider rungs
  // (like these) escape it and silently log $0 — and video is ~97% of spend.
  'wan2.7-i2v':                        { promptPerM: 0,    completionPerM: 0,    perSecond: 0.10 },
  'wan2.7-i2v-2026-04-25':             { promptPerM: 0,    completionPerM: 0,    perSecond: 0.10 },
  'wan2.7-i2v:1080p':                  { promptPerM: 0,    completionPerM: 0,    perSecond: 0.15 },
  'wan2.7-i2v-2026-04-25:1080p':       { promptPerM: 0,    completionPerM: 0,    perSecond: 0.15 },
  'wan2.7-r2v':                        { promptPerM: 0,    completionPerM: 0,    perSecond: 0.10 },
  'wan2.7-r2v-2026-06-12':             { promptPerM: 0,    completionPerM: 0,    perSecond: 0.10 },
  'wan2.7-r2v:1080p':                  { promptPerM: 0,    completionPerM: 0,    perSecond: 0.15 },
  'wan2.7-r2v-2026-06-12:1080p':       { promptPerM: 0,    completionPerM: 0,    perSecond: 0.15 },
  // wan3.0-video (PRIMARY video engine since 2026-10-17): Alibaba's
  // intl card is $0.05 / $0.10 / $0.20 per second at 480P / 720P / 1080P
  // (Model Studio pricing page, verified 2026-10-17; the launch promo ended
  // 2026-09-24). The provider reports the billed tier as a ":<res>" suffix,
  // 720P being the bare id, so each row carries its real rate.
  'wan3.0-video':                      { promptPerM: 0,    completionPerM: 0,    perSecond: 0.10 },
  'wan3.0-video:480p':                 { promptPerM: 0,    completionPerM: 0,    perSecond: 0.05 },
  'wan3.0-video:1080p':                { promptPerM: 0,    completionPerM: 0,    perSecond: 0.20 },
  // wan3.0-video-prime (speed tier, default since 2026-10-17): $0.068 / $0.14 /
  // $0.28 per second at 480P / 720P / 1080P (Alibaba intl card, the-decoder
  // table 2026-08). Measured 2x faster than standard for the same clip.
  'wan3.0-video-prime':                { promptPerM: 0,    completionPerM: 0,    perSecond: 0.14 },
  'wan3.0-video-prime:480p':           { promptPerM: 0,    completionPerM: 0,    perSecond: 0.068 },
  'wan3.0-video-prime:1080p':          { promptPerM: 0,    completionPerM: 0,    perSecond: 0.28 },
  // happyhorse-1.1 t2v / i2v / r2v: intl card $0.07 / $0.14 /
  // $0.18 per second at 480P / 720P / 1080P (Model Studio pricing page,
  // verified 2026-10-17). Same ":<res>" suffix convention as wan3.0.
  'happyhorse-1.1-t2v':                { promptPerM: 0,    completionPerM: 0,    perSecond: 0.14 },
  'happyhorse-1.1-t2v:480p':           { promptPerM: 0,    completionPerM: 0,    perSecond: 0.07 },
  'happyhorse-1.1-t2v:1080p':          { promptPerM: 0,    completionPerM: 0,    perSecond: 0.18 },
  'happyhorse-1.1-i2v':                { promptPerM: 0,    completionPerM: 0,    perSecond: 0.14 },
  'happyhorse-1.1-i2v:480p':           { promptPerM: 0,    completionPerM: 0,    perSecond: 0.07 },
  'happyhorse-1.1-i2v:1080p':          { promptPerM: 0,    completionPerM: 0,    perSecond: 0.18 },
  'happyhorse-1.1-r2v':                { promptPerM: 0,    completionPerM: 0,    perSecond: 0.14 },
  'happyhorse-1.1-r2v:480p':           { promptPerM: 0,    completionPerM: 0,    perSecond: 0.07 },
  'happyhorse-1.1-r2v:1080p':          { promptPerM: 0,    completionPerM: 0,    perSecond: 0.18 },
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
  // gemini-3.8-flash: same card and same promo window as 3.7 (Google pricing
  // page, verified 2026-10-10). gemini-flash-latest now resolves to it.
  'gemini-3.8-flash':                  { promptPerM: 0.75, completionPerM: 3.75 },
  'gemini-flash-latest':               { promptPerM: 0.75, completionPerM: 3.75 },  // rolling alias = newest stable flash (3.8)
  // gemini-3.5-flash: real card is $1.50/$9.00 — the $0.30/$2.50 recorded
  // here until 2026-08-14 was the OLD 2.5-flash tier (under-recorded ~5x).
  'gemini-3.5-flash':                  { promptPerM: 1.50, completionPerM: 9.00 },
  // gemini-3.6-flash: $0.75/$3.75 promo through 2026-12-31, then $1.50/$7.50
  // (Google pricing page, verified 2026-11-05). Same window as 3.7/3.8.
  'gemini-3.6-flash':                  { promptPerM: 0.75, completionPerM: 3.75 },
  // gemini-3.5-flash-lite: $0.30/$2.50 standard (Google card 2026-11-05).
  'gemini-3.5-flash-lite':             { promptPerM: 0.30, completionPerM: 2.50 },
  // gemini-3.1-flash-lite (GA): $0.25/$1.50 standard (Google card 2026-11-05).
  'gemini-3.1-flash-lite':             { promptPerM: 0.25, completionPerM: 1.50 },
  'gemini-flash-lite-latest':          { promptPerM: 0.25, completionPerM: 1.50 },  // = flash-lite
  'gemini-2.5-flash':                  { promptPerM: 0.15, completionPerM: 0.60 },  // legacy flash — retired 2026-11-05
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
  'grok-4.6':                          { promptPerM: 2.00, completionPerM: 6.00 },
  // grok-4.7: $2.00/$6.00 (≤200k), identical to 4.6 per xAI's live
  // /v1/language-models, 2026-10-10.
  'grok-4.7':                          { promptPerM: 2.00, completionPerM: 6.00 },  // newest grok flagship
  // grok-imagine image: $0.02 per generated image (was $0.07).
  'grok-imagine-image':                { promptPerM: 0,    completionPerM: 0,    perCall: 0.02 },
  'grok-imagine-image-quality':        { promptPerM: 0,    completionPerM: 0,    perCall: 0.05 },  // $0.05 per live xAI API 2026-08-14 (was mis-recorded 0.03)
  'grok-imagine-image-2.0':            { promptPerM: 0,    completionPerM: 0,    perCall: 0.04 },  // newest image gen, $0.04/img (docs + API standard tier)
  // grok-imagine video is priced per second BY RESOLUTION (docs.x.ai/developers/
  // pricing, verified 2026-10-17): video-1.5 $0.08 / $0.14 / $0.25 at 480p /
  // 720p / 1080p; legacy video $0.05 / $0.07. The provider requests 720p by
  // default, so the bare id is the 720p rate and other tiers carry a ":<res>"
  // suffix (same convention as wan3.0). Until today 1.5 was billed at the 480p
  // rate ($0.08) while rendering 720p, under-recording every clip by 43%.
  'grok-imagine-video':                { promptPerM: 0,    completionPerM: 0,    perSecond: 0.07 },
  'grok-imagine-video:480p':           { promptPerM: 0,    completionPerM: 0,    perSecond: 0.05 },
  'grok-imagine-video-1.5':            { promptPerM: 0,    completionPerM: 0,    perSecond: 0.14 },
  'grok-imagine-video-1.5:480p':       { promptPerM: 0,    completionPerM: 0,    perSecond: 0.08 },
  'grok-imagine-video-1.5:1080p':      { promptPerM: 0,    completionPerM: 0,    perSecond: 0.25 },
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

  // ─── DashScope (Alibaba Model Studio workspace) ─────────────────
  // APPROXIMATE intl per-M rates (verify vs the plan's unit billing — the
  // plan bills a fixed quota of "units", so these are for the cost meter
  // only). Text via OpenAI-compatible; image is per generated image.
  'qwen3.7-max':                       { promptPerM: 1.60, completionPerM: 6.40 },
  // qwen3.8-max: $2.00/$6.00 intl (multiple published sources, 2026-08-14).
  'qwen3.8-max':                       { promptPerM: 2.00, completionPerM: 6.00 },
  'qwen3.7-plus':                      { promptPerM: 0.40, completionPerM: 1.60 },  // vision-capable plus tier (intl card 2026-08-14)
  'qwen3.6-plus':                      { promptPerM: 0.40, completionPerM: 1.20 },
  'qwen3.6-flash':                     { promptPerM: 0.05, completionPerM: 0.40 },
  // qwen3.8-flash (DASHSCOPE_TEXT_MODEL since 2026-10-10): $0.15 / $0.47 intl
  // (Model Studio pricing page, verified 2026-10-17). Was unpriced: 9 rows at $0.
  'qwen3.8-flash':                     { promptPerM: 0.15, completionPerM: 0.47 },
  'deepseek-v4-pro':                   { promptPerM: 0.55, completionPerM: 2.20 },
  'deepseek-v4-flash':                 { promptPerM: 0.14, completionPerM: 0.28 },
  'deepseek-v3.2':                     { promptPerM: 0.28, completionPerM: 0.42 },
  'glm-5.1':                           { promptPerM: 0.60, completionPerM: 2.20 },
  'glm-5':                             { promptPerM: 0.60, completionPerM: 2.20 },
  'MiniMax-M2.5':                      { promptPerM: 0.30, completionPerM: 1.20 },
  'kimi-k2.5':                         { promptPerM: 0.60, completionPerM: 2.50 },
  // Image models (per generated image).
  'qwen-image-2.0':                    { promptPerM: 0, completionPerM: 0, perCall: 0.035 },
  'qwen-image-2.0-pro':                { promptPerM: 0, completionPerM: 0, perCall: 0.075 },
  // qwen-image-3.0-pro: the workspace price API publishes the 1K tier at
  // $0.04/image and the 2K tier at $0.075/image (Alibaba catalog, re-read
  // live 2026-11-06 — an earlier 0.033/0.078 pair here was wrong).
  // The provider reports the tier it billed as
  // "qima_output_1k" / "qima_output_2k", so the provider appends the same
  // ":<tier>" suffix convention the video lane uses and each tier carries its
  // real rate. The bare id stays the 1K rate (the default size).
  'qwen-image-3.0-pro':                { promptPerM: 0, completionPerM: 0, perCall: 0.04 },
  'qwen-image-3.0-pro:1k':             { promptPerM: 0, completionPerM: 0, perCall: 0.04 },
  'qwen-image-3.0-pro:2k':             { promptPerM: 0, completionPerM: 0, perCall: 0.075 },
  'wan2.7-image':                      { promptPerM: 0, completionPerM: 0, perCall: 0.03 },
  'wan2.7-image-pro':                  { promptPerM: 0, completionPerM: 0, perCall: 0.075 },

  // ── Alibaba image engines added 2026-11-06 (live catalog, price API) ──
  // qwen-image-2.1-pro: $0.04 per image, one rate for every size tier, and
  // it does BOTH generate and edit. It also handles up to 10 reference
  // images, native transparency, and local edits (catalog, verified live
  // against the workspace catalog on 2026-11-06).
  'qwen-image-2.1-pro':                { promptPerM: 0, completionPerM: 0, perCall: 0.04 },
  // qwen-image-2.1-turbo: $0.016 per image and about 3.5s to render — the
  // cheapest engine that still does generate AND edit, so it is the draft
  // tier for both stills and edits.
  'qwen-image-2.1-turbo':             { promptPerM: 0, completionPerM: 0, perCall: 0.016 },
  // qwen-image-3.0 (non-pro): the catalog publishes $0.03 at BOTH the 1K and
  // the 2K tier, which makes it cheaper than qwen-image-3.0-pro at 1K
  // ($0.04) and far cheaper at 2K ($0.075).
  'qwen-image-3.0':                   { promptPerM: 0, completionPerM: 0, perCall: 0.03 },
  'qwen-image-3.0:1k':                { promptPerM: 0, completionPerM: 0, perCall: 0.03 },
  'qwen-image-3.0:2k':                { promptPerM: 0, completionPerM: 0, perCall: 0.03 },
  // z-image-turbo: $0.015 per image in STANDARD mode, $0.03 with its
  // "thinking" mode on. It is NOT a resolution tier — the catalog prices it
  // by MODE, so the ":<tier>" suffix here means mode, not size. GENERATE
  // ONLY: its edit path fails with "Field 'text' is required in content
  // item", so it must never be offered in the edit section.
  'z-image-turbo':                     { promptPerM: 0, completionPerM: 0, perCall: 0.015 },
  'z-image-turbo:1k':                  { promptPerM: 0, completionPerM: 0, perCall: 0.015 },
  'z-image-turbo:2k':                  { promptPerM: 0, completionPerM: 0, perCall: 0.015 },
  'z-image-turbo:thinking':            { promptPerM: 0, completionPerM: 0, perCall: 0.03 },
  // wan2.6-image: $0.03/image, text AND image in (so it also edits).
  'wan2.6-image':                      { promptPerM: 0, completionPerM: 0, perCall: 0.03 },
  'wan2.6-t2i':                        { promptPerM: 0, completionPerM: 0, perCall: 0.03 },
  'wan2.1-t2i-turbo':                  { promptPerM: 0, completionPerM: 0, perCall: 0.025 },
  'wan2.2-t2i-flash':                  { promptPerM: 0, completionPerM: 0, perCall: 0.025 },
  'wan2.2-t2i-plus':                   { promptPerM: 0, completionPerM: 0, perCall: 0.05 },
  // qwen-mt-image-2.0: $0.0006/image — a 55-language TRANSLATION engine (it
  // rewrites text inside an image, it does not generate artwork). Priced so a
  // call to it is never logged as $0, but it is not offered in the picker.
  'qwen-mt-image-2.0':                 { promptPerM: 0, completionPerM: 0, perCall: 0.0006 },

  // ── Alibaba video engines added 2026-11-06 ──────────────────────
  // The Vidu family is the strongest on-brand addition: the catalog
  // describes viduq3-ad_reference2video as "a dedicated model for the
  // advertising industry" that produces a 16-second ad video with
  // marketing-grade cuts, intelligent camera movement and direct audio
  // output. Rates are per second, 720p then 1080p.
  'vidu/viduq3-ad_reference2video':            { promptPerM: 0, completionPerM: 0, perSecond: 0.125 },
  'vidu/viduq3-ad_reference2video:1080p':      { promptPerM: 0, completionPerM: 0, perSecond: 0.150 },
  'vidu/viduq3-mix_reference2video':           { promptPerM: 0, completionPerM: 0, perSecond: 0.120 },
  'vidu/viduq3-mix_reference2video:1080p':     { promptPerM: 0, completionPerM: 0, perSecond: 0.145 },
  'vidu/viduq3-drama_reference2video':         { promptPerM: 0, completionPerM: 0, perSecond: 0.140 },
  'vidu/viduq3-drama_reference2video:1080p':   { promptPerM: 0, completionPerM: 0, perSecond: 0.140 },
  // vidu q2 pro fast image-to-video: $0.016/s at 720p, $0.032/s at 1080p —
  // the cheapest clip in the catalog by a wide margin.
  'vidu/viduq2-pro-fast_img2video':            { promptPerM: 0, completionPerM: 0, perSecond: 0.016 },
  'vidu/viduq2-pro-fast_img2video:1080p':      { promptPerM: 0, completionPerM: 0, perSecond: 0.032 },
  // wan2.6-i2v-flash: $0.05/s at 720p, $0.075/s at 1080p, and a $0.025/s
  // no-audio tier.
  'wan2.6-i2v-flash':                         { promptPerM: 0, completionPerM: 0, perSecond: 0.05 },
  'wan2.6-i2v-flash:1080p':                   { promptPerM: 0, completionPerM: 0, perSecond: 0.075 },
  'wan2.6-i2v-flash-noaudio':                 { promptPerM: 0, completionPerM: 0, perSecond: 0.025 },
  'wan2.6-i2v-flash-noaudio:1080p':           { promptPerM: 0, completionPerM: 0, perSecond: 0.0375 },
  // wan2.6-r2v-flash: the same rates as the i2v flash tier.
  'wan2.6-r2v-flash':                         { promptPerM: 0, completionPerM: 0, perSecond: 0.05 },
  'wan2.6-r2v-flash:1080p':                   { promptPerM: 0, completionPerM: 0, perSecond: 0.075 },
  // wan2.2-i2v-flash: $0.015/s at 480p, $0.036/s at 720p.
  'wan2.2-i2v-flash':                         { promptPerM: 0, completionPerM: 0, perSecond: 0.036 },
  'wan2.2-i2v-flash:480p':                    { promptPerM: 0, completionPerM: 0, perSecond: 0.015 },
  // wan2.5 t2v/i2v preview: $0.05/s at 480p, $0.10/s at 720p, $0.15/s at 1080p.
  'wan2.5-t2v-preview':                       { promptPerM: 0, completionPerM: 0, perSecond: 0.10 },
  'wan2.5-t2v-preview:480p':                  { promptPerM: 0, completionPerM: 0, perSecond: 0.05 },
  'wan2.5-t2v-preview:1080p':                 { promptPerM: 0, completionPerM: 0, perSecond: 0.15 },
  'wan2.5-i2v-preview':                       { promptPerM: 0, completionPerM: 0, perSecond: 0.10 },
  'wan2.5-i2v-preview:480p':                  { promptPerM: 0, completionPerM: 0, perSecond: 0.05 },
  'wan2.5-i2v-preview:1080p':                 { promptPerM: 0, completionPerM: 0, perSecond: 0.15 },
  // wan2.7-videoedit: $0.10/s at 720p, $0.15/s at 1080p. Takes a VIDEO plus
  // text, so it is a video-to-video edit, not a still animation.
  'wan2.7-videoedit':                         { promptPerM: 0, completionPerM: 0, perSecond: 0.10 },
  'wan2.7-videoedit:1080p':                   { promptPerM: 0, completionPerM: 0, perSecond: 0.15 },
  // happyhorse-1.0-video-edit: $0.14/s at 720p, $0.24/s at 1080p.
  'happyhorse-1.0-video-edit':                { promptPerM: 0, completionPerM: 0, perSecond: 0.14 },
  'happyhorse-1.0-video-edit:1080p':          { promptPerM: 0, completionPerM: 0, perSecond: 0.24 },
  // happyhorse-1.0 t2v/i2v/r2v: the 1.0 generation is $0.14/s at 720p and
  // $0.24/s at 1080p — dearer than the 1.1 at 1080p ($0.18/s). These are
  // ladder rungs, and the boot guard only audits *_MODEL env vars, so an
  // unpriced rung logs $0 silently.
  'happyhorse-1.0-t2v':                       { promptPerM: 0, completionPerM: 0, perSecond: 0.14 },
  'happyhorse-1.0-t2v:1080p':                 { promptPerM: 0, completionPerM: 0, perSecond: 0.24 },
  'happyhorse-1.0-i2v':                       { promptPerM: 0, completionPerM: 0, perSecond: 0.14 },
  'happyhorse-1.0-i2v:1080p':                 { promptPerM: 0, completionPerM: 0, perSecond: 0.24 },
  'happyhorse-1.0-r2v':                       { promptPerM: 0, completionPerM: 0, perSecond: 0.14 },
  'happyhorse-1.0-r2v:1080p':                 { promptPerM: 0, completionPerM: 0, perSecond: 0.24 },
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
