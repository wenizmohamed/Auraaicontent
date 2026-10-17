# AuraAI V2 — Ultimate AI Content Planner Spec (v2-ultimate-w1)

> **Status:** Approved · 2026-05-12 · branch `v2-migration` HEAD `cffca40`
> **Authored by:** AURA via `/ui-ux-pro-max` v2.5.0 (Phase A) + `/skillx:skillx` marketplace (Phase B) + `/aura-superagent` 6-agent pipeline (Phase C, learning_id `superagent-8b11e50052e8`)
> **Target ship:** 1 week, Wave-parallel (3 sub-agents per Wave)
> **Plan source:** `C:\Users\wenim\.claude\plans\check-waht-we-have-async-noodle.md`

---

## §0 Context & gap rationale

AuraAI V2 is past the hardening phase. Last 15 commits are auth / billing / audit / finance infra. Workshop 2026-05-06 surfaced 6 actionable UX items (5 shipped today in commit `cffca40`, 1 deferred). Beyond the workshop, an audit of the live surface vs best-in-class AI content planners (`manus.ai`, `climaty.ai`, Buffer, Later, Sprout Social) reveals 3 highest-leverage gaps:

1. **Manus-grade real-time Agent UI** — current `apps/desktop/src/pages/Agent.tsx` = 193 LOC / 7.6KB with 1 socket reference. Route exists but feels stub.
2. **Post scheduler + auto-publish loop** — `scheduledAt` column referenced in `server/src/routes/calendar.ts:237`, OAuth wired for TikTok + LinkedIn at `integrations.ts:109-110`, `publish.ts` route registered — but NO cron/queue worker actually fires the deadline. Generation→manual-copy-paste, not generation→schedule→auto-publish.
3. **Brand Kit v2** — `Client` model has only `logoUrl` + `primaryColor`. Every AI prompt currently includes ad-hoc brand directives. Canonical BrandKit injected into the AI router lifts output quality across image/video/text without per-prompt engineering.

Pipeline used to produce this spec: `/ui-ux-pro-max --persist` → `/skillx search` × 5 → `/aura-superagent dispatch`. Synthesis of all 3 inputs below.

---

## §1 Manus-grade Agent UI (F1)

### Design tokens (override Master where needed)
Override the generator's red+Playfair MASTER tokens — AuraAI keeps its existing amber `#F59E0B` accent + Inter-only typography. Apply MASTER spacing / shadow / motion tokens unchanged. Page-specific overrides from `design-system/radix-ai-content-planner/pages/agent.md`:
- **Layout:** max-width 1400px, 12-column grid, high content density
- **Effects:** stream text token-by-token, real-time chart animations, status-indicator blink, smooth data stream updates
- **AI interaction:** stream tool-call cards as they arrive (no batch-render)

### Architecture (from Architect agent, confidence 0.95)
- **State:** Zustand slice at `apps/desktop/src/store/agent.ts` ingesting Socket.IO `/agent` events. No prop-drilling, predictable thought-replay timeline.
- **Stream:** existing Socket.IO namespace `/agent` (server/src/realtime/io.ts already attached). Events map to existing Prisma `AgentEvent` + `AgentMessage` rows for state-reconciliation on reload.
- **UI:** `apps/desktop/src/pages/Agent.tsx` extends from 193 LOC → ~1.2k LOC. 3 panels: thought-timeline (left), live message stream (center), artifact renderer (right). Reuse Manus-pattern from `aura-manus-kit:sdk-event-stream`.

### Files
| Action | File | Notes |
|---|---|---|
| CREATE | `apps/desktop/src/store/agent.ts` | Zustand slice |
| MODIFY | `apps/desktop/src/pages/Agent.tsx` | Full rewrite, 193 → ~1.2k LOC |
| MODIFY | `server/src/realtime/io.ts` | Append fine-grained `thought`/`tool-call`/`artifact` event types |
| REUSE | `server/src/agent/tools/*.ts` | 9 tools already emit AgentEvent rows |

### Failure modes + mitigations
- Socket disconnect during long-running tool calls → reconciliation loop pulls `AgentMessage` rows on reconnect (don't trust pure socket state)
- 10k+ concurrent streams → Redis adapter for cross-node Socket.IO broadcasting (deferred to scale)
- Memory leak from event ring buffer → cap at 500 events per session, discard older with debug-mode-only fetch

### Rollback
`git revert <commit>` — pre-rewrite `Agent.tsx` at commit `cffca40` still functional.

---

## §2 Post scheduler + auto-publish (F2)

### Design tokens
From `design-system/radix-ai-content-planner/pages/scheduler.md` — drag-drop on calendar, optimal-time hints inline.

### Posting-time defaults (from `openclaw/rey-social-scheduler` Phase B input)
| Platform | Optimal slots (local time, weekday) |
|---|---|
| X / Twitter | 07–09, 12–13, 18–21 |
| Threads | 07–09, 12–13, 19–21 |
| Instagram | 06–09, 12–14, 17–21 |
| TikTok | 07–09, 12–14, 19–23 |
| LinkedIn | 07–09, 12–13 |

Suggested by scheduler UI as hint pills when user drags a post onto an empty day. User can ignore.

### Architecture
- **Worker:** `server/src/workers/scheduler.worker.ts` — BullMQ cron, polls `CalendarPost.scheduledAt` rows where `status='scheduled' AND scheduledAt <= now() + 60s`
- **Idempotency:** unique key `postId + scheduledAt` enforced via Redis SETNX, prevents double-publish under retry / restart
- **Kill switch:** env `SCHEDULER_DISABLED=true` short-circuits the worker (deploy-safe rollback)
- **Dispatch:** worker calls existing `server/src/routes/publish.ts` handler logic (already audit-logged at line 60+) per `post.platformConnectionId` via `PlatformConnection` Prisma model

### Files
| Action | File | Notes |
|---|---|---|
| CREATE | `server/src/workers/scheduler.worker.ts` | BullMQ consumer |
| MODIFY | `server/src/routes/calendar.ts:237` | `scheduledAt` write-path enqueues a BullMQ job |
| MODIFY | `server/src/routes/publish.ts` | Extract publish-dispatch as importable fn |
| MODIFY | `apps/desktop/src/pages/ContentCalendar.tsx:1228` | Drag-drop slot UI with optimal-time hints |
| MODIFY | `server/src/app.ts` | Boot the worker on startup |

### Failure modes + mitigations
- **Double-publish under retry:** `postId+scheduledAt` idempotency key (mandatory)
- **Clock drift across worker nodes:** single-worker pattern + Redlock if scaling out
- **OAuth token expiry mid-schedule:** `tokenHealth.worker.ts` already refreshes proactively per commit `e0fac77`
- **Disabled accounts:** worker skips and surfaces in `/integrations` UI

### Rollback
`SCHEDULER_DISABLED=true` env var halts the worker without code redeploy. Queue drains as no new jobs fire.

---

## §3 BrandKit v2 (F3)

### Design tokens
From `design-system/radix-ai-content-planner/pages/brand-kit.md` — max-width 1200px, full-width sections, sections: hero / description / benefit bullets / CTA / footer.

### Schema (Researcher agent + omer-metin/ai-brand-kit 8 principles applied)
Standalone `BrandKit` model 1:1 with `Client` (Architect's recommendation — avoids bloating Client schema, native versioning support):

```prisma
model BrandKit {
  id                 String   @id @default(cuid())
  clientId           String   @unique
  orgId              String
  version            Int      @default(1)
  // Visual identity
  primaryColor       String?  // already on Client — also mirrored here for compute simplicity
  secondaryColor     String?
  accentColor        String?
  // Typography
  fontPrimary        String?  // CSS font-family or Google Fonts name
  fontSecondary      String?
  // Voice (multi-sample per ai-brand-kit principle "voice training requires volume")
  voiceSamples       Json[]   // [{ context: 'instagram'|'linkedin'|'tiktok'|'x'|'email'|'general', sample: '...' }]
  voiceDoNot         Json?    // { rules: ['Never use gradients', 'Avoid emoji in headlines', ...] }
  voicePerPlatform   Json?    // { instagram: 'casual + ALL CAPS optional', linkedin: 'professional', ... }
  // Visual anchors (per ai-brand-kit principle "10-20 brand anchor images")
  sampleImages       Json[]   // [{ url, label, primary?, mimeType }] — CDN URLs, NOT base64 (DB bloat)
  // Governance
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  changelogEntries   BrandKitVersion[]
  org                Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  client             Client       @relation(fields: [clientId], references: [id], onDelete: Cascade)
  @@index([orgId])
  @@index([clientId])
}

model BrandKitVersion {
  id          String   @id @default(cuid())
  brandKitId  String
  version     Int
  changedBy   String?  // userId
  changedAt   DateTime @default(now())
  snapshot    Json     // full prior state for rollback
  brandKit    BrandKit @relation(fields: [brandKitId], references: [id], onDelete: Cascade)
  @@index([brandKitId, version])
}
```

Migration: `server/prisma/migrations/20260512_add_brand_kit_v2/migration.sql`.

### Enricher helper
`server/src/lib/brand-kit-enricher.ts` exports `enrichWithBrandKit(req, clientId, opts?)` — fetches the BrandKit for clientId, appends a structured prompt-prefix mirroring the existing `enrichBodyPrompt` pattern in `gemini.provider.ts` (shipped 2026-05-11 in commit `cffca40`):

```
[BRAND KIT — Acme Co]
Voice: <voicePerPlatform[req.platform] || voiceSamples filtered to general>
DO NOT: <voiceDoNot rules joined>
Visual reference: 3 anchor URLs from sampleImages where primary=true
[/BRAND KIT]
<original req.prompt>
```

Called BEFORE `aiRouter.text/image/video/analysis` dispatch in the router itself (single point of injection, not per-route).

### Files
| Action | File | Notes |
|---|---|---|
| MODIFY | `server/prisma/schema.prisma` | Add `BrandKit` + `BrandKitVersion` models, inverse relations on Client + Organization |
| CREATE | `server/prisma/migrations/20260512_add_brand_kit_v2/migration.sql` | SQL migration |
| CREATE | `server/src/lib/brand-kit-enricher.ts` | `enrichWithBrandKit()` helper |
| MODIFY | `server/src/services/providers/ai-router.ts` | Call enricher before all 4 task dispatches |
| CREATE | `server/src/routes/brand-kit.ts` | CRUD: GET/POST/PATCH/DELETE `/api/clients/:id/brand-kit` + version-history list |
| MODIFY | `server/src/app.ts` | Register brandKitRoutes |
| CREATE | `apps/desktop/src/pages/BrandKit.tsx` | New page with form for all fields |
| MODIFY | `apps/desktop/src/App.tsx` | Register `/brand-kit` route + sidebar nav item under Knowledge |

### Failure modes + mitigations
- **Context window overflow:** cap `voiceSamples` to 3 per context, `sampleImages` to 5 max in the enricher (not at schema level — schema allows full library)
- **No BrandKit for a client:** enricher is a no-op, passes original prompt through unchanged
- **Skip override:** `meta?.skipBrandKit === true` bypasses enrichment per-call (debugging / testing)

### Rollback
`prisma migrate resolve --rolled-back 20260512_add_brand_kit_v2` + revert `ai-router.ts` enricher invocation.

---

## §4 Wave-parallel build sequence

Pattern proven on commit `cffca40` today: spawn 3 sub-agents in ONE message per Wave.

### Wave 1 — Foundation (Day 1–2)
Parallel batch:
- **A1:** F3 schema + migration + enricher helper + ai-router wire
- **A2:** F2 scheduler.worker.ts + BullMQ boot + idempotency key + kill switch env
- **A3:** F1 Zustand store + Socket.IO `/agent` event types extension

### Wave 2 — Surface (Day 3–4)
Parallel batch:
- **A1:** F3 BrandKit.tsx page + CRUD route + nav link
- **A2:** F2 ContentCalendar.tsx drag-drop slot + optimal-time hints
- **A3:** F1 Agent.tsx full rewrite (193 → ~1.2k LOC), 3-panel layout

### Wave 3 — Polish + verify (Day 5)
Sequential:
- Build + deploy via `scripts/deploy-backend.sh` + tar-pipe frontend
- Playwright-from-VPS smoke (login as Saltanat → exercise each feature)
- `/aura-rating` delta vs today's 8.5/10 baseline → target ≥9.0/10
- `/aura-learn` persist patterns
- Tag `v2-ultimate-w1`

---

## §5 Verification matrix (playwright-from-VPS, pattern proved today)

### F1 Agent UI
```
Login as Saltanat → /agent → submit "research Al Fardan May campaign"
ASSERT: ≥3 distinct tool-call cards stream within 30s
ASSERT: artifact panel renders if any tool emits a file URL
ASSERT: thought timeline replays last 5 events on page refresh
ASSERT: 0 page-error events in 30s window
```

### F2 Scheduler
```
POST /api/calendar/posts with scheduledAt = now()+60s, platform=Instagram
ASSERT: BullMQ job appears in Redis bull:scheduler:* queue within 5s
WAIT 90s
ASSERT: publish.ts handler invoked exactly once (audit log post.publish row count +1)
ASSERT: re-firing the job (manual SETNX clear) does NOT double-publish
```

### F3 BrandKit
```
POST /api/clients/:id/brand-kit with secondaryColor + voiceDoNot=["no emoji"]
POST /api/creative/images/generate with prompt "a woman doing yoga"
ASSERT: response 200, asset persisted
GREP deployed dist gemini.provider.js → enrichBodyPrompt × 4 (preserved)
GREP deployed dist ai-router.js → enrichWithBrandKit × N (new)
GET /api/history/latest → assert metadata.brandKitVersion = 1
```

### Smoke matrix (final)
```
✅ Login
✅ F1 streams ≥3 cards / 30s
✅ F2 fires 60s job within 90s window
✅ F2 idempotency blocks double-fire
✅ F3 enricher fires + history records brandKitVersion
✅ 0 page-errors on /agent, /brand-kit, /calendar in 30s window each
✅ pm2 stderr zero regressions
✅ aura-rating ≥ 9.0/10
```

---

## §6 Anti-patterns (Critic + MASTER.md combined)

1. **Stale Prisma joins** — always `include: { calendarMonth: { select: { clientId: true } } }` not `select: { clientId: true }`. Validated incident on 2026-05-11 commit `4b9a99c`.
2. **HTTP polling for Agent state** — Socket.IO only, mandatory.
3. **Phantom file assumptions** — Builder failed on this today (commit `cffca40` flow). Pre-Wave-1: every sub-agent prompt MUST cite `head` of target file to prove it exists.
4. **Base64 sample images in DB** — store CDN URLs only, never raw bytes (Postgres row bloat).
5. **Unbounded enricher arrays** — `voiceSamples` cap=3, `sampleImages` cap=5 inside `enrichWithBrandKit`, regardless of how big the schema allows.
6. **No idempotency on scheduler** — `postId+scheduledAt` SETNX is mandatory, not optional.
7. **Truncated Builder output** — Critic must flag if Builder agent's output stops mid-section. Verifier+Critic loop already shipped today, keep firing.

---

## §7 Out of scope (deferred to v2-ultimate-w2)

The remaining 5 gaps from today's audit, NOT in this 1-week plan:
- Post-engagement analytics (first-party impressions/likes/comments per published post)
- Multi-step approval workflow (draft → internal-review → client-approve → schedule → publish → analyze)
- In-browser visual editor (Canva-style edit-on-generated-asset)
- A/B variant generation + comparison UI
- Semantic history search (vector-backed History page)

Plus 1 deferred workshop item: `apps/desktop/src/pages/CreativeTools.tsx` inline asset-history rail (Low priority, no reporter overlap).

---

## §8 Execution checklist

- [ ] Wave 1 dispatched (3 sub-agents, 1 message)
- [ ] Wave 1 deployed + smoke green (F3 enricher + F2 worker + F1 store)
- [ ] Wave 2 dispatched
- [ ] Wave 2 deployed + smoke green (Surface)
- [ ] Wave 3 polish + verify
- [ ] Playwright-from-VPS final matrix all 8 ticks
- [ ] `/aura-rating` ≥ 9.0/10
- [ ] `/aura-learn` patterns persisted
- [ ] git tag `v2-ultimate-w1` on the deploy commit
