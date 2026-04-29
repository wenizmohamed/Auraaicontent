# Postgres restore runbook

## When to use this
- Disaster recovery (DB corrupted / wiped / wrong migration applied).
- Recreating prod state in a scratch environment for diligence.
- Sandboxing a destructive query against last night's data.

## Where backups live
- Local: `/opt/backups/radix_YYYYMMDD_HHMMSS.dump` (30-day retention via `/opt/radix-v2/scripts/backup.sh` cron).
- Off-site: `s3://$S3_BUCKET/postgres/` if `S3_BUCKET` is set in the cron env.

## Full-restore procedure

1. **Stop the API** so no writes land during restore.
   ```bash
   pm2 stop radix-api
   ```

2. **Identify the dump** to restore.
   ```bash
   ls -lht /opt/backups | head -10
   ```

3. **Take a defensive snapshot of current state** (in case the restore is wrong).
   ```bash
   /opt/radix-v2/scripts/backup.sh
   ```

4. **Drop and recreate the DB** (terminates active connections first).
   ```bash
   sudo -u postgres psql <<'EOF'
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE datname = 'radix_planner' AND pid <> pg_backend_pid();
   DROP DATABASE radix_planner;
   CREATE DATABASE radix_planner OWNER radix;
   EOF
   ```

5. **Restore from the chosen dump.**
   ```bash
   PGPASSWORD=$(grep '^DATABASE_URL=' /opt/radix-v2/server/.env | sed -E 's|^DATABASE_URL=postgresql://[^:]+:([^@]+)@.*|\1|') \
     pg_restore -U radix -h localhost -d radix_planner /opt/backups/radix_YYYYMMDD_HHMMSS.dump
   ```

6. **Verify row counts** before bringing the API back.
   ```bash
   PGPASSWORD=... psql -U radix -h localhost -d radix_planner -c '
     SELECT (SELECT COUNT(*) FROM "Organization") AS orgs,
            (SELECT COUNT(*) FROM "User") AS users,
            (SELECT COUNT(*) FROM "Client") AS clients,
            (SELECT COUNT(*) FROM "CalendarMonth") AS months,
            (SELECT COUNT(*) FROM "CalendarPost") AS posts;
   '
   ```

7. **Start the API.**
   ```bash
   pm2 start radix-api
   pm2 logs radix-api --lines 20
   ```

8. **Smoke test** with a real auth token.
   ```bash
   curl -H "Authorization: Bearer $TOKEN" https://radix.synapseai-labs.com/api/health
   curl -H "Authorization: Bearer $TOKEN" https://radix.synapseai-labs.com/api/dashboard/stats
   ```

## Restore to a scratch DB (non-destructive)
Use this for diligence walkthroughs or experimenting with a copy of prod.

```bash
sudo -u postgres psql -c "CREATE DATABASE radix_scratch OWNER radix;"
PGPASSWORD=... pg_restore -U radix -h localhost -d radix_scratch /opt/backups/radix_*.dump

# Point a side instance of the API at the scratch DB
DATABASE_URL=postgresql://radix:PASS@localhost:5432/radix_scratch \
  PORT=8081 \
  node /opt/radix-v2/server/dist/index.js
```

## Pulling a backup off-VPS
For diligence handoffs — give a buyer a snapshot to inspect.

```bash
scp root@radix.synapseai-labs.com:/opt/backups/radix_LATEST.dump ./
```

## Common failures
- **`pg_restore: error: could not execute query`** with foreign-key errors → restore order is wrong; use `pg_restore --disable-triggers`.
- **`role "radix" does not exist`** on a fresh box → `CREATE USER radix WITH PASSWORD '...' CREATEDB;`
- **Migration version mismatch** on first boot after restore → `npx prisma migrate deploy` to apply any newer migrations.
