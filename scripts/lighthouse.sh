#!/usr/bin/env bash
# Run Lighthouse against the live VPS and capture perf/a11y/best-practices scores.
# Usage: ./scripts/lighthouse.sh [URL]
# Default URL: https://srv1494206.hstgr.cloud/
#
# Targets per docs/deployment-acceptance.md (P1-P3, P7):
#   perf  ≥ 80 on /login, ≥ 75 on /dashboard
#   a11y  ≥ 90
#   bp    ≥ 95
set -euo pipefail

URL="${1:-https://srv1494206.hstgr.cloud/}"
DATE=$(date +%F)
mkdir -p docs/perf

OUT="docs/perf/lighthouse-${DATE}.json"

lighthouse "$URL" \
  --quiet \
  --chrome-flags="--headless --no-sandbox --disable-gpu" \
  --only-categories=performance,accessibility,best-practices \
  --output=json \
  --output-path="$OUT"

node -e "
const r = require('./${OUT}');
const c = r.categories;
const score = (cat) => Math.round((c[cat].score ?? 0) * 100);
console.log('perf:', score('performance'));
console.log('a11y:', score('accessibility'));
console.log('bp:  ', score('best-practices'));
"
