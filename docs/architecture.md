# Architecture

## High-level stack

```
                   ┌────────────────────────────┐
                   │  Electron desktop / Browser │
                   │  React 19 + Vite + Tailwind │
                   └─────────────┬──────────────┘
                                 │ HTTPS + Socket.IO
                                 ▼
                   ┌────────────────────────────┐
                   │  nginx (radix.synapseai-labs.com)
                   │  Let's Encrypt SSL          │
                   └─────────────┬──────────────┘
                                 │ proxy_pass
                                 ▼
   ┌─────────────────────────────────────────────────┐
   │  radix-api (Fastify + Prisma + TypeScript)       │
   │  ┌────────────────────────────────────────────┐  │
   │  │ Auth: JWT { userId, email, orgId, orgRole } │  │
   │  │ Routes: 19 modules (clients, calendar, …)   │  │
   │  │ Tenant guard: Prisma extension throws on    │  │
   │  │  unscoped queries to the 19 tenant models   │  │
   │  │ AI router: Gemini → xAI → Kimi fallback      │  │
   │  │  + UsageEvent persistence (cost in USD)      │  │
   │  │ Workers (in-process queue):                  │  │
   │  │  - generateMonth → CalendarMonth + Posts     │  │
   │  │  - export → PPTX / WhatsApp deep link        │  │
   │  │  - assetAnalysis → Gemini Vision             │  │
   │  │  - embeddings → Gemini Embedding             │  │
   │  │ Realtime: Socket.IO /agent + /bo namespaces  │  │
   │  └────────────────────────────────────────────┘  │
   │       │                │                │         │
   │  PostgreSQL          Redis        Provider APIs   │
   │  (Prisma)            (queue)      (Gemini/xAI/   │
   │                                    Moonshot/     │
   │                                    Stripe)       │
   └─────────────────────────────────────────────────┘
```

## Tenancy model

Every tenant-scoped row carries `orgId` (FK → `Organization`). Routes and services accept `orgId` explicitly; the Prisma `tenant-guard` extension throws when a query against one of the 19 tenant models lacks `orgId` in `where` (read/update/delete) or `data` (create/upsert).

- **Tenant boundary:** `Organization` (slug-unique, has `plan`, `status`, `stripeCustomerId`).
- **Membership:** `OrgMembership { userId, orgId, role: OWNER|ADMIN|EDITOR|VIEWER }`.
- **Active org:** `User.currentOrgId` pointer — used to issue JWTs with the right `orgId` claim.
- **Invites:** `Invitation { orgId, email, role, token, expiresAt }`.

Routes pass `request.orgId` into services (`clientService.create(orgId, data)`); workers receive `orgId` in their job payload.

## Data model (21 + 4 = 25 tables)

```
Organization ─┬─ OrgMembership ─── User
              ├─ Invitation
              ├─ UsageEvent
              ├─ Client ──┬─ ApiKey
              │           ├─ ClientBrief
              │           ├─ Asset ─── CalendarPostAsset
              │           ├─ KnowledgeItem ── KnowledgeChunk
              │           ├─ ContentPiece
              │           ├─ ReviewLink
              │           ├─ ExportJob
              │           ├─ AgentSession ─┬─ AgentMessage
              │           │                └─ AgentEvent
              │           └─ CalendarMonth ── CalendarPost ─┬─ PostVisualReference
              │                                              ├─ PostVersion
              │                                              ├─ PostComment
              │                                              └─ CalendarPostAsset
              └─ AuditLog
```

## AI provider chain

| Task | Primary | Fallback | Tertiary |
|---|---|---|---|
| Text / chat | Gemini 3.1 Pro | Grok 4.20 | Kimi K2.6 |
| Image | Gemini 3.1 Flash Image | Grok Imagine | — |
| Video | Veo 3.1 | Grok Imagine Video | — |
| Analysis (image→JSON) | Gemini 3.1 Pro | Grok 4.20 | — |
| Embedding | Gemini Embedding 2 | — | — |

Configurable via `AI_TEXT_PRIMARY`, `AI_IMAGE_PRIMARY`, `AI_VIDEO_PRIMARY`, `AI_ANALYSIS_PRIMARY` in `.env`. Fallback enabled by default; disable with `AI_ENABLE_FALLBACK=false`.

Every successful provider call writes one `UsageEvent` row with `costUsd` computed from `lib/ai-pricing.ts`. Quota enforcement reads `SUM(units) WHERE orgId=? AND kind=?` for the current calendar month.

## Wedge features (Phase 3)

- **Arabic prompts:** `prompt.service.ts` switches between English and Arabic builders based on `Client.locale`. Dialect (`MSA`/`KHALEEJI`/`EGYPTIAN`/`LEVANTINE`) drives vocabulary in the system prompt.
- **GCC holidays:** `getUpcomingHolidays(month, country)` is injected into the prompt so the model factors Ramadan/Eid/National Days into its calendar.
- **WhatsApp export:** `POST /api/clients/:id/calendar/:month/export { type: 'whatsapp' }` returns a `wa.me/<phone>?text=<msg>` deep link with the calendar PDF URL prefilled.

## Key paths

| What | Where |
|---|---|
| Server source | `/opt/radix-v2/server/src/` |
| Server build | `/opt/radix-v2/server/dist/` |
| Frontend dist | `/opt/radix-v2/frontend/dist/` |
| Source repo | `/opt/radixcontent/` |
| Env (do not commit) | `/opt/radix-v2/server/.env` |
| Backups | `/opt/backups/` |
| nginx config | `/etc/nginx/sites-enabled/radix` |
| SSL certs | `/etc/letsencrypt/live/radix.synapseai-labs.com/` |

## Future evolution
- Move workers from in-process to BullMQ (Redis-backed, multi-process).
- Replace single-server VPS with a container orchestrator when MRR > $10k/mo.
- Move pgvector index into a managed Postgres or Pinecone when knowledge corpus > 100k chunks.
