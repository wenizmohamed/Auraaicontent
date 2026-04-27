# Secrets Rotation Runbook

## JWT_SECRET (Authorization-header signing key)

**When**
- Annually as a baseline.
- Immediately on any suspected compromise (leaked log line, ex-employee, lost laptop).

**Effect**
- All active sessions invalidated. Users must re-login.
- All RefreshTokens marked `revokedAt = NOW()` so refresh flow forces re-auth.

**Procedure**

```bash
./scripts/rotate-jwt.sh
```

The script is atomic + idempotent + forward-only:
1. Generates a 64+ char base64 secret via `openssl rand -base64 48`.
2. Backs up the current `.env` to `.env.bak.<unix-ts>` on the VPS.
3. Atomic `sed -i.tmp` replace of the `JWT_SECRET=` line.
4. Verifies post-rotation length ≥ 64; aborts if not.
5. `UPDATE RefreshToken SET revokedAt = NOW()` to invalidate all refresh flows.
6. `pm2 reload radix-api --update-env` so the new env is hot-loaded with no downtime.

**Never**
- Restore a prior JWT_SECRET. Forward-rotate to a third secret on failure.
- Run this from a non-deploy machine without `~/.ssh/radix_vps` configured.

**Post-rotation smoke test**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" \
  -d '{"email":"demo-admin@radix.local","password":"demoAdmin2026!"}' \
  https://srv1494206.hstgr.cloud/api/auth/login
```

Expected: `200`. If `500`, the new secret didn't propagate — check `pm2 logs radix-api --err --lines 50`.

---

## DB_PASSWORD

**When:** annual; on suspected compromise; when a contractor with DB access leaves.

**Procedure**

1. Generate new password: `openssl rand -base64 32 | tr -d '/='`.
2. SSH to VPS:

   ```bash
   ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud "
     sudo -u postgres psql -c \"ALTER USER radix WITH PASSWORD '<new>';\"
     sed -i 's|^DB_PASSWORD=.*|DB_PASSWORD=<new>|' /opt/radix-v2/server/.env
     sed -i 's|^DATABASE_URL=postgres://radix:[^@]*@|DATABASE_URL=postgres://radix:<new>@|' /opt/radix-v2/server/.env
     pm2 reload radix-api --update-env
   "
   ```

3. Smoke: `curl https://srv1494206.hstgr.cloud/api/health` → 200.

---

## GEMINI_API_KEY / XAI_API_KEY / MOONSHOT_API_KEY

**When:** annual; on quota anomaly; when a contractor leaves.

**Procedure**

1. Rotate via the provider dashboard (console.cloud.google.com / x.ai / platform.moonshot.cn).
2. Replace in `/opt/radix-v2/server/.env` via `sed -i`.
3. `pm2 reload radix-api --update-env`.
4. Smoke: hit `/api/providers/status` → returns `configured: true` for the rotated provider.

---

## .env file mode + ownership

The `.env` file should be readable only by the radix process owner:

```bash
ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud '
  chown radix:radix /opt/radix-v2/server/.env || chown root:root /opt/radix-v2/server/.env
  chmod 600 /opt/radix-v2/server/.env
  ls -la /opt/radix-v2/server/.env
'
```

Expected: `-rw------- 1 <owner> <owner> ... .env` (mode 600).

If pm2 runs as root (default for Hostinger VPS), `chown root:root` is the right ownership.

---

## Audit trail

Each rotation should be logged in `docs/runbooks/secrets-rotation.log` with:
- Date, secret rotated, operator, reason.

Format:
```
2026-04-27  JWT_SECRET     wenim   annual + acceptance criteria S1
```
