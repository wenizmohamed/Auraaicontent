---
name: stop-retrying-same-fix
enabled: true
event: all
pattern: FST_ERR_CTP_EMPTY_JSON_BODY|Bad Request.*400|still\s+fail|still\s+not\s+work
action: warn
---

## STOP. Same error appeared again.

If you've seen this exact error before in this session, **do not try another fix**. The error is not the problem — your diagnosis is.

**Anti-loop protocol:**
1. **STOP** trying new approaches
2. **VERIFY** the environment:
   - Is the process you're testing actually the one you just modified?
   - Is the code change actually compiled/deployed?
   - Are you hitting the right port / URL / binary?
3. **DIAGNOSE** root cause before any more attempts:
   - Read the logs (pm2 logs, server logs, network logs)
   - Check process PIDs
   - Confirm env vars are loaded
   - Dump the actual response headers, not just the body

**Session lesson (2026-04-09):**
I tried 4 different Fastify parser approaches to fix `FST_ERR_CTP_EMPTY_JSON_BODY`. All 4 were correct. The problem was the new server kept crashing on startup with EADDRINUSE, and I was testing against the old binary. One `pm2 logs` call after the FIRST failed test would have revealed this.

**Rule:** After 2 failed attempts with the same error, the next step is NEVER another code fix. The next step is verification of the environment.
