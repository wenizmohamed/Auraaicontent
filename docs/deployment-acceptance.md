# AuraAI V2 — Fully Deployable Acceptance Criteria

**Status as of HEAD `4d5c95d`:** deployed at `https://srv1494206.hstgr.cloud`, 18/18 smoke green, working but with measurable gaps. This doc defines what "fully deployable" means as a checklist of testable predicates — pass all = deployable, any RED = not deployable.

**Target tier:** agency-grade single-tenant production. Multi-tenancy posture: roadmap-ready (Organization migration scoped + designed, NOT shipped — single-tenant is a deliberate decision per `README.md` security model table, not an oversight).

**Out of scope (deferred, NOT deploy-blockers):**
- Browser-Operator auto-publish (separate per-network OAuth workstream)
- Connect-RPC manus.im wire format (current REST is fine)
- Localization (Arabic content delivery — revisit when Al Fardan asks)

---

## How to read this doc

Each row is a binding predicate. Columns:
- **Criterion** — one-line statement.
- **Proof command** — exact bash to verify.
- **Current** — measured state at HEAD `4d5c95d`. RED if blocking, AMBER if degraded, GREEN if pass.
- **Target** — what must be true at deploy.
- **Rollback** — how to undo if shipping the fix breaks prod.

A criterion graduates from RED → AMBER → GREEN only when its proof command passes against the live VPS, not against the local repo.

---

## Dimension 1 — Security

| # | Criterion | Proof command | Current | Target | Rollback |
|---|---|---|---|---|---|
| S1 | JWT_SECRET ≥ 64 cryptographically-random chars | `ssh radix_vps "awk -F= '/^JWT_SECRET=/{print length(\$2)}' /opt/radix-v2/server/.env"` ≥ 64 | **RED** — 26 chars human-typed | ≥ 64 from `openssl rand -base64 48` | Roll FORWARD only — generate a second 64-char secret + redeploy + revoke all RefreshTokens. Never restore the 26-char secret (re-introduces the vuln). If a deploy with the new secret fails, generate a third secret and redeploy; never `cp .env.bak .env` |
| S2 | Zero implicit `any` at request boundaries — all POST/PUT/PATCH bodies validated via zod | `cd server && grep -rnE "as any\|as unknown as\|<any>\|@ts-ignore\|@ts-nocheck" src/routes/ \| grep -vE "//\|\.bak" \| wc -l` == 0 + ESLint rule `@typescript-eslint/no-explicit-any: error` enforced at route-boundary scope | **RED** — 19 `as any` across 11 route files; ESLint rule not configured | 0 violations + ESLint rule blocking PRs | Single `git revert <zod-sweep-sha>` on the bundled commit (zod schemas typically share `schemas.ts` so per-file revert lies) |
| S3 | All authed routes refuse unauth (401) and wrong-client (403) | Existing 18 smoke tests + 6 NEW tests (3 per /v2 + 3 per /api/api-keys CRUD) | **AMBER** — 18 covering /v1; /v2 envelope tested but not via vitest | 24+ smoke tests, all green | Disable new test file `test/v2-auth.test.ts` |
| S4 | OWASP Top-10 own-infra pentest: 0 Critical, 0 High findings | `/recon srv1494206.hstgr.cloud && /pentest && /webhack && /bypass && /hack` summary report | **UNKNOWN** — never run | Report stored at `docs/security/pentest-{date}.md`, 0 Critical/High | Pentest is read-only; no rollback needed |
| S5 | rate-limiter active on auth + AI endpoints + /v2 | Existing smoke S5 (X-RateLimit-* headers) + load-test 11 rapid POST /api/auth/login → 429 on 11th | **GREEN** — wired, headers visible, in-memory fallback works | Same; load-test added | Disable rate-limiter middleware register call in `app.ts:50` |
| S6 | helmet CSP + HSTS + CORS allowlist active in prod | `curl -I https://srv1494206.hstgr.cloud/api/health` shows `strict-transport-security`, `content-security-policy`, no `access-control-allow-origin: *` | **GREEN** — verified post-Wave-3 | Same | Already at green; remove helmet register call to revert |
| S7 | path-traversal hardened on `/api/assets/:id/download` | `curl -H "Authorization: Bearer $JWT" 'https://srv1494206.hstgr.cloud/api/assets/..%2F..%2F..%2Fetc%2Fpasswd/download'` → 400 | **GREEN** — `path.resolve` startsWith UPLOADS_ROOT | Same | Revert `server/src/routes/assets.ts` download route |
| S8 | API keys (`sk-radix-*`) bcrypt-hashed at rest, never logged | `psql radix_planner -c "SELECT keyHash FROM \"ApiKey\" LIMIT 1"` returns `$2b$...` (bcrypt) NOT plaintext; `pm2 logs radix-api --lines 1000 \| grep -i "sk-radix"` returns 0 lines | **GREEN** — bcrypt confirmed | Same | Existing migration already applied |
| S9 | Secrets-at-rest: `.env` mode 600, owner radix:radix, not in git, plaintext-rotation runbook | `ssh radix_vps "stat -c '%a %U:%G' /opt/radix-v2/server/.env"` == `600 radix:radix` + `git ls-files server/.env` returns empty + `docs/runbooks/secrets-rotation.md` exists | **AMBER** — file likely 644 owned by root; `.env` correctly gitignored; no rotation runbook | All three checks pass | `chmod 644 /opt/radix-v2/server/.env && chown root:root` (only if mode change breaks pm2) |
| S10 | Dependency audit gate: `npm audit --production --audit-level=high` exits 0 in CI for both `server/` and `apps/desktop/` | GitHub Actions step output exit code 0 on each PR | **UNKNOWN** — never run formally | Both audits pass; CI fails the PR otherwise | Drop `--audit-level` to `critical` temporarily while remediating high findings (with documented timeline) |

## Dimension 2 — Performance

| # | Criterion | Proof command | Current | Target | Rollback |
|---|---|---|---|---|---|
| P1 | Lighthouse Performance ≥ 80 on `/login` (public route) | `lighthouse https://srv1494206.hstgr.cloud --only-categories=performance --output=json --quiet \| jq '.categories.performance.score * 100'` | **UNKNOWN** — never measured | ≥ 80 | Lighthouse is read-only; no rollback. If score < 80, fix → re-measure |
| P2 | Lighthouse Accessibility ≥ 90 on `/login` | same query, `--only-categories=accessibility` | **UNKNOWN** | ≥ 90 | Same |
| P3 | Lighthouse Best Practices ≥ 95 | same query, `--only-categories=best-practices` | **UNKNOWN** | ≥ 95 | Same |
| P4 | TTFB < 800ms p50 from local network | `for i in 1 2 3 4 5; do curl -o /dev/null -s -w "%{time_starttransfer}\n" https://srv1494206.hstgr.cloud/api/health; done \| sort -n \| awk 'NR==3'` | **AMBER** — 275ms last measured (Brazil-Hostinger latency dominates) | p50 < 800ms | Read-only; perf budget |
| P5 | Frontend bundle ≤ 1MB pre-gzip, ≤ 250KB gzip | `curl -sI https://srv1494206.hstgr.cloud/assets/index-*.js \| grep -i content-length` ≤ 1024000 | **AMBER** — 893KB raw, 214KB gzip current bundle (under target) | Hold under target | rollup chunk-split if blown |
| P6 | font-display swap (Libre Bodoni + Public Sans) loads with `font-display: swap` (no FOIT) | `curl -s https://srv1494206.hstgr.cloud/assets/index-*.css \| grep -oE 'display=swap'` | **GREEN** — verified post-`4d5c95d` | Same | Revert commit `4d5c95d` |
| P7 | Lighthouse on **authed** `/dashboard` (where 90% of UX lives) Performance ≥ 75, A11y ≥ 90 | `lighthouse https://srv1494206.hstgr.cloud/ --extra-headers='{"Authorization":"Bearer $DEMO_JWT"}' --only-categories=performance,accessibility --output=json` (or use lighthouse-ci with stored auth state) | **UNKNOWN** | ≥ 75 perf / ≥ 90 a11y | Read-only |

## Dimension 3 — Reliability

| # | Criterion | Proof command | Current | Target | Rollback |
|---|---|---|---|---|---|
| R1 | BullMQ queue persists across pm2 restart (Redis-backed) | Trigger an export, `pm2 restart radix-api` mid-job, confirm job resumes | **GREEN** — `reconcileStaleJobs()` boot hook in `index.ts:9` | Same | Already green |
| R2 | rate-limiter falls back from Redis to in-memory cleanly when Redis drops | `redis-cli SHUTDOWN; curl /api/health/details` → still 200 (after auth) | **GREEN** — fallback verified post-rewrite | Same | Already green |
| R3 | Database FK indexes present on hot paths | `psql -c "\\d+ \"Asset\"" \| grep clientId` shows index | **GREEN** — migration `20260426010000_add_fk_indexes` applied | Same | Migration rollback would re-add lock contention |
| R4 | Process recovery: pm2 auto-restart on crash + memory leak guard | `pm2 ls` shows `radix-api` with `uptime` increasing + `restart` count low + `max_memory_restart` set | **AMBER** — auto-restart on; mem cap not set | Add `pm2 set radix-api:max_memory_restart 800M` | `pm2 unset radix-api:max_memory_restart` |
| R5 | Postgres backup runs daily and is restorable | `ssh radix_vps 'ls -la /opt/radix-v2/backups/ \| tail -5'` shows pg_dump file from <24h ago + spot-restore test passes | **AMBER** — manual pg_dump only | Cron `0 3 * * * pg_dump radix_planner \| gzip > /opt/radix-v2/backups/$(date +%F).sql.gz` + 14-day retention | Disable cron line |
| R6 | Smoke green automated in CI on every PR + main push | `.github/workflows/ci.yml` exists + last run on default branch shows ✓ | **RED** — no `.github/workflows/` dir | GitHub Actions runs `typecheck` (both packages) + `vitest run` against an **ephemeral docker-compose** (postgres + redis + radix-api in containers, fresh DB per run). A separate scheduled-only `smoke-prod.yml` workflow runs the existing 18 tests against `SMOKE_BASE_URL=https://srv1494206.hstgr.cloud` post-deploy. Reason: PR-level CI must NOT depend on prod uptime + JWTs in CI logs leak on flaky days | Delete the workflow file(s) |

## Dimension 4 — Multi-tenancy

**Posture: roadmap-ready single-tenant.** Single-tenant by design today. Organization model scoped + designed; migration is one parallel session away when 2nd agency signs.

| # | Criterion | Proof command | Current | Target | Rollback |
|---|---|---|---|---|---|
| M1 | README.md security model table documents single-tenant choice + path-to-multi-tenant | `grep -c "Multi-tenancy" README.md` ≥ 1 + table includes "Single-tenant by design" + migration estimate | **GREEN** — already documented | Same | Already green |
| M2 | Organization model migration is **scoped and reviewed** (not shipped) | `ls docs/multi-tenancy/proposed-migration.sql 2>/dev/null` exists + design companion `docs/multi-tenancy/scope.md`. **Critical:** stored under `docs/`, NEVER under `prisma/migrations*` or any path Prisma scans — auto-apply on `prisma migrate deploy` would silently destroy single-tenant prod | **RED** — only verbal "3-4h" estimate, no scoped diff | `docs/multi-tenancy/proposed-migration.sql` + `docs/multi-tenancy/scope.md` listing every query handler that needs orgId scoping | Delete the docs/multi-tenancy/ directory |
| M3 | Every Client query is reviewable for orgId-scope-readiness | `grep -rn "where:.*clientId" server/src/services server/src/routes \| wc -l` matches list in `docs/multi-tenancy.md` line count | **AMBER** — queries exist + are uniform but not catalogued | Catalog produced + every line has a "scoped:Y/N" annotation | Read-only audit; no runtime change |

(Multi-tenancy criteria are ROADMAP-GREEN if M1-M3 pass. Active multi-tenant deploy = different acceptance gate, deferred.)

## Dimension 5 — Ops

| # | Criterion | Proof command | Current | Target | Rollback |
|---|---|---|---|---|---|
| O1 | Deploy is a script, not tribal knowledge | `cat scripts/deploy.sh` exists, idempotent, documented sequence: build → tar-pipe → npm install --omit=dev → prisma generate → prisma migrate deploy → pm2 reload | **RED** — sequence lives in this doc + my head; no script | Single `scripts/deploy.sh` runs end-to-end + dry-run mode | Delete the script |
| O2 | Rollback is documented and tested | `cat scripts/rollback.sh` + `docs/runbook.md` "Rollback" section | **RED** — none | `scripts/rollback.sh <commit-sha>` checkout + redeploy + smoke. Docs include "if migration X breaks, run prisma migrate resolve --rolled-back X" | Delete |
| O3 | Health endpoint surfaces app + queue + db state with **quantitative** thresholds | `curl /api/health/details \| jq '.queue.healthy && .db.reachable && .redis.reachable'` → true. `queue.healthy` defined as `waiting < 1000 && active < 50 && (lastCompletedAt is null OR (now - lastCompletedAt) < 5min)`; `db.reachable` = `SELECT 1` returns within 500ms; `redis.reachable` = `PING` returns within 200ms | **AMBER** — health endpoint authed but doesn't include queue/db checks beyond fingerprints | All three checks return real boolean state, thresholds documented inline | Revert `app.ts` health endpoint to fingerprint-only |
| O4 | Application errors surfaced (not just stdout) | Slack webhook fires on `app.error()` ≥ 500 OR uncaught exception. Test: `curl /api/__force-500-test` (gated to dev) → Slack channel `#radix-alerts` receives message within 30s | **RED** — pm2 stderr only, no alerting | Slack webhook configured via `SLACK_ALERT_WEBHOOK_URL` env. Sentry SDK is **YAGNI for one-agency-deploy** — defer until paid SaaS tier where multi-customer error attribution matters | Unset the env var; error handler hook degrades to log-only |
| O5 | Demo seed is idempotent (re-runnable without deduplication explosion) | `ssh radix_vps 'cd /opt/radix-v2/server && node dist/prisma/seed.js && node dist/prisma/seed.js'` runs twice → same row counts | **AMBER** — seed exists but `upsert` not used everywhere | All seeds use `prisma.X.upsert()` keyed on natural unique fields | Replace with `create` + manually delete dupes |
| O6 | nginx config is in version control | Both files committed under `docs/nginx/`. Compare via `diff -u <(grep -v '^\s*#\|^\s*$' docs/nginx/radix.conf) <(ssh radix_vps "grep -v '^\s*#\|^\s*\$' /etc/nginx/sites-enabled/radix")` returns empty (whitespace + comments stripped on both sides) | **RED** — nginx config edited directly on VPS, not in git | Commit current `/etc/nginx/sites-enabled/radix` + `/etc/nginx/conf.d/zz-radix-perf-security.conf` to `docs/nginx/`; deploy script step asserts the normalized diff is empty before declaring success | Delete the docs/nginx/ files |
| O7 | Log rotation: pm2 + nginx + postgres logs capped + retained ≤ 30 days | `ssh radix_vps "ls /root/.pm2/logs/ \| xargs -I{} stat -c '%y %s %n' /root/.pm2/logs/{}"` shows files rotated; `cat /etc/logrotate.d/nginx` shows rotation; `du -sh /root/.pm2/logs/` < 500 MB | **RED** — pm2-logrotate not installed, default unbounded | `pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 50M && pm2 set pm2-logrotate:retain 30 && pm2 set pm2-logrotate:compress true` + nginx logrotate.d entry verified | `pm2 uninstall pm2-logrotate` |
| O8 | GDPR / data-subject deletion path documented + executable | `docs/runbooks/data-subject-deletion.md` lists the cascade (User → RefreshToken / AuditLog / AgentSession / PostComment) and includes a script `scripts/delete-user.sh <userId>` that performs the cascade in a single transaction. Demo-deletes the seeded `demo-member@radix.local` end-to-end without orphans | **RED** — undocumented; `User` cascade chain has not been explicitly tested | Runbook doc + script + a once-off demo-deletion test that reseeds after | Delete the runbook + script. Cascade behavior is preserved by `onDelete: Cascade` in schema regardless |

---

## Tally — what actually blocks "deployable"

| Blocker rank | Item | Dimension | Fix effort |
|---|---|---|---|
| 🔴 P0 | JWT_SECRET 26 → 64 chars (forward-rotate only) | S1 | 5 min |
| 🔴 P0 | zod sweep all 19 `as any` + ESLint rule | S2 | ~2 parallel-session hours |
| 🔴 P0 | `.env` mode 600 + secrets-rotation runbook | S9 | 15 min |
| 🔴 P0 | `npm audit --audit-level=high` exit 0 | S10 | 5 min run + remediation if findings |
| 🔴 P0 | GitHub Actions CI on **ephemeral docker-compose** + scheduled prod-smoke workflow | R6 | 45 min |
| 🔴 P0 | Own-infra OWASP pentest pass (0 Critical/High) | S4 | 30-45 min security power stack |
| 🔴 P0 | Lighthouse on `/login` AND authed `/dashboard` | P1-P3, P7 | 15 min run + remediation if <80/<75 |
| 🔴 P0 | `scripts/deploy.sh` + `scripts/rollback.sh` runbook | O1, O2 | 30 min |
| 🔴 P0 | nginx config in git, normalized-diff verified | O6 | 15 min |
| 🔴 P0 | Log rotation (pm2-logrotate + nginx logrotate.d) | O7 | 10 min |
| 🔴 P0 | GDPR data-subject deletion runbook + script | O8 | 30 min |
| 🟡 P1 | Health details surfaces quantitative queue/db/redis state | O3 | 25 min |
| 🟡 P1 | Postgres daily backup cron + restore test | R5 | 20 min |
| 🟡 P1 | pm2 max_memory_restart cap | R4 | 1 line |
| 🟡 P1 | 6 new vitest tests for /v2 + /api/api-keys | S3 | 20 min |
| 🟡 P1 | Slack-webhook alerting on 5xx (Sentry deferred — YAGNI for one-agency) | O4 | 30 min |
| 🟢 P2 | Organization migration scoped under `docs/multi-tenancy/` (NEVER inside `prisma/migrations*`) | M2 | ~2 parallel-session hours (if 2nd agency on horizon) |
| 🟢 P2 | Idempotent seed via upsert | O5 | 15 min |
| 🟢 P2 | Multi-tenancy query catalog | M3 | 30 min |

**Definition of "fully deployable" = all P0 GREEN, all P1 at least AMBER → GREEN, all P2 documented (status row in this doc kept current).**

P0 effort total: ~5 parallel-session hours. P1 + P2 add ~2 hours. **Single arc, two waves.**

---

## Testing strategy summary

- **Static gate:** `cd server && npm run typecheck` + `cd apps/desktop && npm run typecheck` both 0 errors. CI enforces.
- **Contract gate:** vitest smoke at 24+ tests against live VPS. CI enforces.
- **Security gate:** own-infra pentest report stored at `docs/security/pentest-{YYYY-MM-DD}.md` with 0 Critical/High findings before declaring P0 done. Manual gate.
- **Perf gate:** Lighthouse run captured at `docs/perf/lighthouse-{YYYY-MM-DD}.json` with thresholds met. Ideally automated via lighthouse-ci on PR.
- **Regression gate:** typography swap (commit `4d5c95d`) — automated check that compiled CSS contains `Libre Bodoni` + `Public Sans` font-family declarations.

---

## Next step

`/write-plan` consumes this doc and produces a file:line execution plan ordered by P0 → P1 → P2, with parallel-batch boundaries marked.
