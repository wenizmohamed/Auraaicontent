# Redis BullMQ Orphan Cleanup + git rev-parse stderr Leak (2026-05-08)

## Summary

During a routine production audit, discovered 36 stale Redis keys under `bull:radix-jobs:*` from an abandoned BullMQ migration that never went live, plus a cosmetic stderr leak from an in-app `git rev-parse --short HEAD` call against a deployed dist that has no `.git` directory. Both fixed in-session with zero downtime.

## Timeline (UTC, today 2026-05-08)

- 17:14 — User reports "errors everywhere", debug session opens
- 17:27 — Live API health 200, frontend 200, no console errors → narrows to backend
- 17:31 — pm2 list shows radix-api online, 67 restart count → investigated
- 17:32 — pm2 error log shows only 2 lines: `git rev-parse` failure + Gemini 60s timeout → harmless
- 17:33 — Redis scan reveals `bull:radix-jobs:*` keys, 1 active (zombie 8d), 8 failed (Apr 23-28)
- 17:35 — Source grep confirms `bullmq` is NOT imported anywhere → Redis keys are orphans
- 17:42 — Cleared zombie active job (released concurrency slot)
- 17:48 — Patched `server/src/app.ts:39` to suppress git stderr in deployed dist
- 17:50 — Wiped 36 orphan `bull:radix-jobs:*` keys, radix-api still healthy

## Root cause

1. Abandoned BullMQ migration left Redis keys behind. Source code pivoted back to in-memory Map queue but no cleanup of Redis state ever ran.
2. `execSync('git rev-parse --short HEAD')` runs on Fastify boot to embed the commit SHA. The deployed dist (`/opt/radix-v2/server/dist`) has no `.git` dir, so the synchronous call throws `fatal: not a git repository` to stderr before the try/catch swallows the JS exception. Caught error returns 'unknown'; stderr line surfaces in pm2 logs as red noise.

## Fixes applied

- `server/src/app.ts:39` — added `stdio: ['ignore', 'pipe', 'ignore']` and `process.env.GIT_COMMIT` fallback. Commit pending deploy.
- `redis-cli --scan --pattern 'bull:radix-jobs:*' | xargs redis-cli DEL` — 36 keys → 0.
- Zombie active job moved to `failed` set.

## Action items

- [ ] Deploy `app.ts:39` patch via `bash scripts/deploy-backend.sh` next maintenance window
- [ ] Set `GIT_COMMIT` env var in deploy-backend.sh so version endpoint is accurate without git
- [ ] Schedule Ubuntu kernel reboot (kernel + 7 security updates pending)
- [ ] Audit deploy script for other bullmq remnants

## Lessons

- Source grep for unused libraries before assuming Redis state is live. `bull:*` keys ≠ active queue.
- pm2 restart count reflects deploy frequency, not crashes — check `unstable_restarts` + `exit_code` to distinguish.
- "Failed jobs" timestamps must be converted to absolute dates before declaring them recent.
