# Design — Video Cost Tiering + Accurate Usage Tracking + Live Meter

**Status:** Draft for approval
**Date:** 2026-06-03
**Trigger:** 14-day spend was $172.75; $169 of it was Veo video on the top tier ($0.50/s). Owner wants (a) cut Veo cost without killing the feature, (b) *accurate* per-user/per-model token+cost, (c) a live usage meter users can see.

## Goal

1. **Cut video cost ~75%+** by routing **drafts → Grok** (`grok-imagine-video`, $0.05/s) and **finals → Veo** (fast $0.20/s default, full $0.50/s only on explicit HD), without removing Veo-grade quality where it ships.
2. **Make usage accounting accurate** — real provider-billed seconds for video, no unattributed (null-`userId`) calls, no silently-untracked routes.
3. **Surface a live usage meter** (all users) + per-model breakdown (admin), reusing the per-user `UsageEvent` reporting that already exists.

## Decisions (locked with owner)

- Tiering model: **Grok for drafts, Veo for finals** (−75%+).
- "Final" unlock = **explicit "Generate in HD" toggle** in the creative tool. Default = draft (cheap).
- **HD = `veo-3.1-fast` ($0.20/s), not full Veo.** Full Veo ($0.50/s) is *not* exposed by default — a future "Max quality" control can add it. (Spec-review fix: the old `fast=false` mapping would have silently landed every HD on full Veo at 4× the assumed cost.)
- **Auto-HD-on-approved-post is deferred to a follow-up.** Spec-review confirmed the *only* caller of `aiRouter.video` is the standalone creative tool (`creative.ts:166`) — no flow threads a `postId`/post-status into video gen today (`calendar.ts:328` regenerate is a 501 stub). Building that post→video flow is its own task; v1 ships the explicit toggle only.
- Accuracy scope: **option (c)** — accurate accounting **and** a visible live meter.

---

## Part A — Video cost tiering (biggest $ win)

### Current flow (from scoping)
`CreativeTools.tsx:368` → `creativeApi.generateVideo` (`backend-api.ts:472`) → `POST /api/creative/videos/generate` (`creative.ts:128`) → `aiRouter.video` (`ai-router.ts:214`) → `orderedProviders('video')` (fixed by `AI_VIDEO_PRIMARY=gemini`) → `gemini.provider.video` (`:308`, honors `req.fast`) / `xai.provider.video` (`:122`, **ignores** `req.fast`).
`VideoRequest.fast` exists (`types.ts:31`) but is never set. Frontend sends no `postId`/quality.

### Changes
| # | File | Change |
|---|------|--------|
| A1 | `types.ts` (`VideoRequest`) | Add `tier?: 'draft' \| 'hd'`. (Keep `fast` for the Veo sub-ladder.) |
| A2 | `ai-router.ts` `routeCall` (`:122-128`) **+** `orderedProviders` (`:150`) **+** `video()` | Thread a per-call **provider-order override** through `routeCall`'s signature down to `orderedProviders` (which today takes only `task` and never sees `req`). Draft → force `[xai, gemini]`; HD → keep `[gemini, xai]`. Derive from `req.tier`. **All three functions change, not just two.** |
| A3 | `creative.ts` route (`:131`–`:180`) | Extract `tier` from body (default `'draft'`). Set `req.tier` and **`req.fast = true` for BOTH tiers** (draft→Grok-fast fallback; HD→veo-3.1-fast). Full Veo is never selected in v1. |
| A4 | `xai.provider.video` (`:122`) | Honor `req.fast` → reorder ladder fast-first (`grok-imagine-video-fast` $0.03/s before standard $0.05/s). |
| A5 | `backend-api.ts:472` `generateVideo` | Add `tier?: 'draft'\|'hd'` to the request shape. (`postId` deferred with auto-HD.) |
| A6 | `CreativeTools.tsx` | Add a **Draft / HD** segmented toggle (default Draft) + a cost-preview line ("~$X for this clip"). |

### Cost impact (10s clip)
| Tier | Engine (v1) | $/10s | vs today ($5.00) |
|---|---|---|---|
| **Draft (default)** | grok-imagine-video-fast | $0.30 | **−94%** |
| Draft (Grok std fallback) | grok-imagine-video | $0.50 | −90% |
| **Final HD** | **veo-3.1-fast** | **$2.00** | **−60%** |
| _(deferred "Max")_ | veo-3.1 full | $5.00 | — |

Projected: Haneen's $169/14d → **~$30–45** at the same volume (≈half draft/half HD). All draft → under $15.

### Edge cases
- Grok unavailable for a draft → breaker is keyed `(provider, task='video')` and **cannot distinguish draft-Grok from HD-Veo**, so a tripped Grok breaker silently routes **all drafts to veo-fast** (higher cost, still −60%). Mitigation: add `tier` to the telemetry entry so this is visible in `ai-stats`; accept the cost bump as a transient during a Grok outage.
- Image-to-video drafts: Grok accepts a data-URL ref image (`xai.provider:133`) — supported.
- Standalone creative tool has no `postId` → tier comes purely from the toggle; default draft.

---

## Part B — Accurate accounting (option c, part 1)

| # | Severity | File:line | Gap | Fix |
|---|---|---|---|---|
| B1 | **LOW** (reframed) | `creative.ts:132,172`, `ai-router.ts:222`, `ai-pricing.ts:77,94` | Spec-review fix: Veo/Grok responses do **NOT** return a duration field, and `ProviderResult` has nowhere to carry one — "read from response" is unimplementable. But request-duration billing is **already wired** (`req.durationSeconds`→`persistUsage`→`computeCostUsd`). Real gap = only the 8s *fallback* when FE omits duration. | **Verify** `CreativeTools` always sends the user-selected 5/8/10 enum as `durationSeconds` (agent-1 scan shows it does at `CreativeTools.tsx:373`). If confirmed, B1 is a no-op/regression-guard: assert the value is present, never null. |
| B2 | **HIGH** | `research.ts:162` | brand-synthesis `chatText` passes **no meta** → Kimi 100k-token calls fully untracked | Add `meta` **inside the existing options object**: `chatText({...}, { chain: [...], meta: { orgId: request.orgId, userId: request.user?.userId, clientId } })`. orgId/userId confirmed available (`research.ts:21` authGuard). |
| B3 | MED | `assistant.ts:178`, `agent/tools/visual_search.ts:44` | visual-search AI fallback drops `userId` | Thread `userId` into meta at both confirmed call sites. |
| B4 | MED | image paths `gemini.provider:254-305`, `xai.provider:103-119` | image responses don't capture tokens (units=0; cost still correct via per-call price) | Capture tokens where the API returns them; otherwise leave per-call pricing (acceptable). |
| B5 | LOW | `ai-router.ts:45` | `if (!meta.orgId) return` silently drops untracked calls | Add a `console.warn` + telemetry counter so future regressions are visible. |

Verified GOOD (no change): text/analysis token capture (`gemini.provider:189`, `xai.provider:91`, `chat.ts:254` with `include_usage`).

---

## Part C — Live meter + per-model view (option c, part 2)

The accurate per-user backend already exists: `Admin.tsx:293` uses `adminApi.usageByUser/usageByDay/usageTotals` → `UsageEvent`. Reuse it.

| # | File | Change |
|---|------|--------|
| C1 | `routes/dashboard.ts` (+`backend-api.ts`) | New **org-scoped** `GET /api/dashboard/usage` → `{ monthToDate: { calls, costUsd, units }, byModel: [...], byUser: [...] }` from `UsageEvent` filtered by `request.orgId` (available via `authGuard`, `dashboard.ts:9`). **`groupBy`/`aggregate` MUST include `orgId` in `where`** or `tenantGuardExtension` throws (`prisma-tenant.ts:97`). Indexes `@@index([orgId, kind, createdAt])` cover it. Org-scoped, NOT staff-only — every owner sees their org. |
| C2 | `components/UsageMeter.tsx` (new) + `App.tsx:369` sidebar footer | Always-on compact meter: "$ this month · N calls", `useQuery` 30s refetch, semantic tokens only (`--color-surface`, `--color-accent`, `--color-fg-muted`). Click → billing/usage detail. |
| C3 | `Admin.tsx:312` + backend | Add **per-model** breakdown (today `usageByUser.breakdown` is keyed by `kind`; add `byModel`). |
| C4 | `CreativeTools.tsx` (with A6) | Cost-preview before a Veo HD gen ("This HD clip ≈ $X"). |

Dashboard-scope rule honored: org-wide, not current-client only.

---

## Out of scope (this pass)
- Hard per-user quotas / blocking (owner prioritized *accuracy* over caps). Revisit after meter ships.
- Reading provider invoices via API for reconciliation (estimate-from-response is enough now).
- Deploying the parked **circuit-breaker perf fix** (separate, already built, awaiting restart OK) and the **undeployed `errors.ts` model-rot patterns** (live is behind git).

## Testing strategy
- **A:** unit-assert tier→provider-order + `fast=true` mapping; e2e generate a draft (confirm `grok-imagine-video*` in telemetry) and an HD final (confirm `veo-3.1-fast`). (Auto-HD-on-approved-post test deferred with that feature.)
- **B1:** generate clips of 5s/8s/10s, assert `UsageEvent.metadata.durationSeconds` == the requested enum (never the 8s fallback) and cost == rate×duration.
- **B2/B3:** hit brand-synthesis + visual-search fallback, assert a `UsageEvent` row exists with correct `userId`.
- **C:** meter shows org month-to-date matching a direct `UsageEvent` SUM; per-model admin table sums to totals.

## Rollout
Behind no flag for accuracy fixes (pure correctness). Tiering ships default-draft so cost drops immediately; HD is opt-in. Build in `/opt/radixcontent` (git), deploy to `/opt/radix-v2` per CLAUDE.md, smoke test, verify behaviorally.
