#!/usr/bin/env bash
# Smoke test: end-to-end generation pipeline
# Usage: ./scripts/smoke-generate.sh [BASE_URL]
# Default: http://localhost:8080

set -euo pipefail

BASE=${1:-http://localhost:8080}
EMAIL="mohamed@radixmedia.ae"
PASS="Radix2026"
MONTH="Smoke Test $(date +%s)"

echo "=== RADIX GENERATION SMOKE TEST ==="
echo "Target: $BASE"
echo ""

# 1. Login
echo "[1/6] Login..."
TOKEN=$(curl -sf -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "  OK: token=${TOKEN:0:20}..."

# 2. Get or create client
echo "[2/6] Get client..."
CLIENTS=$(curl -sf "$BASE/api/clients" -H "Authorization: Bearer $TOKEN")
CLIENT_ID=$(echo "$CLIENTS" | python3 -c "
import sys,json
clients=json.load(sys.stdin)
if clients: print(clients[0]['id'])
else: print('NONE')
")

if [ "$CLIENT_ID" = "NONE" ]; then
  echo "  Creating test client..."
  CLIENT_ID=$(curl -sf -X POST "$BASE/api/clients" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"name":"Smoke Test Client","industry":"Technology"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
fi
echo "  OK: client=$CLIENT_ID"

# 3. Save brief
echo "[3/6] Save brief..."
curl -sf -X PUT "$BASE/api/clients/$CLIENT_ID/brief" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"objective":"Smoke test","audience":"QA","tone":"Professional","brandDo":"Test","brandDont":"Fail","products":["Test"],"pillars":["Quality"],"campaignMoments":[],"channels":["Instagram"],"approvers":[]}' > /dev/null
SCORE=$(curl -sf "$BASE/api/clients/$CLIENT_ID/brief/completeness" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['score'])")
echo "  OK: completeness=${SCORE}%"

# 4. Generate
echo "[4/6] Generate month..."
RESULT=$(curl -sf -X POST "$BASE/api/clients/$CLIENT_ID/calendar/generate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"month\":\"$MONTH\",\"pieceCount\":3}")
JOB_ID=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('jobId',d.get('error','FAIL')))")
echo "  OK: job=$JOB_ID"

# 5. Poll
echo "[5/6] Poll job..."
for i in $(seq 1 60); do
  sleep 5
  JOB=$(curl -sf "$BASE/api/jobs/$JOB_ID" -H "Authorization: Bearer $TOKEN")
  STATUS=$(echo "$JOB" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])")
  PROGRESS=$(echo "$JOB" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['progress'])")
  echo "  [$i] $STATUS $PROGRESS%"
  if [ "$STATUS" = "completed" ]; then
    echo "$JOB" | python3 -c "
import sys,json; d=json.load(sys.stdin); r=d.get('result',{})
print(f'  provider: {r.get(\"provider\",\"?\")}'  )
print(f'  model: {r.get(\"model\",\"?\")}'  )
print(f'  latency: {r.get(\"latencyMs\",\"?\")}ms')
print(f'  fallback: {r.get(\"fallbackUsed\",\"?\")}'  )
print(f'  calendarMonthId: {r.get(\"calendarMonthId\",\"?\")}'  )
"
    break
  fi
  if [ "$STATUS" = "failed" ]; then
    echo "$JOB" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  FAIL: {d.get(\"error\",\"?\")}')"
    exit 1
  fi
done

# 6. Fetch month
echo "[6/6] Fetch calendar..."
curl -sf "$BASE/api/clients/$CLIENT_ID/calendar/$(python3 -c "import urllib.parse; print(urllib.parse.quote('$MONTH'))")" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'  month: {d[\"month\"]}')
print(f'  posts: {len(d[\"posts\"])}')
for p in d['posts']:
    print(f'    - {p[\"platform\"]}: {p[\"title\"]}')
"

echo ""
echo "=== SMOKE TEST PASSED ==="
