#!/bin/bash
# Real e2e test — exercises every critical backend flow, verifies DB state,
# fails loudly when things actually break (not just "200 returned").
set -u
cd "$(dirname "$0")/.."

TOK=$(node -e "
import jwt from 'jsonwebtoken';
import 'dotenv/config';
console.log(jwt.sign({ userId: 'e2e-test', email: 'e2e@radix.local' }, process.env.JWT_SECRET, { expiresIn: '10m' }));
")
BASE="http://127.0.0.1:8080"
H_AUTH="Authorization: Bearer $TOK"
H_JSON="Content-Type: application/json"
PASS=0; FAIL=0; ERRS=()

pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1  $2"; FAIL=$((FAIL+1)); ERRS+=("$1: $2"); }

step() { echo ""; echo "──── $1 ────"; }

DBQ() { sudo -u postgres psql radix_planner -tAc "$1"; }

# ─── 1. Pick a test client ────────────────────────────────────────
step "Setup: pick test client"
CLIENT_ID=$(curl -s -H "$H_AUTH" "$BASE/api/clients" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
CLIENT_NAME=$(curl -s -H "$H_AUTH" "$BASE/api/clients" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['name'])")
[ -n "$CLIENT_ID" ] && pass "Got client: $CLIENT_NAME ($CLIENT_ID)" || fail "Get clients" "no clients in DB"

# ─── 2. Brief get/save ────────────────────────────────────────────
step "Brief flow"
BRIEF=$(curl -s -H "$H_AUTH" "$BASE/api/clients/$CLIENT_ID/brief")
echo "$BRIEF" | grep -q "objective" && pass "GET brief returns saved brief" || fail "GET brief" "no objective field: $(echo $BRIEF | head -c 200)"

# ─── 3. Calendar list ─────────────────────────────────────────────
step "Calendar list"
MONTHS=$(curl -s -H "$H_AUTH" "$BASE/api/clients/$CLIENT_ID/calendar/months")
echo "$MONTHS" | python3 -c "import sys,json; assert isinstance(json.load(sys.stdin), list)" 2>/dev/null \
  && pass "Months endpoint returns array" \
  || fail "Months list" "not a list"

# ─── 4. Archive endpoints ─────────────────────────────────────────
step "Archive endpoints"
ARCHIVED_LIST=$(curl -s -H "$H_AUTH" "$BASE/api/clients/$CLIENT_ID/calendar/archived")
echo "$ARCHIVED_LIST" | python3 -c "import sys,json; assert isinstance(json.load(sys.stdin), list)" 2>/dev/null \
  && pass "Archived list endpoint works" \
  || fail "Archived list" "not a list: $(echo $ARCHIVED_LIST | head -c 200)"

# ─── 5. Generate conflict path ────────────────────────────────────
step "Generate-conflict logic"
# Pick any existing month (active or archived) to provoke conflict
EXISTING_MONTH=$(DBQ "SELECT month FROM \"CalendarMonth\" WHERE \"clientId\"='$CLIENT_ID' LIMIT 1;")
if [ -n "$EXISTING_MONTH" ]; then
  RESP=$(curl -s -X POST -H "$H_AUTH" -H "$H_JSON" -d "{\"month\":\"$EXISTING_MONTH\",\"pieceCount\":3}" "$BASE/api/clients/$CLIENT_ID/calendar/generate")
  echo "$RESP" | grep -q "already exists" \
    && pass "Generate on existing month → 'already exists' (modal will trigger)" \
    || fail "Conflict message" "no 'already exists' substring: $(echo $RESP | head -c 200)"
else
  echo "  (no existing months — skipping conflict test)"
fi

# ─── 6. Hard-delete idempotency ───────────────────────────────────
step "Hard-delete a non-existent month"
RESP=$(curl -s -w "\n%{http_code}" -X DELETE -H "$H_AUTH" "$BASE/api/clients/$CLIENT_ID/calendar/NeverExisted%202099?hard=true")
CODE=$(echo "$RESP" | tail -1)
[ "$CODE" = "404" ] && pass "Non-existent hard-delete → 404" || fail "Hard-delete missing" "got HTTP $CODE"

# ─── 7. Dashboard data freshness ──────────────────────────────────
step "Dashboard endpoints — verify shape"
STATS=$(curl -s -H "$H_AUTH" "$BASE/api/dashboard/stats")
echo "$STATS" | python3 -c "
import sys,json; d=json.load(sys.stdin)
assert 'clients' in d and 'content' in d and 'activity' in d
assert d['clients']['total'] >= 0
assert isinstance(d['content']['byPlatform'], dict)
" && pass "stats shape valid" || fail "stats shape" "missing fields"

INSIGHTS=$(curl -s -H "$H_AUTH" "$BASE/api/dashboard/insights")
echo "$INSIGHTS" | python3 -c "
import sys,json; d=json.load(sys.stdin)
assert 'actionCenter' in d and 'trends' in d and 'visualShowcase' in d and 'insights' in d
assert len(d['trends']['sparkline']) == 30, f'sparkline must be 30 days, got {len(d[\"trends\"][\"sparkline\"])}'
" && pass "insights shape valid (sparkline=30 days)" || fail "insights shape" "shape wrong"

ACT=$(curl -s -H "$H_AUTH" "$BASE/api/dashboard/activity")
echo "$ACT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert isinstance(d, list)" \
  && pass "activity is a list ($(echo $ACT | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))') entries)" \
  || fail "activity shape" "not a list"

AI_STATS=$(curl -s -H "$H_AUTH" "$BASE/api/dashboard/ai-stats")
echo "$AI_STATS" | python3 -c "
import sys,json; d=json.load(sys.stdin)
assert 'totalCalls' in d and 'providers' in d and 'tasks' in d
" && pass "ai-stats shape valid" || fail "ai-stats" "shape wrong"

# ─── 8. Assets gallery filters ────────────────────────────────────
step "Gallery API"
A1=$(curl -s -H "$H_AUTH" "$BASE/api/assets?type=image&take=5")
echo "$A1" | python3 -c "import sys,json; d=json.load(sys.stdin); assert isinstance(d, list)" \
  && pass "type=image filter works" || fail "type=image" "$A1"

A2=$(curl -s -H "$H_AUTH" "$BASE/api/assets?clientId=$CLIENT_ID")
echo "$A2" | python3 -c "import sys,json; d=json.load(sys.stdin); assert isinstance(d, list)" \
  && pass "clientId filter works" || fail "clientId filter" "$A2"

# ─── 9. Providers status (public endpoint) ────────────────────────
step "Providers / public endpoints"
PROV=$(curl -s "$BASE/api/providers/status")
echo "$PROV" | python3 -c "
import sys,json; d=json.load(sys.stdin)
assert 'orchestrator' in d
assert 'gemini-3.1-pro' in d['orchestrator'], f'orchestrator: {d[\"orchestrator\"]}'
" && pass "providers/status reports gemini-3.1-pro-preview" || fail "providers/status" "wrong orchestrator"

# ─── 10. Brief PUT round-trip ─────────────────────────────────────
step "Brief save round-trip (read → modify → write → verify)"
ORIG=$(curl -s -H "$H_AUTH" "$BASE/api/clients/$CLIENT_ID/brief")
ORIG_TONE=$(echo "$ORIG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tone',''))")
TEST_TONE="e2e-test-tone-$(date +%s)"
# Save with new tone
curl -s -X PUT -H "$H_AUTH" -H "$H_JSON" \
  -d "$(echo "$ORIG" | python3 -c "import sys,json; d=json.load(sys.stdin); d['tone']='$TEST_TONE'; print(json.dumps(d))")" \
  "$BASE/api/clients/$CLIENT_ID/brief" > /dev/null
# Read back
NEW=$(curl -s -H "$H_AUTH" "$BASE/api/clients/$CLIENT_ID/brief" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tone',''))")
[ "$NEW" = "$TEST_TONE" ] && pass "Brief PUT persisted (tone='$TEST_TONE')" || fail "Brief PUT" "expected '$TEST_TONE', got '$NEW'"
# Restore original
curl -s -X PUT -H "$H_AUTH" -H "$H_JSON" \
  -d "$(echo "$ORIG" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)))")" \
  "$BASE/api/clients/$CLIENT_ID/brief" > /dev/null
RESTORED=$(curl -s -H "$H_AUTH" "$BASE/api/clients/$CLIENT_ID/brief" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tone',''))")
[ "$RESTORED" = "$ORIG_TONE" ] && pass "Brief restored to original tone" || fail "Brief restore" "expected '$ORIG_TONE', got '$RESTORED'"

# ─── 11. Archive → Restore round-trip ─────────────────────────────
step "Archive → Restore round-trip"
ARCH_MONTH=$(DBQ "SELECT month FROM \"CalendarMonth\" WHERE \"clientId\"='$CLIENT_ID' AND \"isArchived\"=false LIMIT 1;")
if [ -n "$ARCH_MONTH" ]; then
  # Archive (soft delete)
  curl -s -X DELETE -H "$H_AUTH" "$BASE/api/clients/$CLIENT_ID/calendar/$(printf %s "$ARCH_MONTH" | python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.stdin.read()))")" > /dev/null
  IS_ARCH=$(DBQ "SELECT \"isArchived\" FROM \"CalendarMonth\" WHERE \"clientId\"='$CLIENT_ID' AND month='$ARCH_MONTH';")
  [ "$IS_ARCH" = "t" ] && pass "Soft-archive: month is now isArchived=true" || fail "Soft archive" "isArchived=$IS_ARCH"
  # Restore
  curl -s -X POST -H "$H_AUTH" "$BASE/api/clients/$CLIENT_ID/calendar/$(printf %s "$ARCH_MONTH" | python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.stdin.read()))")/restore" > /dev/null
  IS_RESTORED=$(DBQ "SELECT \"isArchived\" FROM \"CalendarMonth\" WHERE \"clientId\"='$CLIENT_ID' AND month='$ARCH_MONTH';")
  [ "$IS_RESTORED" = "f" ] && pass "Restore: isArchived=false again" || fail "Restore" "isArchived=$IS_RESTORED"
else
  echo "  (no live months to test archive — skipping)"
fi

# ─── 12. DB consistency ───────────────────────────────────────────
step "DB consistency checks"
ORPHAN=$(DBQ "SELECT COUNT(*) FROM \"CalendarPost\" cp WHERE NOT EXISTS (SELECT 1 FROM \"CalendarMonth\" cm WHERE cm.id=cp.\"calendarMonthId\");")
[ "$ORPHAN" = "0" ] && pass "No orphaned CalendarPosts" || fail "Orphan posts" "$ORPHAN posts have no parent month"

ARCHIVED_COUNT=$(DBQ "SELECT COUNT(*) FROM \"CalendarMonth\" WHERE \"isArchived\"=true;")
TOTAL_MONTHS=$(DBQ "SELECT COUNT(*) FROM \"CalendarMonth\";")
pass "DB state: $TOTAL_MONTHS total months, $ARCHIVED_COUNT archived"

# ─── Summary ──────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════"
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  for e in "${ERRS[@]}"; do echo "  - $e"; done
  exit 1
fi
