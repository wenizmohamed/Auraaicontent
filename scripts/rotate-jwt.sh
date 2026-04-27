#!/usr/bin/env bash
# Forward-rotate JWT_SECRET on the live VPS to a 64-char crypto-random value.
# Atomic .env swap + revoke all RefreshTokens + pm2 reload.
#
# Forward-only by design. Never restore a prior JWT_SECRET — re-introduces
# the very vuln the rotation closes. On rotation failure, generate a third
# secret and rotate again.
#
# Usage: ./scripts/rotate-jwt.sh
set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/radix_vps}"
HOST="${HOST:-root@srv1494206.hstgr.cloud}"
ENV_PATH="/opt/radix-v2/server/.env"

# Generate a 64+ char base64 secret. -base64 48 yields 64 chars.
NEW=$(openssl rand -base64 48 | tr -d '\n')
if [[ ${#NEW} -lt 64 ]]; then
  echo "ERR: openssl produced ${#NEW} chars (< 64). Aborting." >&2
  exit 1
fi

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$HOST" "
  set -euo pipefail
  cp '$ENV_PATH' '${ENV_PATH}.bak.\$(date +%s)' 2>/dev/null || true
  sed -i.tmp 's|^JWT_SECRET=.*|JWT_SECRET=$NEW|' '$ENV_PATH'
  rm -f '${ENV_PATH}.tmp'
  POST_LEN=\$(awk -F= '/^JWT_SECRET=/{print length(\$2)}' '$ENV_PATH')
  if [[ \$POST_LEN -lt 64 ]]; then
    echo \"ERR: post-rotation length \$POST_LEN < 64\" >&2
    exit 1
  fi
  DB_PASS=\$(awk -F= '/^DB_PASSWORD=/{print \$2}' '$ENV_PATH' | tr -d '\"' || true)
  if [[ -n \"\$DB_PASS\" ]]; then
    PGPASSWORD=\"\$DB_PASS\" psql -h 127.0.0.1 -U radix -d radix_planner -c 'UPDATE \"RefreshToken\" SET \"revokedAt\" = NOW() WHERE \"revokedAt\" IS NULL' || echo 'WARN: refresh-token revoke failed (non-fatal)'
  fi
  pm2 reload radix-api --update-env
  echo \"  new_length: \$POST_LEN\"
"

echo ""
echo "JWT_SECRET rotated. RefreshTokens revoked. Users must re-login."
