#!/usr/bin/env bash
# One-time: move a checkout from the retired v2-migration branch to main, then
# finish retiring the old remote branches. Safe to re-run.
#
# Never deploys and never loses work:
#   - all local edits are first saved to ~/radix-wip-backup-<timestamp>.patch
#   - a locally edited file that main also changed is only reset when the local
#     copy already matches main; anything else stops the script untouched
#   - branches holding work that isn't on main are tagged archive/* before deletion
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
REPO=wenizmohamed/radixcontent
git fetch origin --prune

if [ "$(git branch --show-current)" != "main" ]; then
  backup="$HOME/radix-wip-backup-$(date +%Y%m%d-%H%M%S).patch"
  git diff HEAD > "$backup"
  echo "== local edits backed up to $backup"

  # Commits here that main lacks (the retirement notice itself aside).
  extra=$(git log --oneline origin/main..HEAD -- . ':!CLAUDE.md' ':!AGENTS.md' ':!scripts/retire-v2-migration.sh')
  if [ -n "$extra" ]; then
    echo "STOP: this checkout has commits that aren't on origin/main:"
    echo "$extra"
    exit 1
  fi
  if git show-ref --verify --quiet refs/heads/main && [ -n "$(git log --oneline origin/main..main)" ]; then
    echo "STOP: local main has commits that aren't on origin/main"
    exit 1
  fi

  while IFS= read -r f; do
    git diff --quiet HEAD origin/main -- "$f" && continue
    if git diff --quiet origin/main -- "$f"; then
      git checkout -- "$f"
      echo "== $f: local edit already on main, reset"
    else
      echo "STOP: $f has local edits that aren't on origin/main (saved in $backup)"
      exit 1
    fi
  done < <(git diff --name-only HEAD)

  git checkout -B main origin/main
  git branch -u origin/main main
fi
git pull --ff-only origin main
echo "== checkout now on $(git branch --show-current) @ $(git log --oneline -1)"

remote_has() { git ls-remote --exit-code --heads origin "$1" >/dev/null 2>&1; }

# Branches with work that isn't on main: keep a tag before deleting.
for pair in million-dollar-hardening:archive/million-dollar-hardening \
            copilot/explain-repository-structure:archive/explain-repository-structure \
            copilot/integrate-github-mcp-server:archive/integrate-github-mcp-server; do
  b=${pair%%:*}; t=${pair#*:}
  if remote_has "$b"; then
    git tag -f "$t" "origin/$b"
    git push origin "refs/tags/$t"
  fi
done

for b in million-dollar-hardening copilot/explain-repository-structure copilot/integrate-github-mcp-server \
         claude/compassionate-galileo-gz6f6l copilot/improve-radixcontent-interface \
         copilot/gh-auth-login copilot/gh-auth-login-again copilot/gh-auth-login-process; do
  if remote_has "$b"; then
    git push origin --delete "$b"
  fi
done

default=$(git ls-remote --symref origin HEAD | sed -n 's#^ref: refs/heads/\(.*\)\tHEAD$#\1#p')
if [ "$default" != "main" ]; then
  token=$( { printf 'protocol=https\nhost=github.com\n\n' | GIT_TERMINAL_PROMPT=0 git credential fill 2>/dev/null || true; } | sed -n 's/^password=//p')
  if [ -n "$token" ] && curl -fsS -o /dev/null -X PATCH \
       -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" \
       "https://api.github.com/repos/$REPO" -d '{"default_branch":"main"}'; then
    default=main
  elif command -v gh >/dev/null 2>&1 && gh repo edit "$REPO" --default-branch main >/dev/null 2>&1; then
    default=main
  fi
fi

if [ "$default" = "main" ]; then
  if remote_has v2-migration; then
    git push origin --delete v2-migration
  fi
  echo "== done: main is the default and only branch"
else
  echo "== could not set the default branch (no GitHub token or gh here); v2-migration kept until it can be"
fi
