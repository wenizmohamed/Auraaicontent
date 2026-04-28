#!/usr/bin/env bash
# Roll back to a known-good commit and redeploy.
# Usage: ./scripts/rollback.sh <git-sha>
#
# Returns the local repo to its prior HEAD on exit (success OR failure).
# The VPS stays at the rolled-back state — that's the whole point.
set -euo pipefail

SHA="${1:-}"
if [[ -z "$SHA" ]]; then
  echo "usage: $0 <git-sha>" >&2
  exit 2
fi

git rev-parse --verify "$SHA" >/dev/null 2>&1 || {
  echo "ERR: '$SHA' is not a valid git ref in this repo" >&2
  exit 2
}

CURRENT=$(git rev-parse HEAD)
echo "Rolling back from $CURRENT → $SHA"

# Restore local HEAD on exit, regardless of whether deploy succeeded.
trap "echo 'restoring local HEAD to $CURRENT' && git checkout '$CURRENT'" EXIT

git checkout "$SHA"

"$(dirname "$0")/deploy.sh"

echo ""
echo "✓ Rollback complete. VPS is at $SHA. Local repo will return to $CURRENT on exit."
