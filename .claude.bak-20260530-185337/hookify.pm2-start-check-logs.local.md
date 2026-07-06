---
name: pm2-start-check-logs
enabled: true
event: bash
pattern: pm2\s+start\s+
action: warn
---

## After `pm2 start`: CHECK THE LOGS

You just started a PM2 process. **Before running any tests or claiming success**, run:

```bash
pm2 logs <name> --lines 10 --nostream
```

**Why this matters:**
- `pm2 start` does NOT fail when the process crashes immediately after startup
- PM2 will show the process as "online" even if it died from EADDRINUSE, missing env vars, syntax errors, etc.
- If the old process is still bound to the port, your new process silently dies and the OLD binary keeps serving requests
- You will test against stale code and waste significant time chasing phantom bugs

**Session lesson (2026-04-09):**
Spent ~30min cycling through 4 different Fastify parser approaches because each `pm2 start` silently failed with `EADDRINUSE`. All 4 approaches actually worked — I was testing against the old binary the entire time. One `pm2 logs` call would have saved 30 minutes.

**Required next step:**
1. `pm2 logs <name> --lines 10 --nostream` — confirm no errors
2. `pm2 list` — confirm uptime > 3s and status is online
3. Only then run curl/smoke tests
