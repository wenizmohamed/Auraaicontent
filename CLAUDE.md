# Radix AI Content Planner — Repo Operating Protocol

Read this before touching anything. This repo is worked by **two Claude Code
instances** and they collide if they ignore the rules below.

## The two hands

1. **VPS-resident Claude Code** — runs on the Hostinger VPS (`187.77.158.177`,
   "Ubuntu 24.04 with Claude Code"), cwd `/opt/radixcontent`. Commits as author `root`.
2. **Windows-side Claude Code** — runs on the operator's machine, edits this repo
   over SSH or a local clone.

Assume the other hand has committed since you last looked. Never assume your
local tree is current.

## Branch

- The only working branch is **`v2-migration`**. Never commit to `main`, never
  create stray branches without being told to.

## Git discipline — the orphan-prevention rules

These exist because of a real incident: `server/src/app.ts` imported
`./routes/brand-kit.js` and `App.tsx` lazy-imported `./pages/BrandKit`, both
commits landed, but `brand-kit.ts` and `BrandKit.tsx` were never `git add`ed.
Origin's build was broken for ~a week; the VPS only kept running because pm2
served a stale `dist/`. Do not repeat this.

1. **Pull first.** Before any work: `git pull --ff-only origin v2-migration`.
   If it will not fast-forward, STOP and reconcile — never force, never
   `reset --hard` without explicit human OK.
2. **Stage every file your code references.** Before committing, run
   `git status --porcelain --untracked-files=all`. If you `import` / `register`
   / `lazy(() => import())` a file, that file MUST be in the commit. An import
   without its target file is a build-breaking landmine for the other hand.
3. **Build before you commit.**
   - Server change → `cd server && npm run build` must pass.
   - Frontend change → `cd apps/desktop && npm run build` must pass.
   - A commit that does not build must not be pushed.
4. **Push immediately after committing.** `git push origin v2-migration`.
   Never leave local commits unpushed — the other hand will diverge.
5. **No rotting WIP.** Don't leave modified files sitting uncommitted for days.
   Commit it, stash it, or discard it.
6. **No `.bak` cruft.** Stop creating `*.bak-<timestamp>` files — git IS the
   backup. Never `git add` a `.bak` file. The repo is already littered with them.
7. **Never commit `.env`.** `server/.env` holds live secrets. It is gitignored;
   keep it that way. Never overwrite the VPS `.env` files blindly.

## Deploy architecture — two checkouts, do not confuse them

- `/opt/radixcontent` — the **git checkout**. Edit and build here.
- `/opt/radix-v2/server/dist` + `/opt/radix-v2/frontend/dist` — what is **actually
  served**. pm2 process `radix-api` runs from `/opt/radix-v2`. nginx serves the
  frontend dist. Public domain: `radix.synapseai-labs.com`.

Deploy steps:
- **Backend:** `bash scripts/deploy-backend.sh` (pull → npm install → build →
  rsync dist → pm2 restart → health check). Never hand-copy dist files.
- **Frontend:** `cd apps/desktop && npm run build && rsync -a --delete dist/ /opt/radix-v2/frontend/dist/`

## Verify before claiming — non-negotiable

"deployed" / "fixed" / "done" / "live" require fresh command output proving it,
in the same turn:
- After a deploy, `curl -s https://radix.synapseai-labs.com/api/health` must
  return `{"status":"ok",...}`.
- After a build, the build command must have exited 0.
- After an endpoint fix, hit the endpoint and show the HTTP code.

`/api/health/details` is auth-gated — it needs a Bearer token; plain
`/api/health` is public.

The `.claude/hookify.*.local.md` rules already enforce parts of this
(`curl-verify-server-first`, `vps-deploy-smoke-first`,
`pm2-start-check-logs`, `stop-retrying-same-fix`). Follow them, don't fight them.

## Known pre-existing state

- `server` tsc reports a large number of Prisma schema-drift type errors. They
  are pre-existing and tolerated — `npm run build` still emits. Do NOT treat
  them as your regression; only care about NEW errors your change introduces.
- The repo has accumulated `.bak` files and an uncommitted WIP pile in the
  working tree. Don't sweep unrelated WIP into your commits — stage by filename.

## Sync etiquette

Push small and often so the other hand can pull cleanly. Don't sit on a large
uncommitted pile. If you start something big, say so in the commit early.
