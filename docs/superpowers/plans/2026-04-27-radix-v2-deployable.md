# Radix V2 — Fully Deployable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take Radix V2 from "deployed-with-gaps" (HEAD `afd6c7f`, 18/18 smoke green) to all P0 acceptance criteria GREEN per `docs/deployment-acceptance.md`.

**Architecture:** Three parallel work-streams (zod sweep + JWT rotation + CI/devops) executed in one arc, then sequential verify → security pentest → deploy with runbook. Multi-tenancy migration is explicitly OUT OF SCOPE here (deferred per the design doc — `docs/multi-tenancy/proposed-migration.sql` will land as a separate plan when 2nd agency on horizon).

**Tech Stack:** Fastify 5 + Prisma 6 + PostgreSQL 16 + Redis + BullMQ. Vitest for tests. Zod 3 for runtime validation (matches existing `auth.ts` + `contentPieces.ts` pattern). GitHub Actions for CI. pm2-logrotate for log retention. Bash for deploy/rollback runbook scripts.

**Spec source:** `docs/deployment-acceptance.md` (committed `afd6c7f`).

---

## File Structure

| Path | Status | Responsibility |
|------|--------|----------------|
| `server/src/routes/briefs.ts` | modify | Add zod schemas + parseOr400 at PATCH |
| `server/src/routes/calendar.ts` | modify | Zod schemas at POST + PATCH, kill 3 `as any` |
| `server/src/routes/clients.ts` | modify | Zod at POST + PATCH, kill 2 `as any` |
| `server/src/routes/creative.ts` | modify | Zod at images/videos POST, kill 2 `as any` |
| `server/src/routes/exports.ts` | modify | Zod at trigger POST, kill 1 `as any` |
| `server/src/routes/review.ts` | modify | Zod at review-link POST, kill 1 `as any` |
| `server/src/lib/parseOr400.ts` | create | DRY helper extracted from `auth.ts` (currently inline) |
| `server/.eslintrc.cjs` | create | Lock zod boundary: ban `as any`/`@ts-ignore` in `src/routes/**` |
| `server/test/v2-and-api-keys.test.ts` | create | 6 NEW vitest contract tests (S3 acceptance) |
| `server/test/typography-regression.test.ts` | create | Computed-style gate (P6) |
| `.github/workflows/ci.yml` | create | PR + push: typecheck + lint + audit + vitest on ephemeral docker-compose |
| `.github/workflows/smoke-prod.yml` | create | Scheduled-only: 18 smoke tests against live VPS |
| `docker-compose.ci.yml` | create | Ephemeral postgres + redis + radix-api for CI |
| `scripts/deploy.sh` | create | Idempotent end-to-end deploy: build → tar → npm install → migrate → reload → smoke |
| `scripts/rollback.sh` | create | `<commit-sha>` arg → checkout + redeploy + smoke |
| `scripts/rotate-jwt.sh` | create | Generate 64-char JWT_SECRET + atomic .env swap + revoke RefreshTokens + reload |
| `docs/runbooks/secrets-rotation.md` | create | S9 rotation playbook |
| `docs/runbooks/data-subject-deletion.md` | create | O8 GDPR deletion playbook |
| `docs/nginx/radix.conf` | create | Snapshot of `/etc/nginx/sites-enabled/radix` |
| `docs/nginx/zz-radix-perf-security.conf` | create | Snapshot of perf+security overlay |
| `docs/security/pentest-2026-04-27.md` | create (Phase 6) | Output of /recon + /pentest + /webhack + /bypass + /hack |
| `docs/perf/lighthouse-2026-04-27.json` | create (Phase 5) | Captured Lighthouse run |

---

## Phase 1 — JWT-64 Rotation (P0, S1)

### Task 1: Forward-rotate JWT_SECRET to 64-char crypto-random

**Files:**
- Create: `scripts/rotate-jwt.sh`
- Create: `docs/runbooks/secrets-rotation.md`

- [ ] **Step 1: Write the rotation script**

```bash
# scripts/rotate-jwt.sh
#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SSH_KEY:-}" ]]; then SSH_KEY="$HOME/.ssh/radix_vps"; fi
HOST="root@srv1494206.hstgr.cloud"
ENV_PATH="/opt/radix-v2/server/.env"

NEW=$(openssl rand -base64 48 | tr -d '\n')
[[ ${#NEW} -ge 64 ]] || { echo "ERR: openssl produced < 64 chars"; exit 1; }

ssh -i "$SSH_KEY" "$HOST" "
  set -euo pipefail
  cp '$ENV_PATH' '${ENV_PATH}.bak.\$(date +%s)'
  sed -i.tmp 's|^JWT_SECRET=.*|JWT_SECRET=$NEW|' '$ENV_PATH'
  awk -F= '/^JWT_SECRET=/{print length(\$2)}' '$ENV_PATH' | grep -qE '^(6[4-9]|[7-9][0-9]|[1-9][0-9][0-9])$'
  PGPASSWORD=\$(awk -F= '/^DB_PASSWORD=/{print \$2}' '$ENV_PATH') psql -h 127.0.0.1 -U radix -d radix_planner -c 'UPDATE \"RefreshToken\" SET \"revokedAt\" = NOW() WHERE \"revokedAt\" IS NULL'
  pm2 reload radix-api --update-env
  rm -f '${ENV_PATH}.tmp'
"
echo "JWT rotated. All RefreshTokens revoked. Users must re-login."
```

- [ ] **Step 2: Make executable + dry-run gate**

Run:
```bash
chmod +x scripts/rotate-jwt.sh
ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud "awk -F= '/^JWT_SECRET=/{print length(\$2)}' /opt/radix-v2/server/.env"
```
Expected: prints `26` (current pre-rotation length).

- [ ] **Step 3: Execute rotation**

Run: `./scripts/rotate-jwt.sh`
Expected: prints `JWT rotated. All RefreshTokens revoked.` + the post-length echo confirms ≥ 64.

- [ ] **Step 4: Verify by ssh recheck**

Run:
```bash
ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud "awk -F= '/^JWT_SECRET=/{print length(\$2)}' /opt/radix-v2/server/.env"
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" -d '{"email":"demo-admin@radix.local","password":"demoAdmin2026!"}' https://srv1494206.hstgr.cloud/api/auth/login
```
Expected: ≥ 64 + HTTP 200 (login still works with new secret).

- [ ] **Step 5: Write the runbook + commit**

```markdown
# Secrets Rotation

## JWT_SECRET (Authorization signing key)

**When:** annually, or immediately on any suspected compromise.
**Effect:** all active sessions invalidated; users must re-login.

**Procedure:** `./scripts/rotate-jwt.sh` (idempotent, atomic, forward-only).

**Never:** restore a prior JWT_SECRET. Forward-rotate to a third secret on failure.

## DB_PASSWORD, GEMINI_API_KEY, XAI_API_KEY, MOONSHOT_API_KEY

Rotate via Hostinger / Google Cloud Console / xAI dashboard. Update `/opt/radix-v2/server/.env` then `pm2 reload radix-api --update-env`. Test with `curl /api/health` afterward.
```

```bash
git add scripts/rotate-jwt.sh docs/runbooks/secrets-rotation.md
git commit -m "feat(radix-v2): JWT_SECRET 64-char rotation script + secrets runbook (S1, S9)"
```

---

## Phase 2 — Zod Sweep (P0, S2) — Parallel-Batch

These 6 tasks share the same shape and can run in parallel subagents. Common: extract the parseOr400 helper first, then per-route schema work.

### Task 2: Extract `parseOr400` helper

**Files:**
- Create: `server/src/lib/parseOr400.ts`
- Modify: `server/src/routes/auth.ts` (use the helper instead of inlined)

- [ ] **Step 1: Write the helper**

```typescript
// server/src/lib/parseOr400.ts
import type { FastifyReply } from 'fastify';
import type { ZodSchema } from 'zod';

export function parseOr400<T>(schema: ZodSchema<T>, body: unknown, reply: FastifyReply): T | undefined {
  const result = schema.safeParse(body);
  if (!result.success) {
    reply.status(400).send({ error: 'Invalid body', details: result.error.flatten() });
    return undefined;
  }
  return result.data;
}
```

- [ ] **Step 2: Refactor `auth.ts` to use helper**

Find the inlined parseOr400 in `server/src/routes/auth.ts` (around the LoginBody / RefreshBody section) and replace with `import { parseOr400 } from '../lib/parseOr400.js';`. Keep all schemas in place.

- [ ] **Step 3: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Smoke**

Run: `cd server && SMOKE_BASE_URL=https://srv1494206.hstgr.cloud npx vitest run`
Expected: 18/18 pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/parseOr400.ts server/src/routes/auth.ts
git commit -m "refactor(radix-v2): extract parseOr400 helper from auth.ts (S2 prep)"
```

### Task 3: Zod sweep — `briefs.ts`

**Files:**
- Modify: `server/src/routes/briefs.ts`

- [ ] **Step 1: Read current handler signatures + identify `as any`**

Run: `grep -nE 'as any|request\.body' server/src/routes/briefs.ts`
Identify each PATCH/POST handler that casts `request.body as any`.

- [ ] **Step 2: Write zod schemas for the body shapes**

```typescript
// near top of briefs.ts, after imports
import { z } from 'zod';
import { parseOr400 } from '../lib/parseOr400.js';

const UpdateBriefBody = z.object({
  objective: z.string().min(1).max(2000).optional(),
  audience: z.string().min(1).max(2000).optional(),
  tone: z.string().min(1).max(500).optional(),
  brandDo: z.string().max(5000).optional(),
  brandDont: z.string().max(5000).optional(),
  products: z.any().optional(),       // existing Json columns — schema-light by design
  pillars: z.any().optional(),
  campaignMoments: z.any().optional(),
  channels: z.any().optional(),
  approvers: z.any().optional(),
  cadence: z.string().max(500).optional(),
  references: z.string().max(5000).optional(),
  competitors: z.string().max(5000).optional(),
  successDefinition: z.string().max(5000).optional(),
  pastLearnings: z.string().max(5000).optional(),
  seasonalNotes: z.string().max(5000).optional(),
  mandatoryInclusions: z.string().max(5000).optional(),
  complianceNotes: z.string().max(5000).optional(),
});
```

- [ ] **Step 3: Replace each `as any` cast with parseOr400**

In each PATCH handler:
```typescript
// BEFORE
const body = request.body as any;
// AFTER
const body = parseOr400(UpdateBriefBody, request.body, reply);
if (!body) return;
```

- [ ] **Step 4: Verify zero `as any` left in this file**

Run: `grep -cE "as any|as unknown as|<any>|@ts-ignore" server/src/routes/briefs.ts`
Expected: `0`.

- [ ] **Step 5: Typecheck + smoke + commit**

Run: `cd server && npx tsc --noEmit && SMOKE_BASE_URL=https://srv1494206.hstgr.cloud npx vitest run`
Expected: 0 type errors + 18/18 smoke pass.

```bash
git add server/src/routes/briefs.ts
git commit -m "feat(radix-v2): zod sweep briefs.ts (S2 1/6)"
```

### Task 4: Zod sweep — `calendar.ts`

**Files:**
- Modify: `server/src/routes/calendar.ts`

- [ ] **Step 1: Identify the 3 `as any` casts**

Run: `grep -nE 'as any' server/src/routes/calendar.ts`
Expected: 3 hits across POST + PATCH + maybe a generate handler.

- [ ] **Step 2: Add schemas**

```typescript
import { z } from 'zod';
import { parseOr400 } from '../lib/parseOr400.js';

const PostCore = {
  date: z.string().min(1).max(60),
  title: z.string().min(1).max(300),
  pillar: z.string().min(1).max(120),
  platform: z.string().min(1).max(60),
  format: z.string().min(1).max(120),
  hook: z.string().max(500).nullable().optional(),
  keyMessage: z.string().max(2000).nullable().optional(),
  caption: z.string().min(1).max(8000),
  cta: z.string().max(500).nullable().optional(),
  hashtags: z.array(z.string()).optional(),
  visualDirection: z.string().max(2000).nullable().optional(),
  referenceQuery: z.string().max(500).nullable().optional(),
  rationale: z.string().max(2000).nullable().optional(),
  timing: z.string().max(120).nullable().optional(),
  status: z.string().max(60).optional(),
};

const CreatePostBody = z.object(PostCore);
const UpdatePostBody = z.object({
  ...Object.fromEntries(Object.entries(PostCore).map(([k, v]) => [k, (v as any).optional ? v : v])),
  caption: z.string().min(1).max(8000).optional(),
  date: z.string().min(1).max(60).optional(),
  title: z.string().min(1).max(300).optional(),
});

const GenerateMonthBody = z.object({
  month: z.string().min(1).max(60),
  isTest: z.boolean().optional(),
  forceRegenerate: z.boolean().optional(),
});
```

- [ ] **Step 3: Replace all 3 `as any` casts with parseOr400**

For each handler, identical pattern: `const body = parseOr400(<Schema>, request.body, reply); if (!body) return;`.

- [ ] **Step 4: Verify zero `as any`**

Run: `grep -cE "as any|as unknown as|<any>|@ts-ignore" server/src/routes/calendar.ts`
Expected: `0`.

- [ ] **Step 5: Typecheck + smoke + commit**

```bash
cd server && npx tsc --noEmit && SMOKE_BASE_URL=https://srv1494206.hstgr.cloud npx vitest run
git add server/src/routes/calendar.ts
git commit -m "feat(radix-v2): zod sweep calendar.ts (S2 2/6)"
```

### Task 5: Zod sweep — `clients.ts`

**Files:**
- Modify: `server/src/routes/clients.ts`

- [ ] **Step 1: Identify the 2 `as any` casts**

Run: `grep -nE 'as any' server/src/routes/clients.ts`

- [ ] **Step 2: Add schemas**

```typescript
import { z } from 'zod';
import { parseOr400 } from '../lib/parseOr400.js';

const CreateClientBody = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric + hyphens'),
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  timezone: z.string().max(60).nullable().optional(),
  industry: z.string().max(200).nullable().optional(),
  website: z.string().url().nullable().optional(),
  instagramHandle: z.string().max(60).nullable().optional(),
});
const UpdateClientBody = CreateClientBody.partial();
```

- [ ] **Step 3: Replace `as any` casts**

- [ ] **Step 4: Verify zero `as any`**

Run: `grep -cE "as any|as unknown as|<any>|@ts-ignore" server/src/routes/clients.ts`
Expected: `0`.

- [ ] **Step 5: Typecheck + smoke + commit**

```bash
cd server && npx tsc --noEmit && SMOKE_BASE_URL=https://srv1494206.hstgr.cloud npx vitest run
git add server/src/routes/clients.ts
git commit -m "feat(radix-v2): zod sweep clients.ts (S2 3/6)"
```

### Task 6: Zod sweep — `creative.ts`

**Files:**
- Modify: `server/src/routes/creative.ts`

- [ ] **Step 1: Identify the 2 `as any` casts** — image generate + video generate

- [ ] **Step 2: Add schemas**

```typescript
import { z } from 'zod';
import { parseOr400 } from '../lib/parseOr400.js';

const GenerateImageBody = z.object({
  prompt: z.string().min(1).max(4000),
  aspectRatio: z.enum(['1:1', '4:5', '9:16', '16:9', '3:4']).optional(),
  clientId: z.string().min(1).max(64).optional(),
  improvePrompt: z.boolean().optional(),
  ultra: z.boolean().optional(),
});
const EditImageBody = z.object({
  prompt: z.string().min(1).max(4000),
  imageBase64: z.string().min(64),
  mimeType: z.string().regex(/^image\/(png|jpeg|webp)$/).optional(),
  aspectRatio: z.enum(['1:1', '4:5', '9:16', '16:9', '3:4']).optional(),
  clientId: z.string().min(1).max(64).optional(),
});
const GenerateVideoBody = z.object({
  prompt: z.string().min(1).max(4000),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']).optional(),
  durationSeconds: z.number().int().min(2).max(30).optional(),
  resolution: z.enum(['720p', '1080p']).optional(),
  clientId: z.string().min(1).max(64).optional(),
  imageBase64: z.string().min(64).optional(),
  mimeType: z.string().regex(/^image\/(png|jpeg|webp)$/).optional(),
});
const ImprovePromptBody = z.object({
  prompt: z.string().min(1).max(4000),
  mode: z.string().max(60).optional(),
});
```

- [ ] **Step 3: Replace `as any` casts in each handler**

- [ ] **Step 4: Verify zero `as any`**

Run: `grep -cE "as any|as unknown as|<any>|@ts-ignore" server/src/routes/creative.ts`
Expected: `0`.

- [ ] **Step 5: Typecheck + smoke + commit**

```bash
cd server && npx tsc --noEmit && SMOKE_BASE_URL=https://srv1494206.hstgr.cloud npx vitest run
git add server/src/routes/creative.ts
git commit -m "feat(radix-v2): zod sweep creative.ts (S2 4/6)"
```

### Task 7: Zod sweep — `exports.ts`

**Files:**
- Modify: `server/src/routes/exports.ts`

- [ ] **Step 1: Identify the 1 `as any` cast** — POST trigger

- [ ] **Step 2: Add schemas**

```typescript
import { z } from 'zod';
import { parseOr400 } from '../lib/parseOr400.js';

const ExportTriggerBody = z.object({
  type: z.enum(['pptx']).default('pptx'),
});
```

- [ ] **Step 3: Replace `as any`**

- [ ] **Step 4: Verify**

Run: `grep -cE "as any|as unknown as|<any>|@ts-ignore" server/src/routes/exports.ts`
Expected: `0`.

- [ ] **Step 5: Typecheck + smoke + commit**

```bash
cd server && npx tsc --noEmit && SMOKE_BASE_URL=https://srv1494206.hstgr.cloud npx vitest run
git add server/src/routes/exports.ts
git commit -m "feat(radix-v2): zod sweep exports.ts (S2 5/6)"
```

### Task 8: Zod sweep — `review.ts`

**Files:**
- Modify: `server/src/routes/review.ts`

- [ ] **Step 1: Identify the 1 `as any` cast** — POST review-link

- [ ] **Step 2: Add schemas**

```typescript
import { z } from 'zod';
import { parseOr400 } from '../lib/parseOr400.js';

const CreateReviewLinkBody = z.object({
  expiresInDays: z.number().int().min(1).max(90).default(30),
});
```

- [ ] **Step 3: Replace `as any`**

- [ ] **Step 4: Verify**

Run: `grep -cE "as any|as unknown as|<any>|@ts-ignore" server/src/routes/review.ts`
Expected: `0`.

- [ ] **Step 5: Typecheck + smoke + commit**

```bash
cd server && npx tsc --noEmit && SMOKE_BASE_URL=https://srv1494206.hstgr.cloud npx vitest run
git add server/src/routes/review.ts
git commit -m "feat(radix-v2): zod sweep review.ts (S2 6/6)"
```

### Task 9: ESLint rule — ban `any` at route boundary

**Files:**
- Create: `server/.eslintrc.cjs`
- Modify: `server/package.json` (add devDeps + lint script)

- [ ] **Step 1: Install ESLint stack**

Run:
```bash
cd server && npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

- [ ] **Step 2: Write `.eslintrc.cjs`**

```javascript
// server/.eslintrc.cjs
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
  },
  overrides: [
    {
      files: ['src/routes/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': ['error', { ignoreRestArgs: false }],
        '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': true, 'ts-nocheck': true }],
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', 'prisma/migrations/'],
};
```

- [ ] **Step 3: Add lint script to `package.json`**

```json
"scripts": {
  "lint": "eslint src/routes/**/*.ts",
  ...existing scripts
}
```

- [ ] **Step 4: Run lint, expect zero errors after sweep**

Run: `cd server && npm run lint`
Expected: 0 errors. (If errors, missed an `as any` somewhere — fix and re-run.)

- [ ] **Step 5: Commit**

```bash
git add server/.eslintrc.cjs server/package.json server/package-lock.json
git commit -m "chore(radix-v2): ESLint rule banning any/ts-ignore at src/routes (S2)"
```

---

## Phase 3 — `npm audit` Gate (P0, S10)

### Task 10: Run + remediate `npm audit --audit-level=high`

**Files:**
- Modify: `server/package.json` + `server/package-lock.json` (only if remediation required)
- Modify: `apps/desktop/package.json` + `apps/desktop/package-lock.json` (only if remediation required)

- [ ] **Step 1: Run audit on both**

Run:
```bash
cd server && npm audit --production --audit-level=high
cd ../apps/desktop && npm audit --production --audit-level=high
```
Expected: exit 0 if clean. Note any HIGH/CRITICAL findings.

- [ ] **Step 2: If findings, run `npm audit fix --force` selectively**

For each HIGH finding: check the changelog of the proposed upgrade, apply, retest.

- [ ] **Step 3: Re-run audit**

Run: same commands as Step 1. Expected: exit 0.

- [ ] **Step 4: Run smoke to confirm no breakage**

Run: `cd server && SMOKE_BASE_URL=https://srv1494206.hstgr.cloud npx vitest run`
Expected: 18/18.

- [ ] **Step 5: Commit (only if package files changed)**

```bash
git add server/package*.json apps/desktop/package*.json
git commit -m "chore(radix-v2): npm audit pass — 0 high/critical findings (S10)"
```

---

## Phase 4 — CI Workflow (P0, R6)

### Task 11: Ephemeral docker-compose for CI

**Files:**
- Create: `docker-compose.ci.yml`

- [ ] **Step 1: Write docker-compose**

```yaml
# docker-compose.ci.yml — ephemeral stack for PR-level CI smoke tests.
# NOT for production. Fresh DB per CI run.
version: '3.9'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: radix
      POSTGRES_PASSWORD: ci_only_not_secret
      POSTGRES_DB: radix_planner
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U radix -d radix_planner"]
      interval: 2s
      timeout: 2s
      retries: 30
  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 2s
      retries: 30
  radix-api:
    build:
      context: .
      dockerfile: Dockerfile.ci
    environment:
      DATABASE_URL: "postgres://radix:ci_only_not_secret@postgres:5432/radix_planner"
      REDIS_URL: "redis://redis:6379"
      JWT_SECRET: "ci_only_64char_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      NODE_ENV: production
      PORT: "8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "8080:8080"
```

- [ ] **Step 2: Write `Dockerfile.ci`**

```dockerfile
# Dockerfile.ci — minimal multi-stage for CI smoke
FROM node:22-alpine AS deps
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

FROM node:22-alpine AS build
WORKDIR /app
COPY server/ ./server/
COPY --from=deps /app/server/node_modules ./server/node_modules
RUN cd server && npx prisma generate && npm run build

FROM node:22-alpine
WORKDIR /app/server
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/prisma ./prisma
COPY --from=build /app/server/package.json ./
EXPOSE 8080
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
```

- [ ] **Step 3: Verify locally**

Run: `docker compose -f docker-compose.ci.yml up --build -d && sleep 25 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/api/health`
Expected: HTTP 200.

Cleanup: `docker compose -f docker-compose.ci.yml down -v`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.ci.yml Dockerfile.ci
git commit -m "feat(radix-v2): ephemeral docker-compose stack for CI smoke (R6)"
```

### Task 12: GitHub Actions PR-level CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  static:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm', cache-dependency-path: 'server/package-lock.json' }
      - name: Install server deps
        run: cd server && npm ci
      - name: Server typecheck
        run: cd server && npm run typecheck
      - name: Server lint
        run: cd server && npm run lint
      - name: Server audit
        run: cd server && npm audit --production --audit-level=high
      - name: Frontend deps
        run: cd apps/desktop && npm ci
      - name: Frontend typecheck
        run: cd apps/desktop && npm run typecheck

  smoke:
    runs-on: ubuntu-latest
    needs: static
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm', cache-dependency-path: 'server/package-lock.json' }
      - name: Spin up ephemeral stack
        run: docker compose -f docker-compose.ci.yml up --build -d
      - name: Wait for radix-api ready
        run: |
          for i in $(seq 1 30); do
            if curl -fs http://localhost:8080/api/health; then exit 0; fi
            sleep 2
          done
          echo "radix-api never became healthy"; exit 1
      - name: Install + run smoke
        run: cd server && npm ci && SMOKE_BASE_URL=http://localhost:8080 npx vitest run
      - name: Tear down
        if: always()
        run: docker compose -f docker-compose.ci.yml down -v
```

- [ ] **Step 2: Push branch + open draft PR to verify workflow runs**

Run:
```bash
git add .github/workflows/ci.yml
git commit -m "feat(radix-v2): GitHub Actions PR-level CI on ephemeral stack (R6)"
git push origin million-dollar-hardening
gh pr create --draft --title "ci: ephemeral CI smoke" --body "Verify the workflow runs."
```

Wait for first run; expect green.

- [ ] **Step 3: If red, fix and force-push the branch**

Common failure: missing dependency in `package.json`, wrong Node version, healthcheck timing. Iterate until green.

### Task 13: Scheduled prod-smoke workflow

**Files:**
- Create: `.github/workflows/smoke-prod.yml`

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/smoke-prod.yml
name: Smoke (prod)
on:
  schedule:
    - cron: '17 */4 * * *'  # every 4 hours
  workflow_dispatch:

jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm', cache-dependency-path: 'server/package-lock.json' }
      - name: Install
        run: cd server && npm ci
      - name: Smoke against live VPS
        run: cd server && SMOKE_BASE_URL=https://srv1494206.hstgr.cloud npx vitest run
```

- [ ] **Step 2: Commit + verify run via workflow_dispatch**

```bash
git add .github/workflows/smoke-prod.yml
git commit -m "feat(radix-v2): scheduled prod-smoke workflow every 4h (R6)"
git push
gh workflow run smoke-prod.yml
```

Expected: green.

---

## Phase 5 — Verify Gates (P0, S3 + P6 + P1-P3,P7)

### Task 14: 6 NEW vitest contract tests for /v2 + /api/api-keys

**Files:**
- Create: `server/test/v2-and-api-keys.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// server/test/v2-and-api-keys.test.ts
import { describe, it, expect } from 'vitest';

const BASE = process.env.SMOKE_BASE_URL ?? 'https://srv1494206.hstgr.cloud';

describe('contract: /v2 Bearer surface', () => {
  it('GET /v2/client without auth → 401', async () => {
    const r = await fetch(`${BASE}/v2/client`);
    expect(r.status).toBe(401);
  });

  it('GET /v2/client with junk Bearer → 401 + envelope shape', async () => {
    const r = await fetch(`${BASE}/v2/client`, { headers: { Authorization: 'Bearer sk-radix-deadbeefdeadbeefdeadbeefdeadbeef' } });
    expect(r.status).toBe(401);
    const body = await r.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe('string');
  });

  it('GET /v2/calendars with junk Bearer → 401', async () => {
    const r = await fetch(`${BASE}/v2/calendars`, { headers: { Authorization: 'Bearer sk-radix-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } });
    expect(r.status).toBe(401);
  });
});

describe('contract: /api/api-keys CRUD (JWT-authed)', () => {
  it('GET /api/api-keys without JWT → 401', async () => {
    const r = await fetch(`${BASE}/api/api-keys?clientId=any`);
    expect(r.status).toBe(401);
  });

  it('POST /api/api-keys without JWT → 401', async () => {
    const r = await fetch(`${BASE}/api/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'x', name: 'test' }),
    });
    expect(r.status).toBe(401);
  });

  it('POST /api/api-keys/zzz/revoke without JWT → 401', async () => {
    const r = await fetch(`${BASE}/api/api-keys/zzz/revoke`, { method: 'POST' });
    expect(r.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run, expect 6 PASS (these are tests of unauth contracts that already work)**

Run: `cd server && SMOKE_BASE_URL=https://srv1494206.hstgr.cloud npx vitest run test/v2-and-api-keys.test.ts`
Expected: 6 passed.

- [ ] **Step 3: Run full smoke**

Run: `cd server && SMOKE_BASE_URL=https://srv1494206.hstgr.cloud npx vitest run`
Expected: 24/24 pass (18 existing + 6 new).

- [ ] **Step 4: Commit**

```bash
git add server/test/v2-and-api-keys.test.ts
git commit -m "test(radix-v2): 6 contract tests for /v2 + /api/api-keys 401 paths (S3)"
```

### Task 15: Typography regression test (P6)

**Files:**
- Create: `server/test/typography-regression.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// server/test/typography-regression.test.ts
import { describe, it, expect } from 'vitest';

const BASE = process.env.SMOKE_BASE_URL ?? 'https://srv1494206.hstgr.cloud';

describe('regression: typography swap', () => {
  it('shipped CSS contains Libre Bodoni + Public Sans declarations', async () => {
    const html = await (await fetch(BASE)).text();
    const cssMatch = html.match(/index-[A-Za-z0-9_-]+\.css/);
    expect(cssMatch).toBeTruthy();
    const css = await (await fetch(`${BASE}/assets/${cssMatch![0]}`)).text();
    expect(css).toContain('Libre Bodoni');
    expect(css).toContain('Public Sans');
    expect(css).toMatch(/--font-sans:.*Public Sans/);
    expect(css).toMatch(/--font-display:.*Libre Bodoni/);
  });

  it('Google Fonts import loads with display=swap', async () => {
    const html = await (await fetch(BASE)).text();
    const cssMatch = html.match(/index-[A-Za-z0-9_-]+\.css/);
    const css = await (await fetch(`${BASE}/assets/${cssMatch![0]}`)).text();
    expect(css).toMatch(/fonts\.googleapis\.com.*display=swap/);
  });
});
```

- [ ] **Step 2: Run + verify pass**

Run: `cd server && SMOKE_BASE_URL=https://srv1494206.hstgr.cloud npx vitest run test/typography-regression.test.ts`
Expected: 2/2.

- [ ] **Step 3: Commit**

```bash
git add server/test/typography-regression.test.ts
git commit -m "test(radix-v2): regression gate for Libre Bodoni + Public Sans typography (P6)"
```

### Task 16: Lighthouse measurement on `/login` AND authed `/dashboard`

**Files:**
- Create: `docs/perf/lighthouse-2026-04-27.json`
- Create: `scripts/lighthouse.sh`

- [ ] **Step 1: Install lighthouse globally if not present**

Run: `npm install -g lighthouse`. Expected: lighthouse on PATH (`lighthouse --version`).

- [ ] **Step 2: Write the runner script**

```bash
# scripts/lighthouse.sh
#!/usr/bin/env bash
set -euo pipefail
mkdir -p docs/perf
DATE=$(date +%F)
URL="${1:-https://srv1494206.hstgr.cloud/}"
lighthouse "$URL" \
  --quiet \
  --chrome-flags="--headless --no-sandbox" \
  --only-categories=performance,accessibility,best-practices \
  --output=json \
  --output-path="docs/perf/lighthouse-${DATE}.json"
node -e "
const r = require('./docs/perf/lighthouse-${DATE}.json');
const cats = r.categories;
console.log('perf:', Math.round(cats.performance.score*100));
console.log('a11y:', Math.round(cats.accessibility.score*100));
console.log('bp:  ', Math.round(cats['best-practices'].score*100));
"
```

- [ ] **Step 3: Run on `/login`**

Run: `chmod +x scripts/lighthouse.sh && ./scripts/lighthouse.sh https://srv1494206.hstgr.cloud/`
Expected: perf ≥ 80, a11y ≥ 90, bp ≥ 95. If any miss target, log finding in `docs/perf/findings-2026-04-27.md` and remediate (typical: image lazy-load, route-level code-split for ui-charts bundle which is currently 377KB).

- [ ] **Step 4: Add stored-auth lighthouse run on `/dashboard`** (P7)

Note: lighthouse can't authenticate via JWT directly; for P7, run via Chrome DevTools after manually logging in OR via lighthouse-ci with `puppeteerScript`. For this iteration, document the procedure in `docs/perf/findings-2026-04-27.md` and capture authed-route Performance + A11y by manual lighthouse-in-devtools.

- [ ] **Step 5: Commit**

```bash
git add scripts/lighthouse.sh docs/perf/
git commit -m "perf(radix-v2): Lighthouse measurement script + baseline capture (P1-P3, P7)"
```

---

## Phase 6 — Security Power Stack (P0, S4)

### Task 17: Run own-infra OWASP pentest (skill-driven, no file edits per step)

**Files:**
- Create: `docs/security/pentest-2026-04-27.md`

This task is the security power stack run. It's a skill-driven dispatch; capture findings to the doc.

- [ ] **Step 1: /recon**

Run skill: `/recon srv1494206.hstgr.cloud full-passive`
Capture: subdomain enum, certs, exposed directories, leaked dev surface, admin panels.

- [ ] **Step 2: /pentest**

Run skill: `/pentest https://srv1494206.hstgr.cloud OWASP-top-10`
Capture: per-OWASP-category findings (Injection, Broken Auth, Sensitive Data Exposure, XXE, Broken Access Control, Security Misconfig, XSS, Insecure Deserialization, Known Vulns, Insufficient Logging).

- [ ] **Step 3: /webhack**

Run skill: `/webhack https://srv1494206.hstgr.cloud full-attack-chain --auth demo-admin@radix.local:demoAdmin2026!`
Capture: auth bypass attempts, IDOR on /api/clients/:id, path-traversal on /api/assets/:id/download, JWT manipulation, /v2 envelope leakage.

- [ ] **Step 4: /bypass**

Run skill: `/bypass https://srv1494206.hstgr.cloud rate-limit --csp --jwt`
Confirm: rate-limiter cannot be bypassed via header injection; helmet CSP cannot be loosened via reflected `<script>`; JWT cannot be forged with weak/none alg.

- [ ] **Step 5: /hack**

Run skill: `/hack https://srv1494206.hstgr.cloud full-vuln-scan`
Capture: any tooling output (nuclei, nikto-equivalent).

- [ ] **Step 6: Write the report**

```markdown
# Pentest Report — Radix V2 — 2026-04-27

**Target:** https://srv1494206.hstgr.cloud (production single-tenant deployment)
**HEAD at test:** afd6c7f (+ Phase 1-5 commits from this plan)
**Scope:** full read-only OWASP Top-10 + own-app surface. No DoS, no destructive payloads.

## Summary
- Critical: N
- High: N
- Medium: N
- Low: N
- Info: N

## Findings
### CRITICAL
(none / list)

### HIGH
(none / list)

### MEDIUM
(...)

### LOW
(...)

### INFO
(...)

## Acceptance gate
- [ ] 0 Critical
- [ ] 0 High
```

- [ ] **Step 7: If Critical or High found → fix → re-run from Step 1**

Loop until gate passes.

- [ ] **Step 8: Commit**

```bash
git add docs/security/pentest-2026-04-27.md
git commit -m "security(radix-v2): own-infra OWASP pentest report — 0 Critical / 0 High (S4)"
```

---

## Phase 7 — Deploy + Rollback Runbook (P0, O1, O2, O6, O7)

### Task 18: `scripts/deploy.sh` end-to-end runbook

**Files:**
- Create: `scripts/deploy.sh`

- [ ] **Step 1: Write the script**

```bash
# scripts/deploy.sh
#!/usr/bin/env bash
# End-to-end deploy: build → tar-pipe → npm install --omit=dev → prisma generate → prisma migrate deploy → pm2 reload → smoke
# Idempotent. Supports --dry-run to print commands without executing.
set -euo pipefail

DRY_RUN="${DRY_RUN:-}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/radix_vps}"
HOST="${HOST:-root@srv1494206.hstgr.cloud}"
ROOT="${ROOT:-/opt/radix-v2}"

run() {
  echo "+ $*"
  if [[ -z "$DRY_RUN" ]]; then "$@"; fi
}
ssh_run() {
  echo "+ ssh $HOST -- $*"
  if [[ -z "$DRY_RUN" ]]; then ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$HOST" "$*"; fi
}

echo "▶ Build frontend"
run bash -c "cd apps/desktop && npm run build"

echo "▶ Build server"
run bash -c "cd server && npm run build"

echo "▶ Tar-pipe frontend"
run bash -c "cd apps/desktop && tar -czf - -C dist . | ssh -i '$SSH_KEY' '$HOST' \"cd $ROOT/frontend && rm -rf dist.tmp && mkdir dist.tmp && cd dist.tmp && tar -xzf - && cd .. && rm -rf dist && mv dist.tmp dist\""

echo "▶ Tar-pipe server"
run bash -c "cd server && tar --exclude='node_modules' --exclude='dist/test*' -czf - dist package.json package-lock.json prisma/schema.prisma prisma/migrations | ssh -i '$SSH_KEY' '$HOST' \"cd $ROOT/server && tar -xzf -\""

echo "▶ npm install"
ssh_run "cd $ROOT/server && npm install --omit=dev --silent"

echo "▶ Prisma generate"
ssh_run "cd $ROOT/server && npx prisma generate"

echo "▶ Prisma migrate deploy"
ssh_run "cd $ROOT/server && npx prisma migrate deploy"

echo "▶ pm2 reload"
ssh_run "pm2 reload radix-api --update-env"

echo "▶ Smoke"
sleep 3
if [[ -z "$DRY_RUN" ]]; then
  cd server && SMOKE_BASE_URL=https://srv1494206.hstgr.cloud npx vitest run | tee /tmp/radix-smoke-output.txt
  grep -E "Tests\s+(\d+) passed" /tmp/radix-smoke-output.txt | grep -qv "0 passed" || { echo "✗ smoke failed"; exit 1; }
fi

echo "✓ Deploy complete"
```

- [ ] **Step 2: Make executable + dry-run**

Run: `chmod +x scripts/deploy.sh && DRY_RUN=1 ./scripts/deploy.sh`
Expected: prints all commands without executing. Verify each.

- [ ] **Step 3: Run for real (no dry-run)**

Run: `./scripts/deploy.sh`
Expected: all steps green, smoke 24+/24+ pass at the end.

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy.sh
git commit -m "feat(radix-v2): scripts/deploy.sh end-to-end idempotent runbook (O1)"
```

### Task 19: `scripts/rollback.sh` revert-to-sha runbook

**Files:**
- Create: `scripts/rollback.sh`

- [ ] **Step 1: Write the script**

```bash
# scripts/rollback.sh
#!/usr/bin/env bash
# Roll back to a known-good commit and redeploy.
# Usage: ./scripts/rollback.sh <git-sha>
set -euo pipefail

SHA="${1:?usage: rollback.sh <git-sha>}"
git rev-parse --verify "$SHA" >/dev/null

CURRENT=$(git rev-parse HEAD)
echo "Rolling back from $CURRENT to $SHA"
git checkout "$SHA"
trap "git checkout $CURRENT" EXIT

./scripts/deploy.sh

echo "▶ Final smoke against rolled-back HEAD"
cd server && SMOKE_BASE_URL=https://srv1494206.hstgr.cloud npx vitest run

echo "✓ Rollback complete. Run 'git checkout $CURRENT' to return your local repo to its prior state."
trap - EXIT
```

- [ ] **Step 2: Make executable + dry-run**

Run: `chmod +x scripts/rollback.sh`
Test: `git rev-parse HEAD~1 | xargs ./scripts/rollback.sh` (and immediately roll forward to HEAD again afterward; this is just to verify the script doesn't break things).

Note: don't actually rollback prod for this verification — just confirm the script's syntax is valid via `bash -n scripts/rollback.sh`.

- [ ] **Step 3: Commit**

```bash
git add scripts/rollback.sh
git commit -m "feat(radix-v2): scripts/rollback.sh git-sha-driven revert + redeploy (O2)"
```

### Task 20: Snapshot nginx config into git

**Files:**
- Create: `docs/nginx/radix.conf`
- Create: `docs/nginx/zz-radix-perf-security.conf`

- [ ] **Step 1: Pull current configs**

Run:
```bash
ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud 'cat /etc/nginx/sites-enabled/radix' > docs/nginx/radix.conf
ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud 'cat /etc/nginx/conf.d/zz-radix-perf-security.conf' > docs/nginx/zz-radix-perf-security.conf
```

- [ ] **Step 2: Verify normalized diff is empty (proof for O6)**

Run:
```bash
diff -u <(grep -v '^\s*#\|^\s*$' docs/nginx/radix.conf) <(ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud "grep -v '^\s*#\|^\s*\$' /etc/nginx/sites-enabled/radix")
```
Expected: empty (no diff).

- [ ] **Step 3: Commit**

```bash
git add docs/nginx/
git commit -m "ops(radix-v2): nginx config snapshots in git + normalized-diff proof (O6)"
```

### Task 21: pm2-logrotate + 30-day retention

**Files:** (no repo changes — VPS-side install + pm2 settings persist via `pm2 save`)

- [ ] **Step 1: Install pm2-logrotate on VPS**

Run:
```bash
ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud '
  pm2 install pm2-logrotate
  pm2 set pm2-logrotate:max_size 50M
  pm2 set pm2-logrotate:retain 30
  pm2 set pm2-logrotate:compress true
  pm2 set pm2-logrotate:rotateInterval "0 0 * * *"
  pm2 save
'
```

- [ ] **Step 2: Verify**

Run: `ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud 'pm2 conf pm2-logrotate'`
Expected: shows max_size=50M retain=30 compress=true.

- [ ] **Step 3: Document in deploy runbook**

Append a section to `docs/runbooks/secrets-rotation.md` (or create `docs/runbooks/log-retention.md`) noting the install command for fresh-VPS-replication.

- [ ] **Step 4: Commit doc only**

```bash
git add docs/runbooks/
git commit -m "ops(radix-v2): document pm2-logrotate install + retention policy (O7)"
```

---

## Phase 8 — Final Verify

### Task 22: Final acceptance check against design doc

- [ ] **Step 1: Re-read each P0 row in `docs/deployment-acceptance.md`**

Run the proof command for each. Update the "Current" column of the design doc with measured results (RED → GREEN where applicable).

- [ ] **Step 2: Run all smoke + lint + audit + Lighthouse one last time**

Run:
```bash
cd server && npm run typecheck && npm run lint && npm audit --production --audit-level=high && SMOKE_BASE_URL=https://srv1494206.hstgr.cloud npx vitest run
cd ../apps/desktop && npm run typecheck
./scripts/lighthouse.sh
```
Expected: all green.

- [ ] **Step 3: Update the design doc Current column → mark all P0 GREEN**

Edit `docs/deployment-acceptance.md` and change each P0 row's "Current" cell to `**GREEN** — verified <YYYY-MM-DD>`.

- [ ] **Step 4: Commit + tag**

```bash
git add docs/deployment-acceptance.md
git commit -m "docs(radix-v2): mark all P0 acceptance criteria GREEN — fully deployable"
git tag v1.0.0-deployable -m "All P0 acceptance criteria GREEN per docs/deployment-acceptance.md"
git push origin million-dollar-hardening --tags
```

---

## Self-Review (DRY runs before handing off)

**Spec coverage:**
- S1 → Phase 1 ✓
- S2 → Phase 2 (6 routes + ESLint) ✓
- S3 → Task 14 ✓
- S4 → Phase 6 ✓
- S5, S6, S7, S8 → already GREEN (verified in design doc) — no task ✓
- S9 → Phase 1 (runbook part) ✓
- S10 → Phase 3 ✓
- P1-P3 → Task 16 ✓
- P4-P5 → already GREEN, gated by routine smoke ✓
- P6 → Task 15 ✓
- P7 → Task 16 (manual auth-state) ✓
- R1-R3 → already GREEN ✓
- R4 → not in plan (1-line VPS pm2 set, batched into Task 21 dependency) — **add as substep**
- R5 → not in plan (Postgres backup cron) — **add as Task 21b**
- R6 → Tasks 11, 12, 13 ✓
- M1, M2, M3 → multi-tenancy, OUT OF SCOPE per Goal ✓
- O1, O2 → Tasks 18, 19 ✓
- O3 → not in plan — **add as Task 22b** (P1, wraps before final verify)
- O4 → not in plan — **add as Task 22c** (P1, Slack webhook)
- O5 → not in plan (idempotent seed via upsert) — P2, **defer; document only**
- O6 → Task 20 ✓
- O7 → Task 21 ✓
- O8 → not in plan — **add as Task 22d** (P0, GDPR runbook + script)

**Type consistency:** parseOr400 signature consistent across all tasks. Schema names consistent (CreateXBody / UpdateXBody pattern).

**Placeholder scan:** none found.

**Gap fixes (added inline below):**

### Task 21b: pm2 max_memory_restart cap (R4)

- [ ] **Step 1: Set on VPS**

Run: `ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud 'pm2 restart radix-api --max-memory-restart 800M && pm2 save'`

- [ ] **Step 2: Verify**

Run: `ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud 'pm2 show radix-api | grep -i memory'`
Expected: shows `800M`.

### Task 21c: Postgres daily pg_dump cron (R5)

- [ ] **Step 1: Write backup script**

```bash
# scripts/vps-backup-cron.sh (deployed to /opt/radix-v2/scripts/backup.sh on VPS)
#!/usr/bin/env bash
set -euo pipefail
DEST=/opt/radix-v2/backups
mkdir -p "$DEST"
DATE=$(date +%F)
PGPASSWORD=$(awk -F= '/^DB_PASSWORD=/{print $2}' /opt/radix-v2/server/.env) \
  pg_dump -h 127.0.0.1 -U radix radix_planner | gzip > "$DEST/${DATE}.sql.gz"
find "$DEST" -name '*.sql.gz' -mtime +14 -delete
```

- [ ] **Step 2: Install on VPS**

Run:
```bash
scp -i ~/.ssh/radix_vps scripts/vps-backup-cron.sh root@srv1494206.hstgr.cloud:/opt/radix-v2/scripts/backup.sh
ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud 'chmod +x /opt/radix-v2/scripts/backup.sh && (crontab -l 2>/dev/null; echo "0 3 * * * /opt/radix-v2/scripts/backup.sh") | sort -u | crontab -'
```

- [ ] **Step 3: Test it runs**

Run: `ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud '/opt/radix-v2/scripts/backup.sh && ls -la /opt/radix-v2/backups/'`
Expected: today's `.sql.gz` file present, < 24h ago.

- [ ] **Step 4: Commit**

```bash
git add scripts/vps-backup-cron.sh
git commit -m "ops(radix-v2): daily pg_dump cron + 14-day retention (R5)"
```

### Task 22b: Health endpoint surfaces queue/db/redis quantitative state (O3)

**Files:**
- Modify: `server/src/app.ts:159-191` (the existing `/api/health/details` handler)

- [ ] **Step 1: Add helpers**

```typescript
// inline in app.ts before the route, or in a new server/src/lib/health-checks.ts
import { db } from './db/prisma.js';
import { getQueueStats } from './workers/queue.js'; // returns {waiting, active, lastCompletedAt}

async function checkDb(): Promise<boolean> {
  try {
    const start = Date.now();
    await db.$queryRaw`SELECT 1`;
    return Date.now() - start < 500;
  } catch { return false; }
}
async function checkRedis(): Promise<boolean> {
  try {
    const Redis = (await import('ioredis')).default;
    const r = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 1, lazyConnect: true });
    const start = Date.now();
    await r.connect(); await r.ping(); await r.quit();
    return Date.now() - start < 200;
  } catch { return false; }
}
function checkQueue(stats: { waiting: number; active: number; lastCompletedAt: Date | null }): boolean {
  if (stats.waiting >= 1000 || stats.active >= 50) return false;
  if (stats.lastCompletedAt && Date.now() - stats.lastCompletedAt.getTime() > 5 * 60 * 1000) return false;
  return true;
}
```

- [ ] **Step 2: Augment the `/api/health/details` response**

Add inside the handler:
```typescript
const [dbReachable, redisReachable, queueStats] = await Promise.all([checkDb(), checkRedis(), getQueueStats().catch(() => ({ waiting: 0, active: 0, lastCompletedAt: null }))]);
return {
  ...existingResponse,
  db: { reachable: dbReachable },
  redis: { reachable: redisReachable },
  queue: { ...queueStats, healthy: checkQueue(queueStats) },
};
```

- [ ] **Step 3: If `getQueueStats` doesn't exist in `workers/queue.ts`, add it**

Add to `workers/queue.ts`:
```typescript
let lastCompletedAt: Date | null = null;
worker.on('completed', () => { lastCompletedAt = new Date(); });
export async function getQueueStats() {
  const counts = await queue.getJobCounts('waiting', 'active');
  return { waiting: counts.waiting, active: counts.active, lastCompletedAt };
}
```

- [ ] **Step 4: Typecheck + smoke + commit**

Run: `cd server && npx tsc --noEmit && npm run build`
Expected: 0 errors.

```bash
git add server/src/app.ts server/src/workers/queue.ts
git commit -m "feat(radix-v2): /api/health/details surfaces quantitative queue/db/redis state (O3)"
```

### Task 22c: Slack-webhook 5xx alerting (O4)

**Files:**
- Modify: `server/src/app.ts` (add Fastify error hook)
- Modify: `server/.env.example` (document `SLACK_ALERT_WEBHOOK_URL`)

- [ ] **Step 1: Add error hook**

```typescript
// in buildApp(), after route registration:
const SLACK = process.env.SLACK_ALERT_WEBHOOK_URL;
app.setErrorHandler(async (err, request, reply) => {
  app.log.error({ err, path: request.url }, 'unhandled');
  if (SLACK && (err.statusCode ?? 500) >= 500) {
    fetch(SLACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `🔴 radix-api 5xx: ${err.message}\n${request.method} ${request.url}` }),
    }).catch(() => {});
  }
  reply.status(err.statusCode ?? 500).send({ error: err.message });
});
```

- [ ] **Step 2: Document env var**

Append to `server/.env.example`:
```
# Slack webhook URL for 5xx error alerts. Leave unset to disable.
SLACK_ALERT_WEBHOOK_URL=
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd server && npx tsc --noEmit
git add server/src/app.ts server/.env.example
git commit -m "feat(radix-v2): Slack webhook on 5xx errors (O4 — Sentry deferred)"
```

### Task 22d: GDPR data-subject deletion runbook + script (O8)

**Files:**
- Create: `scripts/delete-user.sh`
- Create: `docs/runbooks/data-subject-deletion.md`

- [ ] **Step 1: Write the script**

```bash
# scripts/delete-user.sh
#!/usr/bin/env bash
# GDPR data-subject deletion. Cascades User → RefreshToken / AuditLog / AgentSession / PostComment.
# Usage: ./scripts/delete-user.sh <userId>
set -euo pipefail
USER_ID="${1:?usage: delete-user.sh <userId>}"

ssh -i "${SSH_KEY:-$HOME/.ssh/radix_vps}" root@srv1494206.hstgr.cloud "
  set -euo pipefail
  PGPASSWORD=\$(awk -F= '/^DB_PASSWORD=/{print \$2}' /opt/radix-v2/server/.env) psql -h 127.0.0.1 -U radix -d radix_planner <<EOF
BEGIN;
DELETE FROM \"RefreshToken\" WHERE \"userId\" = '$USER_ID';
DELETE FROM \"AuditLog\" WHERE \"userId\" = '$USER_ID';
DELETE FROM \"AgentSession\" WHERE \"userId\" = '$USER_ID';
DELETE FROM \"PostComment\" WHERE \"authorId\" = '$USER_ID';
DELETE FROM \"User\" WHERE id = '$USER_ID';
COMMIT;
EOF
"
echo "✓ User $USER_ID purged"
```

- [ ] **Step 2: Write the runbook**

```markdown
# Data-Subject Deletion (GDPR)

**Purpose:** delete all data attributable to a single User identifier on request.

**Cascade chain (per `prisma/schema.prisma`):**
- User → RefreshToken (onDelete: Cascade)
- User → AuditLog (onDelete: Cascade)
- User → AgentSession (onDelete: Cascade)
- User.comments[] → PostComment (onDelete: Cascade via authorId)

**Script:** `./scripts/delete-user.sh <userId>` runs the cascade in a single transaction.

**Audit:** the deletion itself is NOT logged to AuditLog (the user's own log entries are gone). Capture a separate operator log entry in `docs/runbooks/deletions.log`.

**Cannot delete:**
- Client + ClientBrief (org data, not user data)
- CalendarPost / Asset (client-owned)
- ApiKey (client-scoped, not user-scoped)
```

- [ ] **Step 3: Demo-deletion test (against demo-member, then reseed)**

Run:
```bash
chmod +x scripts/delete-user.sh
ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud "PGPASSWORD=\$(awk -F= '/^DB_PASSWORD=/{print \$2}' /opt/radix-v2/server/.env) psql -h 127.0.0.1 -U radix -d radix_planner -tAc \"SELECT id FROM \\\"User\\\" WHERE email='demo-member@radix.local'\""
# Capture the userId, then:
./scripts/delete-user.sh <captured-id>
# Re-seed:
ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud 'cd /opt/radix-v2/server && node dist/prisma/seed.js'
```
Expected: deletion ran without orphan errors; reseed re-created demo-member.

- [ ] **Step 4: Commit**

```bash
git add scripts/delete-user.sh docs/runbooks/data-subject-deletion.md
git commit -m "ops(radix-v2): GDPR data-subject deletion runbook + script (O8)"
```

---

## Final Tally

After all tasks done: **22 tasks (1-22d)** spanning ~5 parallel-session hours.

P0 GREEN gate: all 11 P0 acceptance rows verified GREEN in `docs/deployment-acceptance.md`. Tag `v1.0.0-deployable` lands.

P1 still open after this plan: O5 (idempotent seed via upsert) — defer to follow-up.

P2 still open: M2, M3 — multi-tenancy roadmap, separate plan.
