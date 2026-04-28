#!/usr/bin/env bash
# End-to-end deploy: build → tar-pipe frontend + server → npm install --omit=dev
# → prisma generate → prisma migrate deploy → pm2 reload → smoke against live VPS.
# Idempotent. DRY_RUN=1 prints commands without executing.
set -euo pipefail

DRY_RUN="${DRY_RUN:-}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/radix_vps}"
HOST="${HOST:-root@srv1494206.hstgr.cloud}"
ROOT="${ROOT:-/opt/radix-v2}"
SMOKE_URL="${SMOKE_URL:-https://srv1494206.hstgr.cloud}"

run() {
  echo "+ $*"
  if [[ -z "$DRY_RUN" ]]; then "$@"; fi
}
sshrun() {
  echo "+ ssh $HOST -- $*"
  if [[ -z "$DRY_RUN" ]]; then ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$HOST" "$*"; fi
}

cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

echo "=== Build frontend ==="
run bash -c "cd '$PROJECT_ROOT/apps/desktop' && npm run build"

echo ""
echo "=== Build server ==="
run bash -c "cd '$PROJECT_ROOT/server' && npm run build"

echo ""
echo "=== Tar-pipe frontend dist → VPS ==="
if [[ -z "$DRY_RUN" ]]; then
  cd "$PROJECT_ROOT/apps/desktop" && \
    tar -czf - -C dist . | \
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$HOST" \
      "cd $ROOT/frontend && rm -rf dist.tmp && mkdir dist.tmp && cd dist.tmp && tar -xzf - && cd .. && rm -rf dist && mv dist.tmp dist"
fi

echo ""
echo "=== Tar-pipe server (excl. node_modules, test) → VPS ==="
if [[ -z "$DRY_RUN" ]]; then
  cd "$PROJECT_ROOT/server" && \
    tar --exclude='node_modules' --exclude='dist/test*' -czf - dist package.json package-lock.json prisma/schema.prisma prisma/migrations | \
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$HOST" "cd $ROOT/server && tar -xzf -"
fi

echo ""
echo "=== npm install (production) ==="
sshrun "cd $ROOT/server && npm install --omit=dev --silent"

echo ""
echo "=== Prisma generate ==="
sshrun "cd $ROOT/server && npx prisma generate"

echo ""
echo "=== Prisma migrate deploy ==="
sshrun "cd $ROOT/server && npx prisma migrate deploy"

echo ""
echo "=== pm2 reload (zero-downtime) ==="
sshrun "pm2 reload radix-api --update-env"

echo ""
echo "=== Smoke against $SMOKE_URL ==="
if [[ -z "$DRY_RUN" ]]; then
  sleep 3
  cd "$PROJECT_ROOT/server"
  if SMOKE_BASE_URL="$SMOKE_URL" npx vitest run | tee /tmp/radix-smoke-output.txt; then
    if grep -qE "Tests +[0-9]+ passed" /tmp/radix-smoke-output.txt; then
      echo "✓ Deploy complete + smoke green"
    else
      echo "✗ smoke parse failed (no 'Tests N passed' line)" >&2
      exit 1
    fi
  else
    echo "✗ smoke failed" >&2
    exit 1
  fi
else
  echo "  (dry-run: skipping smoke)"
fi
