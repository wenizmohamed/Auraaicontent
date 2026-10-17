# AuraAI Content Planner V2

Production-grade AI content-planning workspace for AuraAI. A single-tenant SaaS dashboard the agency uses to brief, generate, review, schedule, and export 18 platform-optimized content pieces per client per month.

Branding uses AuraAI. Legacy `radix` deployment paths, domains, environment variables, database and queue names, browser storage keys, Electron app ID and profile directory, and asset filenames remain unchanged for compatibility with existing installations. `@radix-ui/*` refers to the third-party Radix UI library, not product branding. Historical reports and document IDs are retained as recorded.

**Live**: `https://srv1494206.hstgr.cloud` · **Branch**: `main` · **Hardening branch**: `million-dollar-hardening`

## Tech Stack

| Layer | Stack |
|---|---|
| Frontend | React 19 + TypeScript + Vite 6 + Tailwind v4 + framer-motion + lucide-react |
| Backend | Fastify 5 + Prisma 6 + PostgreSQL 16 + ioredis + BullMQ |
| Auth | JWT (Bearer in `Authorization` header) + 30-day refresh-token rotation + revocation |
| AI providers | Gemini 3.1 Pro / Flash / Image (primary) → xAI Grok (fallback) → Kimi K2 (tertiary) |
| Desktop | Electron 41 (optional shell, web works standalone) |
| Deploy | Hostinger VPS · pm2 (`radix-api`) · nginx · Postgres `radix_planner` · Redis 6379 |
| Test | Vitest (smoke contract tests against live VPS) · `tsc --noEmit` (typecheck) |

## Quick Start (local)

```bash
# 1. Install everything (server + frontend, monorepo workspaces)
npm install

# 2. Server-side setup
cd server
cp .env.example .env                   # fill in DATABASE_URL, JWT_SECRET, GEMINI_API_KEY, XAI_API_KEY
npm run prisma:generate                # build typed Prisma client
npm run prisma:migrate                 # apply schema (uses .env DATABASE_URL)
npm run prisma:seed                    # OPTIONAL — Al Fardan demo data + 2 demo users
npm run dev                            # starts on :8787

# 3. In a second terminal, frontend
cd apps/desktop
npm run dev                            # starts on :3200, proxies /api/* to :8787
```

Demo credentials after seeding:
- `demo-admin@radix.local` / `demoAdmin2026!`
- `demo-member@radix.local` / `demoMember2026!`

## Test

```bash
cd server
npm run typecheck          # tsc --noEmit, both workspaces have this script
npm run test               # vitest — runs smoke tests against the LIVE VPS
npm run test:smoke:local   # smoke tests against local :8787 (set SMOKE_BASE_URL)
npm run test:coverage      # vitest with v8 coverage report

cd apps/desktop
npm run typecheck
```

The smoke suite covers 17 endpoint contracts — auth boundary, public endpoints, protected-route 401s, rate-limit headers, agent-mode-removal verification.

## Deploy (current setup)

Hostinger VPS, pm2-managed, nginx-fronted. The deploy is two tar-pipes + a pm2 reload:

```bash
# From repo root
cd server && npm run build && cd ..
tar -czf - -C server dist | ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud \
  "cd /opt/radix-v2/server && rm -rf dist && tar -xzf - && pm2 reload radix-api"

cd apps/desktop && npm run build && cd ../..
tar -czf - -C apps/desktop dist | ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud \
  "cd /opt/radix-v2/frontend && rm -rf dist && tar -xzf -"

# After schema changes
ssh root@srv1494206.hstgr.cloud "cd /opt/radix-v2/server && npx prisma migrate deploy"
```

After deploy: hard-refresh browser (Ctrl+Shift+R) so the new bundle hash loads.

## Architecture (one-screen tour)

```
apps/desktop/        React 19 frontend (Vite, electron-optional)
  src/pages/          17 routes: Dashboard, NewBrief, Calendar, Knowledge, Profile, etc.
  src/components/     MobileMenu, RadixAssistant widget, etc.
  src/lib/            backend-api.ts (fetch wrapper + token rotation),
                      client-context.tsx (auth + selected client state),
                      theme-context.tsx (light/dark)

server/              Fastify 5 backend
  src/routes/         18 route modules (auth, clients, calendar, contentPieces, knowledge, ...)
  src/services/       providers/ (gemini, xai, kimi), embeddings, visual-search, llm/chat
  src/middleware/     auth (JWT + refresh), rate-limiter (Redis-backed, in-memory fallback),
                      sanitize
  src/workers/        queue.ts (BullMQ + ioredis, single Worker concurrency=4)
  src/db/             prisma client singleton
  prisma/             schema.prisma (User, Client, ClientBrief, CalendarMonth + Post, ContentPiece,
                      KnowledgeItem + Chunk, Asset, ReviewLink, ExportJob, AuditLog,
                      AgentSession + Message + Event)
  prisma/migrations/  all migrations checked in
  prisma/seed.ts      Al Fardan demo data + 2 demo users
  test/smoke.test.ts  17 contract tests against live VPS
```

## Security model (honest, not hand-wavy)

| Concern | Status |
|---|---|
| Authentication | JWT in `Authorization: Bearer …` header, 1h TTL (7d if `rememberMe`). Refresh-token rotation with reuse-detection (any reuse revokes ALL sessions for that user). |
| CSRF | **Not vulnerable.** Bearer-token auth in a header is immune by design — browsers don't auto-attach `Authorization` cross-origin like they do with cookies. No CSRF middleware needed. |
| Rate limiting | Per-IP sliding window via Redis (`X-RateLimit-Backend: redis` in response headers). Falls back to in-memory if Redis is down. Buckets: auth=10/min, agent=20/min, AI=30/min, generic=120/min. |
| Password storage | bcrypt cost 12. |
| CORS | Env-allowlisted (`HTTP_CORS_ORIGINS`), fails closed in prod. |
| CSP | Strict via `@fastify/helmet` (no `'unsafe-inline'` script), HSTS in prod. |
| Multi-tenancy | **Single-tenant by design.** Every authed user sees every Client. Auth gates entry; inside the wall the workspace is shared (matches AuraAI's one-agency model). Adding a second agency requires an `Organization` model + `orgId` on Client + scoping every query handler — not done. |
| File uploads | 25MB limit via `@fastify/multipart`. |
| Audit log | Append-only `AuditLog` table with `userId` + `clientId` + `action` + `entityType`. |

## Database

PostgreSQL 16. Schema declares unique constraints + FK indexes for hot joins (KnowledgeItem.clientId, Asset.clientId, CalendarPost.calendarMonthId, PostComment.{postId,authorId}, ReviewLink.clientId, ExportJob.clientId, AuditLog.{userId,clientId,createdAt}, KnowledgeChunk.knowledgeItemId, plus `(clientId, month)` and `(calendarMonthId, date)` uniques for idempotent upserts). Migrations live in `server/prisma/migrations/` and apply with `prisma migrate deploy`.

## Background jobs

BullMQ queue `radix-jobs` backed by Redis. One Worker, concurrency 4. On boot, `reconcileStaleJobs()` reclaims any active-but-orphaned jobs from a prior crash. SIGTERM/SIGINT trigger graceful queue drain via `shutdownQueue()`.

## License

Private — AuraAI internal tool.

---

Built by Weni Mohamed + AURA · April 2026
