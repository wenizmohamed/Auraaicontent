---
name: vps-deploy-smoke-first
enabled: true
event: bash
pattern: scp\s+.*hstgr|ssh\s+.*hstgr|git\s+push\s+.*main
action: warn
---

## Deploying to VPS? Smoke test locally first.

Before pushing code or deploying artifacts to VPS, confirm the change works locally:

```bash
# Verify local smoke passes
bash scripts/smoke-meeting.sh
```

**Or at minimum:**
- Local backend returns 200 on `/api/health`
- The specific endpoint you changed responds as expected (curl test)
- The frontend build compiles without errors (`vite build`)
- PM2 logs show no startup errors

**Why this matters:**
- VPS deploys are harder to roll back than local edits
- A broken local build = broken VPS build
- The meeting demo runs on VPS — a bad deploy right before means embarrassment
- Testing locally takes 30 seconds; fixing a broken VPS under pressure takes 30 minutes

**Exception:** Pure frontend asset deploy (new static files to an already-working server) where you've already verified locally in this session.

**Required after deploy:**
1. `curl https://srv1494206.hstgr.cloud/api/health` → 200
2. `curl https://srv1494206.hstgr.cloud` → 200
3. Run `smoke-meeting.sh` for full 9-lane verification
