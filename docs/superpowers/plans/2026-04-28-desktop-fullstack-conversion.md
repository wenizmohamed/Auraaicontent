# Radix V2 Desktop Full-Stack Conversion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Radix V2 Electron thin-client into a 100% self-contained full-stack desktop installer that bundles the Fastify backend + SQLite DB + frontend, runs offline (except AI provider calls), and ships via GitHub Releases with electron-updater auto-update.

**Architecture:** Electron main process forks the compiled Fastify backend (`server/dist/index.js`) as a child process at app boot, picking a random free port and injecting `DB_TARGET=sqlite` + `DATABASE_URL=file:<userData>/radix.db` env. The renderer reads the resolved port via `window.electron.apiBaseUrl` (already wired) and talks to `127.0.0.1:<port>/api`. Two Prisma schemas keep the VPS multi-tenant Postgres+pgvector intact while the desktop schema drops vector storage.

**Tech Stack:** Electron 41, Vite 6, React 19, Fastify 5, Prisma 6.7, better-sqlite3, electron-builder 26.8, electron-updater 6.x, vitest 4.

---

## File Structure (locked before tasks)

| File | Action | Responsibility |
|------|--------|----------------|
| `server/prisma/schema-sqlite.prisma` | CREATE | SQLite-shaped schema (Json → String, drop pgvector hooks) |
| `server/prisma/migrations-sqlite/0_init/migration.sql` | CREATE | Generated baseline migration |
| `server/prisma/migrations-sqlite/migration_lock.toml` | CREATE | Provider lock |
| `server/scripts/build-sqlite-client.mjs` | CREATE | Wraps `prisma generate` for SQLite into custom output dir |
| `server/src/db/index.ts` | CREATE | `createPrismaClient()` selector based on `DB_TARGET` env |
| `server/src/index.ts` | MODIFY | Use `createPrismaClient()`; emit `process.send({type:'ready',port})` |
| `server/package.json` | MODIFY | Add SQLite scripts |
| `server/test/db-selector.test.ts` | CREATE | Vitest: client selector by env |
| `server/test/sqlite-migration.test.ts` | CREATE | Vitest: tempfile migrate + insert + select |
| `apps/desktop/electron/main.cjs` | MODIFY | `forkServer()`, ready-handshake, IPC port channel, autoUpdater |
| `apps/desktop/electron/preload.cjs` | MODIFY | Replace static `apiBaseUrl` with port from main, expose `getServerPort()` |
| `apps/desktop/src/lib/electron-types.d.ts` | MODIFY/CREATE | Type the new electron API |
| `apps/desktop/package.json` | MODIFY | NSIS target, extraResources, signing block, electron-updater dep |
| `apps/desktop/build/cert-instructions.md` | CREATE | How to generate self-signed `.pfx` (cert itself NOT committed) |
| `apps/desktop/.gitignore` | MODIFY | Ignore `build/cert.pfx`, `release/`, `dist/` already there |
| `apps/desktop/.env.example` | MODIFY | Add `CSC_KEY_PASSWORD` placeholder |

---

## Commit A — SQLite swap + DB selector (~30 min)

### Task A1: Create SQLite schema mirror

**Files:**
- Create: `server/prisma/schema-sqlite.prisma`

- [ ] **Step 1: Write `schema-sqlite.prisma`**

Clone of `schema.prisma` with these exact changes:
- `provider = "sqlite"` (was `"postgresql"`)
- `output = "../node_modules/.prisma/client-sqlite"` added to generator block (segregates from default Postgres client)
- All `Json` types replaced with `String` and a `@db` map dropped (SQLite has no Json native; we serialize at app layer)
- Convert `String` columns currently using PG-only behavior — none in this schema, so no other changes
- Drop the comment line `// embedding Unsupported("vector")? // Requires pgvector — enabled in Commit 8` from `KnowledgeChunk` (it's already a comment, but stripping for clarity)

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../node_modules/.prisma/client-sqlite"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  role         String   @default("member")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  comments       PostComment[]
  auditLogs      AuditLog[]
  agentSessions  AgentSession[]
  refreshTokens  RefreshToken[]
}

// ... [REPEAT remaining 17 models from schema.prisma verbatim, with these per-model Json→String swaps:]
//   ClientBrief.products / pillars / campaignMoments / channels / approvers   → String  (default "[]")
//   KnowledgeItem.metadata                                                     → String? (default null)
//   KnowledgeChunk.metadata                                                    → String? (default null)
//   Asset.analysis / tags                                                      → String? (default null)
//   CalendarMonth.strategy                                                     → String? (default null)
//   CalendarPost.hashtags / metadata                                           → String? (default null)
//   PostVersion.snapshot                                                       → String  (no default; required)
//   AuditLog.payload                                                           → String? (default null)
//   AgentEvent.payload                                                         → String  (no default; required)
```

- [ ] **Step 2: Generate the SQLite client to verify schema is valid**

Run: `cd server && npx prisma generate --schema=prisma/schema-sqlite.prisma`
Expected: `✔ Generated Prisma Client (X.X.X) to ./node_modules/.prisma/client-sqlite`

- [ ] **Step 3: Commit (intermediate, gates failure early)**

```bash
git add server/prisma/schema-sqlite.prisma
git commit -m "feat(desktop): SQLite schema mirror — Json→String, separate client output"
```

### Task A2: Generate baseline SQLite migration

**Files:**
- Create: `server/prisma/migrations-sqlite/0_init/migration.sql`
- Create: `server/prisma/migrations-sqlite/migration_lock.toml`

- [ ] **Step 1: Generate migration via prisma migrate diff**

Run:
```bash
cd server
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema-sqlite.prisma \
  --script > prisma/migrations-sqlite/0_init/migration.sql
```
Expected: file written, ~300 lines of `CREATE TABLE` statements.

- [ ] **Step 2: Write `migration_lock.toml`**

```toml
provider = "sqlite"
```

- [ ] **Step 3: Smoke-apply migration to a temp file to verify it runs**

```bash
cd server
DATABASE_URL="file:/tmp/radix-test.db" npx prisma migrate deploy --schema=prisma/schema-sqlite.prisma
```
Expected: `✔ Applied migration "0_init"`. Then `rm /tmp/radix-test.db /tmp/radix-test.db-journal 2>/dev/null`.

- [ ] **Step 4: Commit**

```bash
git add server/prisma/migrations-sqlite/
git commit -m "feat(desktop): SQLite baseline migration (0_init)"
```

### Task A3: Build script for SQLite client

**Files:**
- Create: `server/scripts/build-sqlite-client.mjs`

- [ ] **Step 1: Write the script**

```js
// server/scripts/build-sqlite-client.mjs
// Generates the SQLite-shaped Prisma client into a separate output dir
// so it can coexist with the default Postgres client used by the VPS build.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');

console.log('[build-sqlite-client] generating client → node_modules/.prisma/client-sqlite');
execSync('npx prisma generate --schema=prisma/schema-sqlite.prisma', {
  cwd: serverDir,
  stdio: 'inherit',
});
console.log('[build-sqlite-client] done');
```

- [ ] **Step 2: Run it to verify**

Run: `cd server && node scripts/build-sqlite-client.mjs`
Expected: prisma generate output, ends with `✔ Generated Prisma Client`.

### Task A4: DB selector module

**Files:**
- Create: `server/src/db/index.ts`

- [ ] **Step 1: Write the failing test FIRST**

Create `server/test/db-selector.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('createPrismaClient', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns the SQLite client when DB_TARGET=sqlite', async () => {
    process.env.DB_TARGET = 'sqlite';
    process.env.DATABASE_URL = 'file:/tmp/radix-selector-test.db';
    const { createPrismaClient } = await import('../src/db/index.js?t=' + Date.now());
    const client = createPrismaClient();
    expect(client).toBeDefined();
    expect((client as any)._engineConfig?.activeProvider ?? 'sqlite').toBe('sqlite');
    await client.$disconnect();
  });

  it('returns the Postgres client when DB_TARGET unset (default)', async () => {
    delete process.env.DB_TARGET;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    const { createPrismaClient } = await import('../src/db/index.js?t=' + Date.now());
    const client = createPrismaClient();
    expect(client).toBeDefined();
    await client.$disconnect();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL ("Cannot find module ../src/db/index")**

Run: `cd server && npx vitest run test/db-selector.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `server/src/db/index.ts`**

```ts
// Selects the right Prisma client based on DB_TARGET env.
//   DB_TARGET=sqlite  → loads ../node_modules/.prisma/client-sqlite (desktop build)
//   DB_TARGET=postgres or unset → loads @prisma/client (default; VPS multi-tenant)
//
// The desktop electron main.cjs sets DB_TARGET=sqlite + DATABASE_URL=file:<userData>/radix.db
// before forking server/dist/index.js. The VPS keeps the existing env shape.

import type { PrismaClient as PrismaClientType } from '@prisma/client';

export function createPrismaClient(): PrismaClientType {
  const target = process.env.DB_TARGET ?? 'postgres';

  if (target === 'sqlite') {
    // Lazy require so the Postgres client doesn't need to load when SQLite is in use,
    // and vice-versa. Both clients are independent files thanks to `output =` in schemas.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require('../../node_modules/.prisma/client-sqlite');
    return new PrismaClient();
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient();
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `cd server && npx vitest run test/db-selector.test.ts`
Expected: 2/2 passed.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/ server/test/db-selector.test.ts server/scripts/build-sqlite-client.mjs
git commit -m "feat(desktop): DB selector module + SQLite client build script"
```

### Task A5: Wire selector into server entry

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Find the existing PrismaClient import + instantiation**

Run: `cd server && grep -n "PrismaClient" src/index.ts`
Expected: 1-2 lines showing `import { PrismaClient } from '@prisma/client'` and `new PrismaClient(...)`.

- [ ] **Step 2: Replace import + instantiation**

Change `import { PrismaClient } from '@prisma/client';` → `import { createPrismaClient } from './db/index.js';`
Change `const prisma = new PrismaClient(...)` → `const prisma = createPrismaClient();`

(Whatever shape `new PrismaClient(...)` had with options — preserve them by extending `createPrismaClient` to accept options if needed. If it's just `new PrismaClient()` no-arg, no extension needed.)

- [ ] **Step 3: Smoke-test the existing VPS path still works**

Run: `cd server && DB_TARGET=postgres DATABASE_URL=$EXISTING_VPS_URL npx tsx src/index.ts &` then `curl -s localhost:8080/api/health` → expect `{"status":"ok"}`. Kill: `pkill -f "tsx src/index.ts"`.

- [ ] **Step 4: Smoke-test the SQLite path**

```bash
cd server
DB_TARGET=sqlite DATABASE_URL=file:/tmp/radix-smoke.db PORT=8089 npx tsx src/index.ts &
sleep 2
curl -s localhost:8089/api/health
# expect {"status":"ok"}
pkill -f "tsx src/index.ts"
rm -f /tmp/radix-smoke.db /tmp/radix-smoke.db-journal
```

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(desktop): server entry uses DB selector — Postgres + SQLite paths green"
```

### Task A6: SQLite migration integration test

**Files:**
- Create: `server/test/sqlite-migration.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('SQLite migration', () => {
  let tmpDir: string;
  let dbUrl: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'radix-sqlite-mig-'));
    dbUrl = `file:${path.join(tmpDir, 'test.db')}`;
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('applies 0_init migration cleanly', () => {
    execSync(
      `npx prisma migrate deploy --schema=prisma/schema-sqlite.prisma`,
      { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'pipe' }
    );
    // No throw = pass
    expect(true).toBe(true);
  });

  it('inserts and reads a User row', async () => {
    process.env.DB_TARGET = 'sqlite';
    process.env.DATABASE_URL = dbUrl;
    const { createPrismaClient } = await import('../src/db/index.js?t=' + Date.now());
    const prisma = createPrismaClient();
    const u = await prisma.user.create({
      data: { email: 't@example.com', name: 'Test', passwordHash: 'hash', role: 'admin' }
    });
    expect(u.id).toBeTruthy();
    const back = await prisma.user.findUnique({ where: { email: 't@example.com' } });
    expect(back?.name).toBe('Test');
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run, expect PASS**

Run: `cd server && npx vitest run test/sqlite-migration.test.ts`
Expected: 2/2 passed.

- [ ] **Step 3: Commit**

```bash
git add server/test/sqlite-migration.test.ts
git commit -m "test(desktop): SQLite migration applies + User CRUD smoke"
```

### Task A7: Add SQLite scripts to package.json

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Add scripts**

Insert in `scripts` block (after existing `prisma:*`):

```json
"prisma:generate:sqlite": "prisma generate --schema=prisma/schema-sqlite.prisma",
"prisma:migrate:sqlite:dev": "prisma migrate dev --schema=prisma/schema-sqlite.prisma",
"prisma:migrate:sqlite:deploy": "prisma migrate deploy --schema=prisma/schema-sqlite.prisma",
"build:desktop": "tsc && node scripts/build-sqlite-client.mjs"
```

- [ ] **Step 2: Run `pnpm build:desktop` to verify**

Expected: tsc completes, then prisma generate succeeds.

- [ ] **Step 3: Commit Commit A end**

```bash
git add server/package.json
git commit -m "feat(desktop): add SQLite + build:desktop scripts"
```

**Verify Commit A complete:**
```bash
cd server
pnpm test  # all green including new tests
pnpm build:desktop  # compiles + generates SQLite client
ls node_modules/.prisma/client-sqlite/index.js  # exists
```

---

## Commit B — Electron forks the backend (~25 min)

### Task B1: Server emits ready handshake

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Find the `app.listen(...)` call**

Run: `cd server && grep -n "app.listen\|fastify.listen\|listen({" src/index.ts`
Expected: 1 match showing the listen call.

- [ ] **Step 2: Add ready emit after listen resolves**

After `await app.listen({ port, host })` (or equivalent), append:

```ts
// IPC handshake to Electron parent (only when forked with stdio: ['inherit','inherit','inherit','ipc']).
// Tells the parent the server is bound and ready to accept connections.
if (typeof process.send === 'function') {
  const addr = app.server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : port;
  process.send({ type: 'radix:ready', port: boundPort });
}
```

- [ ] **Step 3: Verify VPS path still works (no breakage when not forked)**

`process.send` is undefined when not forked, so the conditional protects the VPS. Run the existing smoke from A5 again — expect 200.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(desktop): server emits ready handshake to Electron parent via process.send"
```

### Task B2: Electron forks server with handshake

**Files:**
- Modify: `apps/desktop/electron/main.cjs`

- [ ] **Step 1: Add forkServer + getOrCreateJwtSecret + free-port helpers at top of file**

Insert after existing requires (line 2):

```js
const { fork } = require('child_process');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');

let serverChild = null;
let serverPort = null;
let serverReadyPromise = null;

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function getOrCreateJwtSecret() {
  // Persist a random JWT secret per-install in userData so tokens survive restarts.
  const file = path.join(app.getPath('userData'), 'jwt.secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

async function forkServer() {
  if (serverReadyPromise) return serverReadyPromise;

  // In dev: server is at ../../../server/dist/index.js (workspace root)
  // In packaged: extraResources places it at process.resourcesPath/server/dist/index.js
  const serverEntry = app.isPackaged
    ? path.join(process.resourcesPath, 'server', 'dist', 'index.js')
    : path.join(__dirname, '..', '..', '..', 'server', 'dist', 'index.js');

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`[radix] backend bundle not found at ${serverEntry} — did you run pnpm build:desktop in /server?`);
  }

  const port = await pickFreePort();
  const dbPath = path.join(app.getPath('userData'), 'radix.db');

  serverChild = fork(serverEntry, [], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DB_TARGET: 'sqlite',
      DATABASE_URL: `file:${dbPath}`,
      PORT: String(port),
      HOST: '127.0.0.1',
      JWT_SECRET: getOrCreateJwtSecret(),
      // Disable BullMQ/Redis dependence — desktop has no Redis. Server falls back to in-memory.
      DISABLE_BULLMQ: '1',
    },
    silent: false,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });

  serverChild.on('exit', (code, signal) => {
    console.error(`[radix] backend exited (code=${code} signal=${signal})`);
    serverChild = null;
    serverPort = null;
    serverReadyPromise = null;
  });

  serverReadyPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('[radix] backend ready handshake timed out (10s)')), 10_000);
    serverChild.on('message', (msg) => {
      if (msg && msg.type === 'radix:ready') {
        clearTimeout(timeout);
        serverPort = msg.port;
        console.log(`[radix] backend ready on port ${serverPort}`);
        resolve(serverPort);
      }
    });
  });

  return serverReadyPromise;
}
```

- [ ] **Step 2: Run forkServer before createWindow**

Find `app.whenReady().then(() => {` (around line 96) and replace the body:

```js
app.whenReady().then(async () => {
  try {
    await forkServer();
  } catch (err) {
    console.error('[radix] failed to start backend:', err);
    // Fall through — frontend will degrade to VPS via existing cascade in backend-api.ts
  }
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});
```

- [ ] **Step 3: Add IPC handler for renderer port lookup**

After existing `ipcMain.on('window-close'...)` block (line 93), add:

```js
ipcMain.handle('radix:get-server-port', async () => {
  if (serverPort) return serverPort;
  if (serverReadyPromise) return await serverReadyPromise;
  return null; // fallback — renderer cascades to VPS
});
```

- [ ] **Step 4: Kill child on app quit**

Replace existing `app.on('before-quit'...)` (line 112) with:

```js
app.on('before-quit', async () => {
  app.isQuitting = true;
  if (serverChild) {
    serverChild.kill('SIGTERM');
    // Force-kill after 5s if still alive
    setTimeout(() => { if (serverChild) serverChild.kill('SIGKILL'); }, 5000);
  }
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/main.cjs
git commit -m "feat(desktop): main.cjs forks Fastify backend with SQLite + ready handshake + clean shutdown"
```

### Task B3: Preload exposes dynamic port

**Files:**
- Modify: `apps/desktop/electron/preload.cjs`
- Modify: `apps/desktop/src/lib/electron-types.d.ts` (or create if absent)

- [ ] **Step 1: Replace preload.cjs entirely**

```js
const { contextBridge, ipcRenderer } = require('electron');

// Lazy port resolution — main.cjs starts the server async; renderer awaits via getServerPort().
let cachedPort = null;
async function getServerPort() {
  if (cachedPort) return cachedPort;
  cachedPort = await ipcRenderer.invoke('radix:get-server-port');
  return cachedPort;
}

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  isDesktop: true,
  // Synchronous getter for the cascade in backend-api.ts. Returns the localhost
  // URL once main.cjs has resolved the port; null otherwise (renderer falls back to VPS).
  apiBaseUrl: null, // set by backend-api.ts after awaiting getServerPort()
  getServerPort,
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
});
```

- [ ] **Step 2: Update electron-types.d.ts**

Find existing file (`apps/desktop/src/lib/electron-types.d.ts` or similar — search for `interface Electron` or `Window`):

Run: `grep -rn "isDesktop\|apiBaseUrl" apps/desktop/src/lib/`

Add `getServerPort: () => Promise<number | null>;` to the electron interface. Drop or make `apiBaseUrl: string | null` (was `string`).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/electron/preload.cjs apps/desktop/src/lib/electron-types.d.ts
git commit -m "feat(desktop): preload exposes dynamic getServerPort, replaces hardcoded apiBaseUrl"
```

### Task B4: Frontend awaits port before first request

**Files:**
- Modify: `apps/desktop/src/lib/backend-api.ts`

- [ ] **Step 1: Insert resolveDesktopPort + amend cascade**

Around line 13–30 (`computeCandidates` + `let API_URL =`), replace with:

```ts
const PRODUCTION_VPS_URL = 'https://srv1494206.hstgr.cloud';
let DESKTOP_PORT_RESOLVED: number | null = null;
let DESKTOP_PORT_PROMISE: Promise<number | null> | null = null;

function resolveDesktopPort(): Promise<number | null> {
  if (typeof window === 'undefined' || !window.electron?.isDesktop) return Promise.resolve(null);
  if (DESKTOP_PORT_RESOLVED != null) return Promise.resolve(DESKTOP_PORT_RESOLVED);
  if (DESKTOP_PORT_PROMISE) return DESKTOP_PORT_PROMISE;
  DESKTOP_PORT_PROMISE = (async () => {
    try {
      const p = await window.electron!.getServerPort();
      DESKTOP_PORT_RESOLVED = typeof p === 'number' ? p : null;
      return DESKTOP_PORT_RESOLVED;
    } catch {
      return null;
    }
  })();
  return DESKTOP_PORT_PROMISE;
}

async function computeCandidatesAsync(): Promise<string[]> {
  const explicit = import.meta.env.VITE_API_URL as string | undefined;
  if (explicit) return [explicit];
  const stored = typeof window !== 'undefined' ? localStorage.getItem('radix_api_url') : null;
  const desktopPort = await resolveDesktopPort();
  const isDev = import.meta.env.DEV;
  const isElectron = typeof window !== 'undefined' && window.electron?.isDesktop;

  const list: string[] = [];
  if (stored) list.push(stored);
  if (desktopPort) list.push(`http://127.0.0.1:${desktopPort}`);
  if (isElectron || isDev) list.push('http://127.0.0.1:8080');
  if (isElectron) list.push(PRODUCTION_VPS_URL);
  if (!list.length) list.push('');
  return [...new Set(list)];
}

let API_URL: string = '';
```

- [ ] **Step 2: Update `pickHealthyBackend` to use the async candidates**

```ts
async function pickHealthyBackend(timeoutMs = 2000): Promise<string | null> {
  const candidates = await computeCandidatesAsync();
  for (const candidate of candidates) {
    if (await probeHealthy(candidate, timeoutMs)) {
      API_URL = candidate;
      try { localStorage.setItem('radix_api_url', candidate); } catch {}
      return candidate;
    }
  }
  return null;
}
```

- [ ] **Step 3: Remove or guard the old synchronous `computeCandidates()` and `let API_URL = computeCandidates()[0]`**

Either delete entirely (callers should use `pickHealthyBackend`) or keep as a fallback that returns `[]` synchronously and emits a warning if used before async resolution.

- [ ] **Step 4: Verify in dev mode**

Run two terminals:
- Terminal 1: `cd server && DB_TARGET=sqlite DATABASE_URL=file:/tmp/radix-dev.db pnpm dev`
- Terminal 2: `cd apps/desktop && pnpm electron:dev`

Expected: Electron window opens, devtools network tab shows `127.0.0.1:<random>/api/health` succeeds.

- [ ] **Step 5: Commit Commit B end**

```bash
git add apps/desktop/src/lib/backend-api.ts
git commit -m "feat(desktop): backend-api awaits Electron getServerPort before cascading"
```

**Verify Commit B complete:**
```bash
cd apps/desktop
pnpm electron:dev  # window opens, login screen renders, dashboard reachable, no VPS hits in network tab
```

---

## Commit C — Packaging + signing + auto-update (~25 min)

### Task C1: Add electron-updater + extraResources

**Files:**
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Install electron-updater**

Run: `cd apps/desktop && pnpm add electron-updater@^6.3.0`
Expected: package.json gets new dep, lockfile updates.

- [ ] **Step 2: Edit `build` block in package.json**

Replace existing `build` block with:

```json
"build": {
  "appId": "ae.radixmedia.contentplanner",
  "productName": "RADIX AI Content Planner",
  "directories": {
    "output": "release"
  },
  "files": [
    "dist/**/*",
    "electron/**/*",
    "public/**/*"
  ],
  "extraResources": [
    { "from": "../../server/dist", "to": "server/dist" },
    { "from": "../../server/node_modules/.prisma/client-sqlite", "to": "server/node_modules/.prisma/client-sqlite" },
    { "from": "../../server/prisma/schema-sqlite.prisma", "to": "server/prisma/schema-sqlite.prisma" },
    { "from": "../../server/prisma/migrations-sqlite", "to": "server/prisma/migrations-sqlite" },
    { "from": "../../server/node_modules/.prisma/client-sqlite/query_engine-windows.dll.node", "to": "server/node_modules/.prisma/client-sqlite/query_engine-windows.dll.node" }
  ],
  "win": {
    "target": ["nsis", "portable"],
    "certificateFile": "build/cert.pfx",
    "certificatePassword": "${env.CSC_KEY_PASSWORD}",
    "signingHashAlgorithms": ["sha256"],
    "icon": "public/radix-icon.png"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "perMachine": false,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "RADIX"
  },
  "portable": {
    "artifactName": "RADIX-Content-Planner-Portable-v${version}.exe"
  },
  "publish": {
    "provider": "github",
    "owner": "RadixMedia",
    "repo": "radix-content-planner-desktop",
    "releaseType": "release"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/package.json apps/desktop/pnpm-lock.yaml
git commit -m "feat(desktop): electron-builder NSIS + extraResources + signing + GitHub publish"
```

### Task C2: Wire autoUpdater into main.cjs

**Files:**
- Modify: `apps/desktop/electron/main.cjs`

- [ ] **Step 1: Add electron-updater require**

After existing `const { fork } = require('child_process');` (added in B2), add:

```js
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('update-available', (info) => {
  console.log(`[radix-updater] update available: v${info.version}`);
});
autoUpdater.on('update-downloaded', (info) => {
  console.log(`[radix-updater] update downloaded: v${info.version} — will install on quit`);
  // Optional: prompt user via dialog
});
autoUpdater.on('error', (err) => {
  console.error('[radix-updater] error:', err.message);
});
```

- [ ] **Step 2: Trigger check after window opens**

In `app.whenReady().then(...)` after `createTray()`, add:

```js
if (app.isPackaged) {
  // Wait 5s post-launch so the user sees the app, then check for updates
  setTimeout(() => autoUpdater.checkForUpdatesAndNotify().catch(console.error), 5000);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/electron/main.cjs
git commit -m "feat(desktop): autoUpdater wired — checks GitHub Releases 5s post-launch"
```

### Task C3: Self-signed cert generation guide

**Files:**
- Create: `apps/desktop/build/cert-instructions.md`
- Modify: `apps/desktop/.gitignore`

- [ ] **Step 1: Write `apps/desktop/build/cert-instructions.md`**

```markdown
# Self-Signed Code-Signing Cert (Wave 1)

This is the **dev/early-user signing flow**. Replace with an EV cert ($200/yr) once
downloads cross 100+ to skip SmartScreen entirely.

## Generate the cert (Windows PowerShell, one-time)

```powershell
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=Radix Media, O=Radix Media, C=AE" `
  -KeyUsage DigitalSignature `
  -KeySpec Signature `
  -CertStoreLocation Cert:\CurrentUser\My `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -NotAfter (Get-Date).AddYears(3)

$pwd = ConvertTo-SecureString -String "PICK_A_STRONG_PASSWORD" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath "apps\desktop\build\cert.pfx" -Password $pwd
```

## Set the password env

In your dev shell before `pnpm electron:build`:

```powershell
$env:CSC_KEY_PASSWORD = "PICK_A_STRONG_PASSWORD"
```

(Or persist via `setx CSC_KEY_PASSWORD "..."` for a permanent setting.)

## .gitignore

`build/cert.pfx` MUST be in `.gitignore`. Never commit the cert. The password
lives only in the developer's shell env or in CI secrets (when we add CI).

## Trusting the cert on user machines (optional, kills SmartScreen)

Distribute the public certificate (`.cer`) once and have users import it into
"Trusted Publishers". Most teams skip this and live with the SmartScreen prompt.
```

- [ ] **Step 2: Update `apps/desktop/.gitignore`**

Append:

```
# Code signing
build/cert.pfx
build/cert.cer
.env
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/build/cert-instructions.md apps/desktop/.gitignore
git commit -m "docs(desktop): self-signed cert generation guide + gitignore signing files"
```

### Task C4: First full build — verify NSIS installer + portable both produce

**Files:** none — this is the full smoke.

- [ ] **Step 1: Generate the cert per `cert-instructions.md`**

Run the PowerShell block. Confirm `apps/desktop/build/cert.pfx` exists.

- [ ] **Step 2: Build the server bundle for desktop**

```bash
cd server
pnpm build:desktop
```
Expected: `server/dist/index.js` exists + `server/node_modules/.prisma/client-sqlite/index.js` exists.

- [ ] **Step 3: Run electron:build**

```bash
cd apps/desktop
$env:CSC_KEY_PASSWORD = "<your password>"
pnpm electron:build
```
Expected:
- `release/RADIX AI Content Planner Setup 1.0.0.exe` — NSIS installer
- `release/RADIX-Content-Planner-Portable-v1.0.0.exe` — portable
- `release/latest.yml` — auto-update manifest
- `release/win-unpacked/resources/server/dist/index.js` — backend bundled
- `release/win-unpacked/resources/server/prisma/schema-sqlite.prisma` — schema bundled

- [ ] **Step 4: Install + launch + smoke test**

Run the NSIS installer. Confirm:
- App installs to `%LOCALAPPDATA%\Programs\RADIX AI Content Planner\`
- Launches and opens to login screen
- Login with `demo-admin@radix.local` / `demoAdmin2026!` works (SQLite seeded? — see Task C5)
- Dashboard renders
- DevTools (Ctrl+Shift+I) network tab shows `127.0.0.1:<port>/api/*` requests, ZERO `srv1494206.hstgr.cloud` requests

- [ ] **Step 5: Offline test**

Disable Wi-Fi. Restart the app. Login should still work. AI features (image gen) should display "Configure API keys in Settings" — that's expected, AI providers need internet + key.

### Task C5: Auto-seed admin on first launch (so installer is shareable)

**Files:**
- Modify: `apps/desktop/electron/main.cjs`

- [ ] **Step 1: Add seed-on-first-launch logic**

In `forkServer()`, before `fork(...)`, check if SQLite db file exists. If not, after fork ready, call a seed endpoint OR pass `RADIX_AUTOSEED=1` env. Server side, gate seed code on this env.

In `apps/desktop/electron/main.cjs` `forkServer()` — add to env:

```js
const dbExists = fs.existsSync(dbPath);
// ...inside fork env:
RADIX_AUTOSEED: dbExists ? '0' : '1',
```

- [ ] **Step 2: Server-side seed gate**

Modify `server/src/index.ts` (or wherever seed runs). After `app.listen(...)` and before the `process.send(ready)`:

```ts
if (process.env.RADIX_AUTOSEED === '1' && process.env.DB_TARGET === 'sqlite') {
  // First-launch seed: create demo-admin user so the desktop installer is shareable.
  // No business data — just one admin so login works out of the box.
  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.default.hash('demoAdmin2026!', 12);
  await prisma.user.upsert({
    where: { email: 'demo-admin@radix.local' },
    update: {},
    create: { email: 'demo-admin@radix.local', name: 'Demo Admin', passwordHash: hash, role: 'admin' },
  });
  console.log('[radix] auto-seeded demo-admin (first launch)');
}
```

- [ ] **Step 3: Run migrations on first launch too**

In `forkServer()` — before fork, if `!dbExists`, run prisma migrate deploy via spawnSync:

```js
if (!dbExists) {
  const migPath = app.isPackaged
    ? path.join(process.resourcesPath, 'server', 'prisma', 'migrations-sqlite')
    : path.join(__dirname, '..', '..', '..', 'server', 'prisma', 'migrations-sqlite');
  const schemaPath = app.isPackaged
    ? path.join(process.resourcesPath, 'server', 'prisma', 'schema-sqlite.prisma')
    : path.join(__dirname, '..', '..', '..', 'server', 'prisma', 'schema-sqlite.prisma');

  // Use the bundled prisma CLI from server/node_modules
  const prismaBin = app.isPackaged
    ? path.join(process.resourcesPath, 'server', 'node_modules', '.bin', 'prisma')
    : path.join(__dirname, '..', '..', '..', 'server', 'node_modules', '.bin', 'prisma');

  const { spawnSync } = require('child_process');
  const result = spawnSync(prismaBin, ['migrate', 'deploy', `--schema=${schemaPath}`], {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('[radix] SQLite migration failed on first launch');
}
```

NOTE: For Wave 1 we may simplify this by ALSO including prisma CLI in extraResources. Easier alternative: pre-create the SQLite db file in the installer build step and ship it pre-migrated. Capture this in rollback.

- [ ] **Step 4: Rebuild + retest**

Repeat C4 steps 2-4 with a fresh `%APPDATA%\RADIX AI Content Planner\` (delete folder first to simulate first install). Confirm:
- DB created at `%APPDATA%\RADIX AI Content Planner\radix.db`
- `radix.db` has User table with demo-admin row
- Login works

- [ ] **Step 5: Commit Commit C end**

```bash
git add apps/desktop/electron/main.cjs server/src/index.ts
git commit -m "feat(desktop): first-launch auto-seed demo admin + SQLite migrate-on-boot"
```

**Verify Commit C complete:**
```bash
# Fresh install simulation
Remove-Item -Recurse -Force "$env:APPDATA\RADIX AI Content Planner" -ErrorAction SilentlyContinue
# Run installer
& "apps\desktop\release\RADIX AI Content Planner Setup 1.0.0.exe"
# Launch from Start Menu → login → dashboard renders
```

---

## Wave 4 (deferred sub-plan, after Commits A/B/C ship)

These run **PARALLEL** once Commit C verifies green:

- `/git` → tag `v2.0.0-desktop`, `gh release create v2.0.0-desktop release/*.exe release/latest.yml --notes "Full-stack desktop"`
- `/deploy` → static-host installer download page on `srv1494206.hstgr.cloud/download/` (single nginx location, redirects to GitHub Releases latest); add `app.radixmedia.ae` DNS A-record → 187.77.158.177 if Weni wants brand domain
- `/aura-learn` → save the FULL pattern (Electron + Prisma SQLite + child_process.fork + electron-updater + GitHub Releases) as `breakthrough` so the next desktop project skips this entire thinking pass

---

## Rollback triggers per commit

| Commit | Trigger | Rollback |
|--------|---------|----------|
| A | `prisma migrate diff` produces non-applying SQL | Revert; manually craft 0_init/migration.sql by hand from schema |
| A | Json→String conversions break existing routes that destructure objects | Add `superjson` parse helper at route layer; keep schema as-is |
| B | `child_process.fork` crashes with `ENOENT` after install | Verify `extraResources.from` paths in package.json against actual `release/win-unpacked/resources/` layout; fix the from-path |
| B | better-sqlite3 native `.node` binding missing in packaged app | Use `electron-rebuild` post-install OR move `.prisma/client-sqlite` to `asarUnpack` |
| C | Self-signed cert rejected by electron-builder | Comment out the `certificateFile` block, ship unsigned for Wave 1; SmartScreen still says "Run anyway" |
| C | electron-updater 401s GitHub Releases | Confirm repo is public OR add `GH_TOKEN` env at build time for private repo |
| C | NSIS installer too big (>200MB) | Drop `portable` target; ship NSIS only |

---

## Out of scope

- DNS for `app.radixmedia.ae`
- GitHub Actions cross-platform CI builds
- macOS/Linux variants
- EV cert procurement
- AI provider key UI (settings page) — separate ticket; current behavior shows "configure API keys" message when AI calls fail
- BullMQ → in-memory queue swap (already gated by `DISABLE_BULLMQ=1` env in B2; server-side disable logic stays as a follow-up if needed)
- pgvector / RAG retrieval in desktop mode (intentionally stubbed)

---

## Total wall-time estimate

| Commit | Wall-time | Risk |
|--------|-----------|------|
| A — SQLite swap + DB selector | ~30 min | Low (Json→String is mechanical, prisma migrate diff is deterministic) |
| B — Electron forks backend | ~25 min | Medium (fork path resolution differs dev vs packaged; ready-handshake race) |
| C — Packaging + signing + auto-update | ~25 min | Medium (extraResources paths + native .node bindings + cert flow) |
| **Total** | **~80 min** | First-time-through; subsequent rebuilds are <5 min |

Aggressive cut (skip code-signing + auto-updater): -15 min → **~65 min total**.
