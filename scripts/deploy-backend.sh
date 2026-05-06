#!/usr/bin/env bash
# Backend deploy: build /opt/radixcontent/server, sync dist + node_modules to
# the live target /opt/radix-v2/server, pm2 restart with --update-env.
#
# /opt/radixcontent is the git checkout (single source of truth).
# /opt/radix-v2 is the live target — pm2 runs from there.
#
# Run on the VPS as root (or via SSH):
#   ssh -i ~/.ssh/radix_vps root@187.77.158.177 'bash /opt/radixcontent/scripts/deploy-backend.sh'
#
# Flags:
#   --skip-pull      Don't run git pull (use this when you've already pulled)
#   --skip-install   Don't reinstall node_modules (use when package-lock unchanged)
#   --skip-build     Don't run tsc (use when re-syncing an existing dist)
#   --sync-env       Also copy .env from radixcontent to radix-v2 (DANGEROUS —
#                    will OVERWRITE the live env including site-specific vars
#                    like FIRECRAWL_API_KEY, STAFF_EMAILS, TEAM_ADMIN_EMAILS).
#                    Default off — env is managed manually on the live target.

set -euo pipefail

SOURCE=/opt/radixcontent
TARGET=/opt/radix-v2
PM2_NAME=radix-api

DO_PULL=1
DO_INSTALL=1
DO_BUILD=1
SYNC_ENV=0

for arg in "$@"; do
  case "$arg" in
    --skip-pull)    DO_PULL=0 ;;
    --skip-install) DO_INSTALL=0 ;;
    --skip-build)   DO_BUILD=0 ;;
    --sync-env)     SYNC_ENV=1 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

echo "=== Radix backend deploy — $(date) ==="

if [ "$DO_PULL" = "1" ]; then
  echo "--- git pull ---"
  cd "$SOURCE"
  git fetch origin v2-migration
  git pull --ff-only origin v2-migration
  git log --oneline -1
fi

cd "$SOURCE/server"

if [ "$DO_INSTALL" = "1" ]; then
  # Install with dev deps — tsc needs @types/* and TypeScript itself.
  # We prune to production after the build succeeds.
  echo "--- npm install (with dev deps for build) ---"
  npm install --prefer-offline --no-audit
fi

if [ "$DO_BUILD" = "1" ]; then
  echo "--- npm run build (tsc) ---"
  npm run build
fi

if [ "$DO_INSTALL" = "1" ]; then
  echo "--- pruning dev deps post-build ---"
  npm prune --omit=dev
fi

echo "--- rsync dist/ to live ---"
rsync -a --delete "$SOURCE/server/dist/" "$TARGET/server/dist/"

echo "--- rsync node_modules/ to live (no --delete; preserves any patched deps) ---"
rsync -a "$SOURCE/server/node_modules/" "$TARGET/server/node_modules/"

if [ "$SYNC_ENV" = "1" ]; then
  echo "--- syncing .env (DESTRUCTIVE) ---"
  cp "$TARGET/server/.env" "$TARGET/server/.env.bak-$(date +%s)"
  cp "$SOURCE/server/.env" "$TARGET/server/.env"
fi

echo "--- pm2 restart --update-env ---"
pm2 restart "$PM2_NAME" --update-env

# Give the process a moment to come up and bind, then verify health.
sleep 3
echo "--- verify health ---"
curl -sS http://localhost:8080/api/health \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("status:", d.get("status"), "version:", d.get("version"))' \
  || { echo "FAIL: health check did not return ok"; exit 1; }

echo "--- verify env loaded ---"
curl -sS http://localhost:8080/api/health/details \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("processStart:", d.get("processStart")); fp=d.get("envFingerprints",{}); print("gemini_fp:", fp.get("GEMINI_API_KEY")); print("xai_fp:", fp.get("XAI_API_KEY")); print("timeouts:", d.get("timeouts"))'

echo
echo "=== deploy OK — pm2 list ==="
pm2 list 2>&1 | grep -E "$PM2_NAME|online|errored"
