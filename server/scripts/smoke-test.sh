#!/bin/bash
# Senior dev smoke test — actually verify endpoints work after every deploy.
# Usage: ./smoke-test.sh

set -e
cd "$(dirname "$0")/.."

# Forge a short-lived JWT
TOK=$(node -e "
import jwt from 'jsonwebtoken';
import 'dotenv/config';
console.log(jwt.sign({ userId: 'smoke-test', email: 'smoke@radix.local' }, process.env.JWT_SECRET, { expiresIn: '5m' }));
")

BASE="http://127.0.0.1:8080"
PASS=0
FAIL=0

check() {
  local name="$1"
  local url="$2"
  local code=$(curl -s -o /tmp/smoke-body -w "%{http_code}" -H "Authorization: Bearer $TOK" "$BASE$url")
  if [ "$code" = "200" ]; then
    echo "PASS  $code  $name"
    PASS=$((PASS+1))
  else
    echo "FAIL  $code  $name  --  $(head -c 200 /tmp/smoke-body)"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Radix smoke test $(date) ==="
check "Health"                   "/api/health"
check "Providers status"         "/api/providers/status"
check "Dashboard stats"          "/api/dashboard/stats"
check "Dashboard ai-stats"       "/api/dashboard/ai-stats"
check "Dashboard insights"       "/api/dashboard/insights"
check "Dashboard activity"       "/api/dashboard/activity"
check "Clients"                  "/api/clients"
check "Assets gallery"           "/api/assets?take=3"
echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
