# Postgres restore runbook

## When to use this
- Disaster recovery (DB corrupted / wiped / wrong migration applied).
- Recreating prod state in a scratch environment for diligence.
- Sandboxing a destructive query against last night's data.

## Where backups live
- Local: `/opt/backups/auracontent_YYYYMMDD_HHMMSS.dump` (30-day retention via `/opt/auracontent-v2/scripts/backup.sh` cron).
- Off-site: `s3://$S3_BUCKET/postgres/` if `S3_BUCKET` is set in the cron env.

## Full-restore procedure

1. **Stop the API** so no writes land during restore.
   ```bash
   pm2 stop auracontent-api
   ```

2. **Identify the dump** to restore.
   ```bash
   ls -lht /opt/backups | head -10
   ```

3. **Take a defensive snapshot of current state** (in case the restore is wrong).
   ```bash
   /opt/auracontent-v2/scripts/backup.sh
   ```

4. **Drop and recreate the DB** (terminates active connections first).
   ```bash
   sudo -u postgres psql <<'EOF'
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE datname = 'auracontent_planner' AND pid <> pg_backend_pid();
   DROP DATABASE auracontent_planner;
   CREATE DATABASE auracontent_planner OWNER auracontent;
   EOF
   ```

5. **Restore from the chosen dump.**
   ```bash
   PGPASSWORD=$(grep '^DATABASE_URL=' /opt/auracontent-v2/server/.env | sed -E 's|^DATABASE_URL=postgresql://[^:]+:([^@]+)@.*|\1|') \
     pg_restore -U auracontent -h localhost -d auracontent_planner /opt/backups/auracontent_YYYYMMDD_HHMMSS.dump
   ```

6. **Verify row counts** before bringing the API back.
   ```bash
   PGPASSWORD=... psql -U auracontent -h localhost -d auracontent_planner -c '
     SELECT (SELECT COUNT(*) FROM "Organization") AS orgs,
            (SELECT COUNT(*) FROM "User") AS users,
            (SELECT COUNT(*) FROM "Client") AS clients,
            (SELECT COUNT(*) FROM "CalendarMonth") AS months,
            (SELECT COUNT(*) FROM "CalendarPost") AS posts;
   '
   ```

7. **Start the API.**
   ```bash
   pm2 start auracontent-api
   pm2 logs auracontent-api --lines 20
   ```

8. **Smoke test** with a real auth token.
   ```bash
   curl -H "Authorization: Bearer $TOKEN" https://auracontnt.com/api/health
   curl -H "Authorization: Bearer $TOKEN" https://auracontnt.com/api/dashboard/stats
   ```

## Restore to a scratch DB (non-destructive)
Use this for diligence walkthroughs or experimenting with a copy of prod.

```bash
sudo -u postgres psql -c "CREATE DATABASE auracontent_scratch OWNER auracontent;"
PGPASSWORD=... pg_restore -U auracontent -h localhost -d auracontent_scratch /opt/backups/auracontent_*.dump

# Point a side instance of the API at the scratch DB
DATABASE_URL=postgresql://auracontent:PASS@localhost:5432/auracontent_scratch \
  PORT=8081 \
  node /opt/auracontent-v2/server/dist/index.js
```

## Pulling a backup off-VPS
For diligence handoffs — give a buyer a snapshot to inspect.

```bash
scp root@auracontnt.com:/opt/backups/auracontent_LATEST.dump ./
```

## Common failures
- **`pg_restore: error: could not execute query`** with foreign-key errors → restore order is wrong; use `pg_restore --disable-triggers`.
- **`role "auracontent" does not exist`** on a fresh box → `CREATE USER auracontent WITH PASSWORD '...' CREATEDB;`
- **Migration version mismatch** on first boot after restore → `npx prisma migrate deploy` to apply any newer migrations.
