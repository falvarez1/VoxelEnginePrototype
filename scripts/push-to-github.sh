#!/usr/bin/env bash
set -euo pipefail

REPO_FULL_NAME="${1:-falvarez1/VoxelEnginePrototype}"
VISIBILITY="${2:-public}"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI 'gh' is required for this helper. Install it, authenticate with 'gh auth login', then rerun." >&2
  exit 1
fi

if [ ! -d .git ]; then
  git init
fi

git add .
if ! git diff --cached --quiet; then
  git commit -m "Initial VoxelEnginePrototype prototype"
fi

if ! gh repo view "$REPO_FULL_NAME" >/dev/null 2>&1; then
  gh repo create "$REPO_FULL_NAME" --"$VISIBILITY" --source=. --remote=origin --push
else
  git remote remove origin >/dev/null 2>&1 || true
  git remote add origin "https://github.com/$REPO_FULL_NAME.git"
  git branch -M main
  git push -u origin main
fi
