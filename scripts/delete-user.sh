#!/usr/bin/env bash
# GDPR data-subject deletion. Cascades User → RefreshToken / AuditLog /
# AgentSession / PostComment in a single transaction.
# Usage: ./scripts/delete-user.sh <userId>
#
# Demo-tested against demo-member; reseed via `node dist/prisma/seed.js` afterward.
set -euo pipefail

USER_ID="${1:-}"
if [[ -z "$USER_ID" ]]; then
  echo "usage: $0 <userId>" >&2
  exit 2
fi

SSH_KEY="${SSH_KEY:-$HOME/.ssh/radix_vps}"
HOST="${HOST:-root@srv1494206.hstgr.cloud}"

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$HOST" "
  set -euo pipefail
  ENV_FILE=/opt/radix-v2/server/.env
  DB_URL=\$(awk -F= '/^DATABASE_URL=/{ sub(/^DATABASE_URL=/, \"\"); print }' \"\$ENV_FILE\" | tr -d '\"')
  DB_PASS=\$(printf '%s' \"\$DB_URL\" | sed -E 's|^postgres(ql)?://[^:]+:([^@]+)@.*$|\\2|')
  PGPASSWORD=\"\$DB_PASS\" psql -h 127.0.0.1 -U radix -d radix_planner <<EOF
BEGIN;
DELETE FROM \"RefreshToken\" WHERE \"userId\" = '$USER_ID';
DELETE FROM \"AuditLog\" WHERE \"userId\" = '$USER_ID';
DELETE FROM \"AgentSession\" WHERE \"userId\" = '$USER_ID';
DELETE FROM \"PostComment\" WHERE \"authorId\" = '$USER_ID';
DELETE FROM \"User\" WHERE id = '$USER_ID';
COMMIT;
EOF
"

echo "✓ User $USER_ID purged"
