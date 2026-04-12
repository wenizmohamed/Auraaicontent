---
name: curl-verify-server-first
enabled: true
event: bash
pattern: curl\s+.*localhost:(8080|3000)
action: warn
---

## Testing against localhost?

Before trusting the response, verify the server you're testing is actually the fresh one:

```bash
# Check the PID that's listening on the port
netstat -ano | grep ":8080.*LISTEN" | awk '{print $5}'

# Compare to what pm2 thinks is running
pm2 list
```

**If the PID doesn't match, you're testing a stale process.**

**Symptoms of testing stale code:**
- Code change "didn't work" but curl still returns the old error/response
- Same test fails identically 3+ times with the same error
- `pm2 restart` reports success but behavior doesn't change
- The error message is suspiciously unchanged across different fix attempts

**Required fix:**
```bash
pm2 delete <name>
# Kill anything still on the port
netstat -ano | grep ":8080.*LISTEN" | awk '{print $5}' | xargs -I {} taskkill //PID {} //F
pm2 start <path> --name <name>
pm2 logs <name> --lines 10 --nostream   # MUST check
```
