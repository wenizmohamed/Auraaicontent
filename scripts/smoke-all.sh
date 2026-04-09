#!/usr/bin/env bash
# Pre-meeting smoke test — run this before any demo
# Usage: ./scripts/smoke-all.sh [local|vps|both]
set -euo pipefail

MODE=${1:-both}
LOCAL="http://localhost:8080"
VPS="https://srv1494206.hstgr.cloud"
EMAIL="mohamed@radixmedia.ae"
PASS="Radix2026"
PASS_COUNT=0
FAIL_COUNT=0

pass() { echo "  PASS: $1"; PASS_COUNT=$((PASS_COUNT+1)); }
fail() { echo "  FAIL: $1"; FAIL_COUNT=$((FAIL_COUNT+1)); }

test_surface() {
  local BASE=$1
  local LABEL=$2
  echo ""
  echo "=== $LABEL ($BASE) ==="

  # 1. Health
  H=$(curl -sf "$BASE/api/health" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "DOWN")
  [ "$H" = "ok" ] && pass "$LABEL health" || { fail "$LABEL health — backend DOWN"; return; }

  # 2. Health details
  curl -sf "$BASE/api/health/details" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'  processStart: {d[\"processStart\"]}')
print(f'  gemini_fp: {d[\"envFingerprints\"][\"GEMINI_API_KEY\"]}')
print(f'  xai_fp: {d[\"envFingerprints\"][\"XAI_API_KEY\"]}')
print(f'  routing: {d[\"routing\"][\"AI_TEXT_PRIMARY\"]}/{d[\"routing\"][\"AI_IMAGE_PRIMARY\"]}')
" 2>/dev/null && pass "$LABEL health/details" || fail "$LABEL health/details"

  # 3. Auth
  TOKEN=$(curl -sf -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null)
  [ -n "$TOKEN" ] && pass "$LABEL auth" || { fail "$LABEL auth"; return; }

  # 4. Clients
  CLIENT=$(curl -sf "$BASE/api/clients" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys,json; c=json.load(sys.stdin); print(c[0]['id'] if c else 'NONE')" 2>/dev/null)
  [ "$CLIENT" != "NONE" ] && [ -n "$CLIENT" ] && pass "$LABEL clients" || { fail "$LABEL clients"; return; }

  # 5. Brief
  curl -sf -X PUT "$BASE/api/clients/$CLIENT/brief" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"objective":"Smoke","audience":"QA","tone":"Pro","brandDo":"Y","brandDont":"N","products":["X"],"pillars":["Y"],"campaignMoments":[],"channels":["Instagram"],"approvers":[]}' >/dev/null 2>&1
  SCORE=$(curl -sf "$BASE/api/clients/$CLIENT/brief/completeness" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['score'])" 2>/dev/null)
  [ "$SCORE" = "100" ] && pass "$LABEL brief (${SCORE}%)" || fail "$LABEL brief (${SCORE}%)"

  # 6. Delete + Generate
  MONTH="Smoke $(date +%s)"
  curl -sf -X DELETE "$BASE/api/clients/$CLIENT/calendar/$(python3 -c "import urllib.parse; print(urllib.parse.quote('$MONTH'))")" \
    -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true

  JOB=$(curl -sf -X POST "$BASE/api/clients/$CLIENT/calendar/generate" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"month\":\"$MONTH\",\"pieceCount\":2}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('jobId',d.get('error','')))" 2>/dev/null)

  if [ -z "$JOB" ] || echo "$JOB" | grep -qi "error\|fail"; then
    fail "$LABEL generate: $JOB"; return
  fi

  for i in $(seq 1 40); do
    sleep 5
    S=$(curl -sf "$BASE/api/jobs/$JOB" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)
    if [ "$S" = "completed" ]; then
      META=$(curl -sf "$BASE/api/jobs/$JOB" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys,json; r=json.load(sys.stdin).get('result',{})
print(f'{r.get(\"provider\",\"?\")}/{r.get(\"model\",\"?\")} {r.get(\"latencyMs\",\"?\")}ms fb={r.get(\"fallbackUsed\",\"?\")}')
" 2>/dev/null)
      pass "$LABEL generate ($META)"
      break
    elif [ "$S" = "failed" ]; then
      ERR=$(curl -sf "$BASE/api/jobs/$JOB" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','?')[:60])" 2>/dev/null)
      fail "$LABEL generate: $ERR"
      break
    fi
  done
}

echo "======================================="
echo "RADIX SMOKE TEST — $(date)"
echo "======================================="

if [ "$MODE" = "local" ] || [ "$MODE" = "both" ]; then
  # Check frontend
  FE=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000")
  [ "$FE" = "200" ] && pass "Frontend (localhost:3000)" || fail "Frontend DOWN"

  test_surface "$LOCAL" "LOCAL"
fi

if [ "$MODE" = "vps" ] || [ "$MODE" = "both" ]; then
  FE=$(curl -sf -o /dev/null -w "%{http_code}" "$VPS" 2>/dev/null || echo "000")
  [ "$FE" = "200" ] && pass "VPS Frontend" || fail "VPS Frontend DOWN"

  test_surface "$VPS" "VPS"
fi

echo ""
echo "======================================="
echo "RESULTS: $PASS_COUNT passed, $FAIL_COUNT failed"
echo "======================================="
[ $FAIL_COUNT -eq 0 ] && echo "ALL GREEN" || echo "FAILURES DETECTED"
exit $FAIL_COUNT
