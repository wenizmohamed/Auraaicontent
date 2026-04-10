#!/usr/bin/env bash
# Debug lane inspector — writes ops/debug-status.json
# Usage: ./scripts/debug-lanes.sh
set -euo pipefail

export REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO_ROOT/ops/debug-status.json"
COMMIT=$(cd "$REPO_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BRANCH=$(cd "$REPO_ROOT" && git branch --show-current 2>/dev/null || echo "unknown")
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

LOCAL_BE="http://localhost:8080"
LOCAL_FE="http://localhost:3000"
VPS="https://srv1494206.hstgr.cloud"
EMAIL="mohamed@radixmedia.ae"
PASS="Radix2026"

get_health_details() {
  local url=$1
  curl -sf "$url/api/health/details" 2>/dev/null || echo "{}"
}

check_fe() {
  local url=$1
  curl -sf -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000"
}

check_electron() {
  local count
  count=$(tasklist 2>/dev/null | grep -c electron.exe 2>/dev/null) || count=0
  echo "${count:-0}"
}

echo "Inspecting lanes..."

# Local backend
LB_DETAILS=$(get_health_details "$LOCAL_BE")
LB_STATUS=$(echo "$LB_DETAILS" | python3 -c "import sys,json; d=json.load(sys.stdin); print('pass' if d.get('status')=='ok' else 'down')" 2>/dev/null || echo "down")
LB_START=$(echo "$LB_DETAILS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('processStart','?'))" 2>/dev/null || echo "?")
LB_GEM_FP=$(echo "$LB_DETAILS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('envFingerprints',{}).get('GEMINI_API_KEY','?'))" 2>/dev/null || echo "?")
LB_XAI_FP=$(echo "$LB_DETAILS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('envFingerprints',{}).get('XAI_API_KEY','?'))" 2>/dev/null || echo "?")
LB_ROUTING=$(echo "$LB_DETAILS" | python3 -c "import sys,json; r=json.load(sys.stdin).get('routing',{}); print(f'{r.get(\"AI_TEXT_PRIMARY\",\"?\")}/{r.get(\"AI_IMAGE_PRIMARY\",\"?\")}')" 2>/dev/null || echo "?")
LB_PID=$(netstat -ano 2>/dev/null | grep ":8080.*LISTEN" | awk '{print $5}' | head -1 || echo "?")

# Local web
LF_HTTP=$(check_fe "$LOCAL_FE")
LF_STATUS=$([ "$LF_HTTP" = "200" ] && echo "pass" || echo "down")
LF_PID=$(netstat -ano 2>/dev/null | grep ":3000.*LISTEN" | awk '{print $5}' | head -1 || echo "?")

# Desktop
DESK_COUNT=$(check_electron)
DESK_STATUS=$([ "$DESK_COUNT" -gt "0" ] && echo "pass" || echo "not_running")

# VPS backend
VB_DETAILS=$(get_health_details "$VPS")
VB_STATUS=$(echo "$VB_DETAILS" | python3 -c "import sys,json; d=json.load(sys.stdin); print('pass' if d.get('status')=='ok' else 'down')" 2>/dev/null || echo "down")
VB_START=$(echo "$VB_DETAILS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('processStart','?'))" 2>/dev/null || echo "?")
VB_GEM_FP=$(echo "$VB_DETAILS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('envFingerprints',{}).get('GEMINI_API_KEY','?'))" 2>/dev/null || echo "?")
VB_XAI_FP=$(echo "$VB_DETAILS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('envFingerprints',{}).get('XAI_API_KEY','?'))" 2>/dev/null || echo "?")

# VPS frontend
VF_HTTP=$(check_fe "$VPS")
VF_STATUS=$([ "$VF_HTTP" = "200" ] && echo "pass" || echo "down")

# Keys match?
KEYS_MATCH=$([ "$LB_GEM_FP" = "$VB_GEM_FP" ] && [ "$LB_XAI_FP" = "$VB_XAI_FP" ] && echo "True" || echo "False")

# Write JSON
python3 -c "
import json
data = {
    'timestamp': '$TS',
    'git': {'branch': '$BRANCH', 'commit': '$COMMIT'},
    'keys_match_across_lanes': $KEYS_MATCH,
    'local_backend': {
        'url': '$LOCAL_BE',
        'pid': '$LB_PID',
        'process_start': '$LB_START',
        'gemini_fp': '$LB_GEM_FP',
        'xai_fp': '$LB_XAI_FP',
        'routing': '$LB_ROUTING',
        'status': '$LB_STATUS'
    },
    'local_web': {
        'url': '$LOCAL_FE',
        'backend_url': '$LOCAL_BE',
        'pid': '$LF_PID',
        'status': '$LF_STATUS'
    },
    'desktop': {
        'electron_processes': int('$DESK_COUNT'),
        'backend_url': '$LOCAL_BE',
        'status': '$DESK_STATUS'
    },
    'vps_backend': {
        'url': '$VPS/api',
        'process_start': '$VB_START',
        'gemini_fp': '$VB_GEM_FP',
        'xai_fp': '$VB_XAI_FP',
        'status': '$VB_STATUS'
    },
    'vps_frontend': {
        'url': '$VPS',
        'backend_url': '$VPS/api',
        'status': '$VF_STATUS'
    }
}
print(json.dumps(data, indent=2))
import os
outpath = os.path.join(os.environ.get('REPO_ROOT', '.'), 'ops', 'debug-status.json')
os.makedirs(os.path.dirname(outpath), exist_ok=True)
with open(outpath, 'w') as f:
    json.dump(data, f, indent=2)
"

echo ""
echo "Written to $OUT"
