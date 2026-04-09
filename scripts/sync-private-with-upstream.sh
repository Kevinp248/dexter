#!/usr/bin/env bash
set -euo pipefail

# Sync latest upstream/main into local main, push to private/main,
# then rebase your feature branch on top of main and push it to private.
#
# Usage:
#   bash scripts/sync-private-with-upstream.sh
#   bash scripts/sync-private-with-upstream.sh feature-branch-name

FEATURE_BRANCH="${1:-feature-kevin-dexter}"
MAIN_BRANCH="main"
UPSTREAM_REMOTE="upstream"
PRIVATE_REMOTE="private"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: run this inside a git repository."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash first."
  exit 1
fi

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
  echo "Error: missing remote '$UPSTREAM_REMOTE'."
  exit 1
fi

if ! git remote get-url "$PRIVATE_REMOTE" >/dev/null 2>&1; then
  echo "Error: missing remote '$PRIVATE_REMOTE'."
  exit 1
fi

echo "==> Fetching remotes"
git fetch "$UPSTREAM_REMOTE"
git fetch "$PRIVATE_REMOTE"

echo "==> Updating ${MAIN_BRANCH} from ${UPSTREAM_REMOTE}/${MAIN_BRANCH}"
git checkout "$MAIN_BRANCH"
git merge --ff-only "$UPSTREAM_REMOTE/$MAIN_BRANCH"
git push "$PRIVATE_REMOTE" "$MAIN_BRANCH"

if ! git show-ref --verify --quiet "refs/heads/$FEATURE_BRANCH"; then
  echo "Error: local branch '$FEATURE_BRANCH' not found."
  exit 1
fi

echo "==> Rebasing ${FEATURE_BRANCH} on ${MAIN_BRANCH}"
git checkout "$FEATURE_BRANCH"
git rebase "$MAIN_BRANCH"
git push "$PRIVATE_REMOTE" "$FEATURE_BRANCH"

echo ""
echo "Done."
echo "- ${MAIN_BRANCH} synced to ${UPSTREAM_REMOTE}/${MAIN_BRANCH} and pushed to ${PRIVATE_REMOTE}/${MAIN_BRANCH}"
echo "- ${FEATURE_BRANCH} rebased and pushed to ${PRIVATE_REMOTE}/${FEATURE_BRANCH}"
