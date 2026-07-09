# Radix Creative Tools — SOTA Gap-Closure Roadmap

> Source: 10-agent competitor + model benchmark (workflow wf_3db3a899, 2026-07-09).
> Benchmarked Midjourney v7, Runway Gen-4.5, Krea, Freepik, Ideogram/Higgsfield +
> Google/xAI/DashScope/hosted-SOTA model families. Full agent transcripts:
> subagents/workflows/wf_3db3a899-0b4/journal.jsonl
>
> STATUS KEY:  ✅ shipped   🔑 needs external account/key   🎨 needs FE/UX build   ⏳ queued
>
> SHIPPED so far (server-side, verified, live):
> - ✅ Per-engine prompt dialects (nano/Qwen/Grok/Wan) + quality gate + vision→prompt (68dee84)
> - ✅ Billing-exhaustion 403s no longer halt the fallback chain — fixes G1 (8645953)
> - ✅ Depth dial (raw/low/medium/high) + brand-palette hex conditioning +
>      motion-first i2v hard switch (G2 prompt-half) + Veo multi-shot (9acd42b)
> - ✅ Creative feedback→Memory USP loop (POST /api/creative/feedback) (68dee84)
> - ✅ +6 style packs = 20 total (68dee84)

---

# RADIX SOTA GAP-CLOSURE PLAN — 2026-07-09

---

## 1. GAP MATRIX (severity-ranked for MENA agency ad-creative)

| # | Sev | Capability gap | Who beats us | Why it matters |
|---|-----|----------------|--------------|----------------|
| G1 | **P0-OPS** | **xAI fallback leg is silently dead** — team b4bc845e returns permission-denied on all endpoints (credits/spend limit) | n/a (self-inflicted) | The gemini→xai→dashscope chain is a 2-leg chain right now, and DashScope's key historically dies at every monthly rollover. One Gemini incident = total outage. Fix before ANY integration work. |
| G2 | **P0** | **Image-conditioned video loses the product** (the open HIGH bug; heaviest daily user) — no reference-to-video (subject-consistency) route at all; everything image-conditioned goes to Veo i2v | Higgsfield Soul ID, Runway @references, Wan2.7-r2v, HappyHorse-1.1-r2v, Seedance 2.0 (9 image refs), Grok video-1.5 | This is the #1 recorded team complaint and the core agency job: the client's actual product in the video. Every serious competitor now has a subject-lock mode; Radix has none. |
| G3 | **P0** | **Arabic in-image typography** — nothing in gemini/grok/qwen renders reliable RTL Arabic ad copy | Seedream 5.0 Pro (native RTL Arabic, 15 languages) — uniquely; Ideogram claims it and fails | Home-market statics. Currently producers composite Arabic text manually. The one competitor model that does it is a $0.0675 fal call away. |
| G4 | **P1** | **No image draft→finalize ladder and no enhance/upscale stage at all** | Midjourney Draft mode (24 imgs for half of ONE final) + Rerun-as-HD; Krea Turbo→Enhance (Topaz, 22K); Ideogram Turbo/Default/Quality; Freepik Magnific 2x-16x | Radix tiers video cost but images are flat-priced single-shot. MJ's cheapest-ideation-funnel economics is its stickiest feature and our multi-provider stack can beat the ratio ($0.0336 Lite draft ×4 → $0.134 Pro hero). Biggest output-quality + cost gap on the image side. |
| G5 | **P1** | **No persistent named reference entities** — refs are per-call, re-uploaded every session | Runway @-mentions, Freepik @characters (LoRA), Higgsfield Soul ID, Ideogram character reference | Consistency across a campaign is THE agency need. Also the structural fix for G2: sticky per-client identities auto-attached as Veo ingredients / edit refs. We can do it without LoRA cost (reference conditioning ≈90% of it, free, instant). |
| G6 | **P1** | **Zero video editing of existing footage** | Runway Aleph 2.0 (edit propagation), gemini-omni-flash-preview (conversational edits, ~$0.10/s), Kling MC, Wan videoedit | "Change the background / swap the product on this approved ad" is a daily client-revision request. We regenerate from scratch; Runway edits. Omni Flash puts this one provider-path away on our existing Gemini key. |
| G7 | **P1** | **Enhancer is a blind binary toggle** — no prompt reveal, no depth dial, no verbatim escape | Freepik post-gen prompt reveal + edit-rerun; Krea Raw/Low/Med/High; MJ --raw + shortener; Ideogram's Magic Prompt backlash proves the failure mode | Freepik users burn ~50% of credits on blind retries; MJ learned power users churn without --raw. Our enhancer is better than theirs and invisible — worst of both. |
| G8 | **P1** | **No batch/combinatorial campaign generation** | Freepik Lists (1 char × 5 headlines × 4 CTAs = 20 ads/run), Ideogram CSV Batch, Higgsfield URL-to-Ad (15+ variants in 5 min) | AR/EN/FR localization matrices are the defining MENA agency workload. We cap at x4 of one prompt. Higgsfield's URL-to-Ad is the single fastest concept-to-grid flow on the market and we have the scraping stack (Firecrawl/Playwright) + brand kits to clone it better. |
| G9 | **P2** | **Veo capabilities we pay for but don't surface**: first/last-frame interpolation, extension, loops, multi-shot | MJ --loop/--end since mid-2025; Runway multi-shot; Freepik start/end-frame + camera-move chips | Looping product clips are disproportionately effective on IG/TikTok. This is UI work on capability we already have — the cheapest P2 on the board. |
| G10 | **P2** | **No per-reference strength control** — roles (content/style/character) but no weights | MJ --ow 25–1000 dial, Krea per-ref 0-100% sliders, Mystic adherence + detailing | "Restyle loosely" vs "lock identity" is exactly the product-shot dial ad producers need. Compile to per-model phrasing. |
| G11 | **P2** | **Client taste is implicit, not rankable** — learned-memory exists but no moodboard analysis, no explicit avoids, no A/B ranking | MJ personalization profiles (survive model swaps), Krea moodboards (set-level analysis → taste profile + auto-avoids → negativePrompt) | Krea's auto-extracted "avoids" feeding negativePrompt is the missing piece on top of our brand-kit enrichment. |
| G12 | **P2** | **No image-to-prompt / Describe** | Krea Image-to-Prompt, MJ Describe, Freepik image-to-prompt | Drop a competitor ad → structured prompt in OUR dialect ready to remix with the client's brand kit. ~1 day with Gemini vision. |
| G13 | **P2** | **No music/audio track generation** | Runway Seed Audio, Freepik Tunes/voice/SFX; Lyria 3 sits unused on our own key at $0.04/30s | Silent Grok/Wan drafts need beds; TikTok needs music. Trivial add. |
| G14 | **P2** | **Assistant co-pilot not wired to Studio session state** | MJ conversational mode (sees your refs, settings, recent jobs), Runway Agent 2.0 + Agent Skills | We have chat.ts + RAG; it just can't see the composer. Known open item (chat.ts lacks centralized enrichers). "Make it warmer, keep the product angle" beats re-prompting from scratch. |
| G15 | **P3** | No SVG/vector output; no hard-bbox layout control | Recraft V4 (native SVG, style_id); Ideogram 4.0 JSON bboxes | Nice-to-have. Bbox thinking should upgrade our negative-space heuristic (see P-2 below) even without adopting Ideogram. |

---

## 2. MODEL INTEGRATION SHORTLIST (ranked)

**Rule for every item: add the exact id string to the cost-meter pricing map or the boot guard flags it $0.**

| Rank | Model id(s) | Action | Why | Cost impact |
|------|-------------|--------|-----|-------------|
| 0 | *(prereq)* xAI team b4bc845e | **Top up credits / raise spend limit, then live-verify** | Entire Grok leg dead in prod; blocks R4, R7, R11 | Restores existing paid-for capacity |
| 1 | `wan2.7-r2v-2026-06-12` + `wan2.7-i2v-2026-04-25` (DashScope) | Add as reference-to-video + i2v legs | **Kills G2 with zero new adapter** — existing DashScope provider, sync base64 input (no URL hosting), r2v preserves the reference product by design. Also ends "Veo is a single point of failure for image-conditioned video." Caveats: download output within 24h (URL purged), emits audio by default, EN/ZH prompts only (translation layer already handles this) | 1080P $0.15/s ≈ 5x cheaper than Veo 3.1 HD |
| 2 | `gemini-3.1-flash-image` (GA) | **Migrate all four .env vars** off `-preview` alias | Imagen 4 shutdown 2026-08-17 officially names this the successor; preview alias will die. Also sweep for stray Imagen references before 8-17 | Zero — hygiene with a deadline |
| 3 | **fal.ai adapter** (one `@fal-ai/client`, one FAL_KEY) → `bytedance/seedream/v5/pro/text-to-image` + `fal-ai/bytedance/seedream/v4.5/text-to-image` | New provider in ai-router; route Arabic-copy statics to Seedream 5.0 Pro, add 4.5 as cheap image fallback peer | **Kills G3** — 5.0 Pro is the ONLY credible native RTL Arabic typography model anywhere; nothing MJ/Freepik/Krea/Ideogram offers this. One adapter (~1 day incl. async plumbing we already have) unlocks 7 models total | Arabic lane $0.0675/img; 4.5 at $0.04/img undercuts NB2 |
| 4 | `veo-3.1-lite-generate-preview` | New default draft video tier | Price-matches Grok draft ($0.05/s 720p) but adds native audio. **Router guard mandatory**: ingredients/first-last-frame/extension jobs must never route to Lite (it lacks all three) — stay on 3.1/3.1-fast | Draft tier gains audio at zero price delta |
| 5 | `gemini-3.1-flash-lite-image` + `gemini-3-pro-image` | Draft rail + hero tier (feeds G4's ladder) | Lite: 4 drafts for the price of 2 NB2 images ($0.0336/1K). Pro: best-in-family text rendering (Arabic-adjacent copy), 131k input takes our full brand-kit+RAG enriched prompts (NB2 caps at 65k) | Draft ×4 = $0.134; hero $0.134/1K–$0.24/4K — still ~10x under MJ per usable asset |
| 6 | `grok-imagine-video-1.5` (after rank 0) | Image-conditioned 1080p tier | Only Grok model doing 1080p i2v, native lip-synced audio free, ~17s latency; same async polling code path as existing grok video. Verify per-resolution pricing on first live call (docs say flat $0.080/s, third parties report tiers to $0.14/s) | $0.08/s ≈ $1.20 per 15s clip, ~4-6x under Veo HD |
| 7 | `gemini-omni-flash-preview` | **New capability: conversational video EDIT** | Kills G6. Up to 3 sequential natural-language edits on generated OR uploaded ad videos — the Runway-Aleph answer nobody at our price point has. NOT a Veo drop-in: generateContent + Interactions API needs a new provider path | ~$0.10/s of video |
| 8 | `fal-ai/kling-video/v3/standard/text-to-video` + `fal-ai/minimax/hailuo-2.3/standard/image-to-video` | HD-tier peer/fallback to Veo + physics-strong draft peer | Kling 3.0: #1 t2v arena, audio-off $0.084/s < Veo. Hailuo 2.3: $0.19 flat per 6s video, best motion physics, perfect silent social drafts. Both free once the rank-3 adapter exists | HD leg cheaper than Veo; draft ~$0.032/s effective |
| 9 | `happyhorse-1.1-r2v` / `-i2v` (DashScope direct, or fal) | Hero product-video tier trial | #1-2 Video Arena, ex-Kling team, explicitly e-commerce/product-tuned — the premium rung for G2-class subject fidelity | $0.14/s 720p, $0.18/s 1080p |
| 10 | `grok-imagine-image-quality` + grok `/v1/images/edits` | xAI premium still tier + **third leg of the image-edit chain** | Image-edit chain is currently gemini→dashscope, and the DashScope key dies monthly — grok's 3-ref edit is the missing redundancy. Also wire `qwen-image-2.0-pro`'s edit endpoint (3 refs, sync) as the dashscope edit leg proper | $0.05/img quality; $0.02 base stays draft |
| 11 | `lyria-3-clip-preview` | Music beds for Reels/TikTok | Already live on our key; nothing in stack does music (G13) | $0.04/30s clip |
| 12 | `wan2.6-i2v-flash` | Optional storyboard-preview tier | Cheapest image-conditioned video anywhere: silent 720P $0.025/s, half of Grok draft | ~$0.13 per 5s preview |

**Deliberately skipped:** `gpt-image-2` (pricey at quality tier, strictest content policy, needs a new OpenAI account — keep as future quality-ceiling fallback only); `recraftv4` (defer — SVG is P3; revisit when a client needs logo/vector work); Ideogram 4.0 self-host (its Arabic fails in practice — the one thing we'd need it for; Seedream 5.0 Pro wins that lane); `riverflow-2.0-pro` (only via a Replicate adapter — build Replicate later as provider-level redundancy, not now); `wan2.5-i2v-preview` (superseded).

---

## 3. PROMPTING TECHNIQUES TO ADOPT (ranked)

1. **Motion-first i2v dialect** *(Runway)* — when an image is attached, the enhancer MUST switch modes: treat the image as frame one, describe ONLY motion/camera/timing, never re-describe the subject. Re-description is exactly what causes the model to reinvent the product — this is the prompt-layer half of the G2 fix (models are the other half).
2. **Structured JSON intermediate representation with typed text elements + bboxes** *(Ideogram 4.0)* — enhancer emits `{scene, style{palette_hex}, elements[{type: obj|text, content, bbox}]}`, then compiles per model dialect. Upgrades our negative-space-for-copy heuristic into a hard reserved copy block, makes AR/EN headline placement deterministic, and gives every downstream technique a stable substrate.
3. **Brand-hex palette conditioning** *(Ideogram)* — inject the client's exact hex list from the brand kit into every enhanced prompt ("dominant palette: #0E2A47, #F4B41A…"). Measurably steers Gemini; native if we ever route to a palette-aware model. Near-zero effort on existing brand-kit enrichment.
4. **Enhancer depth dial: Raw / Low / Medium / High** *(Krea, MJ --raw)* — replaces the binary toggle. Raw = verbatim to model but keeps translation + negativePrompt (critical for brand-exact claims/copy). Add MJ's shortener as the inverse: compress a rambling brief into the tight model formula.
5. **Post-generation prompt reveal + edit-and-rerun** *(Freepik; Ideogram's Magic-Prompt backlash is the cautionary tale)* — show the final enhanced prompt on every generation card, collapsible editor, per-section locks, rerun button. Converts blind retries into targeted edits — the cheapest quality-per-dollar win in this document.
6. **Timestamp / multi-shot sequencing** *(Runway)* — teach the Veo enhancer `[00:01]` beats and wide→medium→close shot lists in one prompt; Veo 3.1 parses sequenced instructions well. Turns a 3-shot ad into one generation.
7. **Settings-first style hygiene** *(Freepik doctrine)* — enhancer strips style adjectives from free text and folds them into the active Style Pack (already hard constraints), surfacing extracted lighting/camera/tone as editable chips. Style stops fighting the prompt; consistency stops being luck.
8. **Named motion-preset expansion + one-dominant-motion rule** *(Higgsfield)* — ~20 curated presets (Crash Zoom, Orbit, Dolly-In, FPV, Snorricam…) each expanding into a validated Veo-formula cinematography block; enhancer enforces one dominant motion per clip.
9. **Image-to-prompt in OUR dialect** *(Krea/MJ Describe/Freepik)* — Gemini vision reverse-prompts any reference ad straight into the Veo formula or image-ad structure, pre-merged with the client brand kit. ~1 day.
10. **Moodboard set-analysis → taste profile + auto-AVOIDS** *(Krea)* — run vision+clustering once over a client's approved creatives; profile keywords into the enhancer, extracted avoids into negativePrompt on every call. The explicit version of what learned-memory does implicitly.
11. **Typeface vocabulary mapping** *(Ideogram)* — "modern font" → "condensed display gothic"; named type styles measurably improve typography adherence on text-heavy statics.
12. **Graded remix presets: Subtle / Vivid / Wild** *(Freepik Reimagine)* — stored prompt+seed with three deviation levels (seed-locked jitter → enhancer rewrite). Kills the "almost right, regenerate from scratch" loop.

---

## 4. UX PATTERNS — TOP 5

1. **Draft-grid → one-click Finalize / Rerun-as-HD** *(MJ Draft mode + Rerun-as-HD; Krea speed tiers; Ideogram quality ladder)*. Images: x4–x8 on `gemini-3.1-flash-lite-image`/`z-image-turbo` thumbnails → "Finalize" re-renders the winner at 2K/4K on NB2/`gemini-3-pro-image` with identical enhanced prompt + refs. Video: Grok/Lite draft → "Rerun as HD" replays prompt + image conditioning through Veo 3.1. Every past item on the recent-generations rail gets the upgrade button (params already persisted — this is mostly UI). This is the economics story: cheap divergence, paid convergence, and we can beat MJ's 24-for-half ratio.
2. **@-named persistent reference entities, client-scoped** *(Runway @refs + Freepik @mentions + Higgsfield Soul ID, minus the 5,500-credit LoRA tax)*. Save `@productX` (3 shots, role=content), `@brandY-style`, `@amira_ambassador` per client in the brand kit; autocomplete in the composer; resolver expands into per-image-role refs, Veo ingredients, and wan2.7-r2v inputs automatically. Makes the G2 fix sticky and session-proof — and org/client-scoped, which no competitor's version is.
3. **Click-to-Ad campaign matrix** *(Higgsfield URL-to-Ad + Freepik Lists)*. Paste a product URL → Firecrawl scrape → merge brand kit + RAG → fan out format templates (UGC hook, unboxing, static carousel, story, TV spot) × headlines × CTAs × AR/EN(/FR) → review grid. Highest-impact single feature for our exact user; nobody combines it with brand grounding.
4. **Prompt-reveal generation card + enhancer dial** *(Freepik + Krea)*. The UI face of P-4/P-5: every card shows model used, cost, and the final enhanced prompt with edit-and-rerun; composer gets the Raw→High dial. Directly attacks retry burn and power-user churn.
5. **Client style codes + style roulette** *(MJ srefs + --sref random; Ideogram saved style refs)*. Mint persistent style codes (RDX-4821) from any Style Pack, brand kit, or winning generation; per-code weight, mixable, shareable in-org; "roulette" fans one prompt across 12 styles in the draft tier — the best client-direction-finding tool MJ ever shipped, rebuilt on our tiering.

*(Next in line if capacity allows: video finishing chips — loop / end-frame / extend / camera presets — G9, mostly surfacing existing Veo 3.1 features.)*

---

## 5. EXPLICIT NON-GAPS — do not rebuild, do weaponize in sales copy

1. **Brand/client grounding on every call** (brand kit + knowledge-RAG + learned memory): listed as a weakness for ALL five competitors. MJ personalization is personal taste, not client brand; Runway/Krea/Freepik/Higgsfield start every prompt cold or charge LoRA-training fees for a fraction of it. This is the moat — extend it (moodboards, taste profiles), never rebuild it.
2. **Multi-tenant agency structure + private-by-default**: MJ generations are public below $60/seat; Ideogram free tier is public; Runway caps at 5–10 seats with no client workspaces; Freepik Business is one shared credit pool. Nobody has per-client tenancy, roles, approval flows.
3. **Cost structure + transparent metering**: at-cost provider routing vs. retail credit markup everywhere; Runway bills failed generations and expires credits; Freepik users lose ~50% of credits to retries; Higgsfield tops-ups expire in 90 days (Trustpilot 3.2). Our draft video is already 4–10x under Runway's cheapest per-second, and this plan pushes images to $0.034–0.14 and draft video to $0.025–0.05/s. Marketing copy: "never billed for a failed generation."
4. **Model-aware prompt enhancement**: the Veo 3.1 formula, image-ad structure, auto negativePrompt, auto-translation. Freepik reveals prompts but doesn't rewrite per-model; Krea has 64 models and zero per-model prompt engineering; Higgsfield has no routing at all. Our first-shot quality per model is ahead — the gaps are inspectability and dialects (Section 3), not the enhancer itself.
5. **Arabic/MENA prompt layer**: auto-English translation, Arabic prompt packs, RTL awareness, Hijri context. Every competitor is English-centric; Higgsfield's UGC avatars are generic Western faces. The ONLY Arabic gap is in-image glyph rendering — a model gap closed by Seedream 5.0 Pro (Rank 3), not a rebuild.
6. **Automatic reliability routing**: the fallback chain with telemetry is unique — Krea users manually switch models on outage, Higgsfield users eat the credit cost of failures. Caveat: it is only a non-gap once G1 (dead xAI leg) is fixed.
7. **Video model quality**: Veo 3.1 with native audio at 1080p beats MJ video outright (i2v-only, 720p max, NO audio, ~21s cap) and matches or beats the Freepik/Krea resold catalog. Runway Gen-4.5 leads some benchmarks at 2.5–5x our price per second — compete on cost-per-approved-deliverable, not Elo.
8. **API-native end-to-end + publishing**: MJ has no API at all; Runway ends at the MP4; Krea/Freepik have no scheduling/publishing. Radix owns brief→creative→publish to IG/TikTok/LinkedIn.
9. **Ad-format primitives**: negative-space-for-copy, platform safe-zones, per-platform aspect presets — ahead of every competitor (MJ is explicitly ad-format blind; Krea/Freepik generate pictures, not ad creatives). Section 3's bbox IR upgrades this lead; nothing to rebuild.
10. **Multi-reference editing on current-gen models**: our roles work on today's best models while MJ's omni-reference is stranded on V7 mid-transition. Add weights (G10); don't touch the architecture.
11. **Skip entirely**: in-app LoRA training (reference conditioning gets ~90% at zero cost/latency — Freepik charges 5,500 credits and degrades image quality doing it); realtime canvas (Krea's signature, not an ad-agency job); node-graph workflow builders (revisit only as saved "client Apps" presets later); public community feed (build the org-private gallery already on the roadmap instead).

---

**Sequencing note:** Week 1 = G1 credits + Rank 1–2 (bug-killing r2v + GA migration, zero new adapters, before the 2026-08-17 Imagen deadline). Week 2 = fal adapter + Arabic lane + draft ladders (Ranks 3–5). Weeks 3–4 = Grok 1.5, Omni Flash video-edit, and the UX top-3 (draft-grid finalize, @entities, prompt reveal). Everything above routes through ai-router — universal-fallback and cost-meter exact-string rules apply to every new id.