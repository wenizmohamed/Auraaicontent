#!/usr/bin/env bash
# Pre-meeting smoke — tests all lanes, writes to ops/DEBUG_LOG.md
# Usage: ./scripts/smoke-meeting.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$REPO_ROOT/ops/DEBUG_LOG.md"
LOCAL="http://localhost:8080"
VPS="https://srv1494206.hstgr.cloud"
EMAIL="mohamed@radixmedia.ae"
PASS="Radix2026"
COMMIT=$(cd "$REPO_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo "?")
BRANCH=$(cd "$REPO_ROOT" && git branch --show-current 2>/dev/null || echo "?")
TS=$(date +"%Y-%m-%d %H:%M:%S")
PASS_N=0; FAIL_N=0; RESULTS=""

pass() { PASS_N=$((PASS_N+1)); RESULTS="$RESULTS\n| $1 | $2 | PASS |"; echo "  PASS: $1 ($2)"; }
fail() { FAIL_N=$((FAIL_N+1)); RESULTS="$RESULTS\n| $1 | $2 | FAIL |"; echo "  FAIL: $1 ($2)"; }

echo "======================================="
echo "PRE-MEETING SMOKE — $TS"
echo "Branch: $BRANCH @ $COMMIT"
echo "======================================="

# Step 0: Runtime fingerprints
echo ""
echo "--- Runtime Fingerprints ---"
bash "$REPO_ROOT/scripts/debug-lanes.sh" 2>/dev/null | tail -1

# Step 1: Local backend
echo ""
echo "--- Local Backend ---"
H=$(curl -sf "$LOCAL/api/health" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "down")
[ "$H" = "ok" ] && pass "local_backend" "health" || fail "local_backend" "health"

# Step 2: Local web
echo ""
echo "--- Local Web ---"
FE=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000")
[ "$FE" = "200" ] && pass "local_web" "frontend loads" || fail "local_web" "frontend loads"

# Step 3: Desktop
echo ""
echo "--- Desktop ---"
EC=$(tasklist 2>/dev/null | grep -c electron.exe 2>/dev/null) || EC=0
EC=${EC:-0}
[ "$EC" -gt "0" ] && pass "desktop" "$EC processes" || fail "desktop" "not running"

# Step 4: VPS
echo ""
echo "--- VPS ---"
VH=$(curl -sf "$VPS/api/health" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "down")
[ "$VH" = "ok" ] && pass "vps_backend" "health" || fail "vps_backend" "health"
VF=$(curl -sf -o /dev/null -w "%{http_code}" "$VPS" 2>/dev/null || echo "000")
[ "$VF" = "200" ] && pass "vps_frontend" "loads" || fail "vps_frontend" "loads"

# Step 5: Local generate
echo ""
echo "--- Local Generate ---"
TOKEN=$(curl -sf -X POST "$LOCAL/api/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  fail "local_backend" "auth"
else
  pass "local_backend" "auth"
  CLIENT=$(curl -sf "$LOCAL/api/clients" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; c=json.load(sys.stdin); print(c[0]['id'] if c else '')" 2>/dev/null)
  MONTH="Smoke $(date +%s)"
  JOB=$(curl -sf -X POST "$LOCAL/api/clients/$CLIENT/calendar/generate" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"month\":\"$MONTH\",\"pieceCount\":2}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('jobId',d.get('error','')))" 2>/dev/null)
  if echo "$JOB" | grep -qE "^[0-9a-f-]+$"; then
    for i in $(seq 1 30); do
      sleep 5
      S=$(curl -sf "$LOCAL/api/jobs/$JOB" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "?")
      if [ "$S" = "completed" ]; then
        META=$(curl -sf "$LOCAL/api/jobs/$JOB" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; r=json.load(sys.stdin).get('result',{}); print(f'{r.get(\"provider\",\"?\")}/{r.get(\"model\",\"?\")} {r.get(\"latencyMs\",\"?\")}ms')" 2>/dev/null)
        pass "local_generate" "$META"
        break
      elif [ "$S" = "failed" ]; then
        fail "local_generate" "job failed"
        break
      fi
    done
  else
    fail "local_generate" "$JOB"
  fi

  # Step 6: Delete/regenerate
  echo ""
  echo "--- Delete/Regenerate ---"
  ENCODED_MONTH=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$MONTH'))")
  curl -sf -X DELETE "$LOCAL/api/clients/$CLIENT/calendar/$ENCODED_MONTH" \
    -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true
  S2=$(curl -s "$LOCAL/api/clients/$CLIENT/calendar/$ENCODED_MONTH" \
    -H "Authorization: Bearer $TOKEN" -o /dev/null -w "%{http_code}" 2>/dev/null || echo "?")
  [ "$S2" = "404" ] && pass "delete_month" "404 after delete" || fail "delete_month" "HTTP $S2"
fi

# Step 7: VPS generate
echo ""
echo "--- VPS Generate ---"
set +e  # Don't die on curl failures during VPS generate
VT=$(curl -sf -X POST "$VPS/api/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null)
if [ -n "${VT:-}" ]; then
  # Pick first client whose brief is >= 50% complete — skip empty test clients
  VC=$(curl -sf "$VPS/api/clients" -H "Authorization: Bearer $VT" 2>/dev/null | VPS="$VPS" VT="$VT" python3 -c "
import sys, json, os, urllib.request
clients = json.load(sys.stdin)
if not clients: print(''); sys.exit(0)
vps = os.environ['VPS']; vt = os.environ['VT']
for c in clients:
    try:
        req = urllib.request.Request(f\"{vps}/api/clients/{c['id']}/brief/completeness\", headers={'Authorization': f'Bearer {vt}'})
        comp = json.loads(urllib.request.urlopen(req, timeout=5).read())
        if comp.get('score', 0) >= 50:
            print(c['id']); sys.exit(0)
    except Exception: pass
print(clients[0]['id'])  # Fallback: use first client even if incomplete
" 2>/dev/null)
  VM="VPS Smoke $(date +%s)"
  RESP=$(curl -s -X POST "$VPS/api/clients/$VC/calendar/generate" -H "Authorization: Bearer $VT" -H "Content-Type: application/json" \
    -d "{\"month\":\"$VM\",\"pieceCount\":2}" 2>/dev/null)
  VJ=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('jobId',''))" 2>/dev/null)
  if echo "$VJ" | grep -qE "^[0-9a-f-]+$"; then
    for i in $(seq 1 20); do
      sleep 5
      VS=$(curl -sf "$VPS/api/jobs/$VJ" -H "Authorization: Bearer $VT" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)
      if [ "${VS:-}" = "completed" ]; then pass "vps_generate" "completed"; break
      elif [ "${VS:-}" = "failed" ]; then fail "vps_generate" "failed"; break; fi
    done
  else
    # Show real error from response (likely "Brief completeness too low")
    ERR=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','unknown'))" 2>/dev/null || echo "$RESP")
    fail "vps_generate" "$ERR"
  fi
else
  fail "vps_backend" "auth"
fi
set -e  # Restore strict mode

# Write to DEBUG_LOG.md
echo ""
echo "--- Writing to $LOG ---"
cat >> "$LOG" << LOGEOF

## Smoke Run — $TS
**Branch:** $BRANCH @ \`$COMMIT\`
**Result:** $PASS_N passed, $FAIL_N failed

| Lane | Detail | Status |
|------|--------|--------|$(echo -e "$RESULTS")

LOGEOF

echo ""
echo "======================================="
echo "RESULTS: $PASS_N passed, $FAIL_N failed"
echo "======================================="
[ $FAIL_N -eq 0 ] && echo "ALL GREEN" || echo "FAILURES DETECTED"
