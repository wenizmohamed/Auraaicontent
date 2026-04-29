# On-call runbook

Single-tenant production today; multi-tenant production after Phase 1 deploy. This runbook is what you read at 03:00 when something is on fire.

## Quick triage matrix

| Symptom | First check | Most likely cause |
|---|---|---|
| Site returns 502 | `pm2 list` | radix-api crashed |
| Site returns 504 | `pm2 logs radix-api` for AI provider timeouts | Gemini/xAI hard-down |
| Login fails for everyone | `pm2 logs radix-api` for Prisma errors | Postgres down or migration drift |
| Login fails for one user | Check `/api/auth/me` 401 vs 403 | Org membership missing |
| `npm test` red | `npm test -- tenancy.spec.ts` | Cross-tenant leak — STOP and investigate |
| Stripe webhook silent | Stripe Dashboard → Webhooks → recent attempts | `STRIPE_WEBHOOK_SECRET` mismatch or 502 from `/api/billing/webhook` |
| AI cost exploding | `/api/admin/metrics` `monthAiCostUsd` | A worker stuck in retry loop OR provider price changed (update `lib/ai-pricing.ts`) |

## Service inventory

| Service | Manager | Port | Logs |
|---|---|---|---|
| radix-api | PM2 | 8080 | `pm2 logs radix-api` |
| ask-api | PM2 | 4001 | `pm2 logs ask-api` |
| PostgreSQL | systemd | 5432 | `journalctl -u postgresql` |
| Redis | systemd | 6379 | `journalctl -u redis-server` |
| nginx | systemd | 80/443 | `journalctl -u nginx`, `/var/log/nginx/error.log` |

## Restart procedures

**Soft restart (preferred):**
```bash
pm2 restart radix-api
pm2 logs radix-api --lines 30
```

**Hard restart (config / env changed):**
```bash
pm2 restart radix-api --update-env
```

**Full deploy:**
```bash
cd /opt/radix-v2/server && npm run build && pm2 restart radix-api --update-env
```

**Frontend deploy:**
```bash
cp -r /opt/radix-v2/frontend/dist /opt/radix-v2/frontend/dist.bak-$(date +%s)
cd /opt/radixcontent/apps/desktop && ELECTRON=true npx vite build
rm -rf /opt/radix-v2/frontend/dist && cp -r /opt/radixcontent/apps/desktop/dist /opt/radix-v2/frontend/dist
```

## Diagnostic commands

```bash
# Health endpoints
curl -s https://radix.synapseai-labs.com/api/health
curl -s https://radix.synapseai-labs.com/api/providers/status | jq

# Tenant-scoped data (forge a JWT first)
node -e "console.log(require('jsonwebtoken').sign({userId:'X',email:'Y',role:'member',orgId:'Z',orgRole:'OWNER'}, process.env.JWT_SECRET, {expiresIn:'1h'}))"

# DB row counts (sanity check)
PGPASSWORD=... psql -U radix -h localhost -d radix_planner -c '
  SELECT (SELECT COUNT(*) FROM "Organization") orgs,
         (SELECT COUNT(*) FROM "User") users,
         (SELECT COUNT(*) FROM "Client") clients,
         (SELECT COUNT(*) FROM "CalendarMonth") months,
         (SELECT COUNT(*) FROM "UsageEvent") usage;
'

# Disk + memory
df -h /opt
free -h

# AI telemetry (in-memory ring; lost on restart)
curl -H "Authorization: Bearer $TOK" https://radix.synapseai-labs.com/api/dashboard/ai-stats | jq '.providers'
```

## Multi-tenancy emergencies

**Suspected cross-tenant data leak:**
1. Switch tenant guard to throw mode immediately:
   ```bash
   sed -i 's/^RADIX_TENANT_GUARD=.*/RADIX_TENANT_GUARD=throw/' /opt/radix-v2/server/.env
   pm2 restart radix-api --update-env
   ```
2. Watch `pm2 logs radix-api` for `[tenant-guard]` errors — each one is an unscoped query that needs fixing.
3. If the leak is confirmed in the audit log, page Weni and freeze the affected org's data with `UPDATE "Organization" SET "status" = 'frozen' WHERE "id" = '...';`.

**Stuck migration:**
```bash
cd /opt/radix-v2/server
npx prisma migrate status              # what's pending vs applied
npx prisma migrate resolve --applied 20260429140000_multi_tenancy_orgid  # last resort: mark as applied without running
```

## Escalation
- Tier 1 (you): try the quick-triage matrix above
- Tier 2: page Weni
- Tier 3 (Postgres-level recovery): page Weni + reference `docs/ops/RESTORE.md`
