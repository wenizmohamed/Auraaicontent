#!/usr/bin/env bash
# VPS-side daily Postgres dump.
# Deployed to /opt/auracontent-v2/scripts/backup.sh on the VPS, run from cron @ 03:00.
# Retains 14 days of dumps; older ones auto-purged.
set -euo pipefail

DEST=/opt/auracontent-v2/backups
mkdir -p "$DEST"

DATE=$(date +%F)
ENV_FILE=/opt/auracontent-v2/server/.env

# Extract DB password from DATABASE_URL in .env (format
# postgres://auracontent:PASSWORD@127.0.0.1:5432/auracontent_planner) without sourcing
# the whole file — keeps blast radius tight.
DB_URL=$(awk -F= '/^DATABASE_URL=/{ sub(/^DATABASE_URL=/, ""); print }' "$ENV_FILE" | tr -d '"')
DB_PASS=$(printf '%s' "$DB_URL" | sed -E 's|^postgres(ql)?://[^:]+:([^@]+)@.*$|\2|')

if [[ -z "$DB_PASS" || "$DB_PASS" == "$DB_URL" ]]; then
  echo "ERR: could not parse password from DATABASE_URL in $ENV_FILE" >&2
  exit 1
fi

PGPASSWORD="$DB_PASS" pg_dump -h 127.0.0.1 -U auracontent auracontent_planner | gzip > "$DEST/${DATE}.sql.gz"

# Retention: 14 days
find "$DEST" -name '*.sql.gz' -mtime +14 -delete

echo "✓ backup complete: $DEST/${DATE}.sql.gz ($(du -h "$DEST/${DATE}.sql.gz" | cut -f1))"
