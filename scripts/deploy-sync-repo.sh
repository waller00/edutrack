#!/usr/bin/env bash
# Sincroniza el clone en el servidor sin tocar `remote.origin.url` (evita config.lock).
set -euo pipefail

REPO_DIR="${1:?falta REPO_DIR}"
REPO_URL="${2:?falta REPO_URL}"
TARGET_REF="${3:?falta TARGET_REF (origin/main, main, tag o SHA)}"
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/edutrack-deploy.lock}"
LOCK_WAIT_SEC="${DEPLOY_LOCK_WAIT_SEC:-900}"

release_git_locks() {
  local repo="$1"
  rm -f "$repo/.git/config.lock" "$repo/.git/index.lock" 2>/dev/null || true
  find "$repo/.git" -name '*.lock' -type f -delete 2>/dev/null || true
}

git_sync_from_url() {
  local repo_url="$1"
  local target_ref="$2"
  git config --global --add safe.directory "$(pwd)" 2>/dev/null || true
  release_git_locks "$(pwd)"
  if [[ "$target_ref" == origin/* ]]; then
    local branch="${target_ref#origin/}"
    git fetch "$repo_url" "+refs/heads/${branch}:refs/remotes/origin/${branch}" --tags --prune
    git reset --hard "$target_ref"
  elif git fetch "$repo_url" "$target_ref" --tags 2>/dev/null; then
    git reset --hard FETCH_HEAD
  else
    git fetch "$repo_url" "+refs/heads/${target_ref}:refs/remotes/origin/${target_ref}" --tags --prune
    git reset --hard "origin/${target_ref}"
  fi
  git clean -fd
}

mkdir -p "$(dirname "$REPO_DIR")"
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone "$REPO_URL" "$REPO_DIR"
fi

exec 200>"$LOCK_FILE"
if ! flock -w "$LOCK_WAIT_SEC" 200; then
  echo "Timeout (${LOCK_WAIT_SEC}s) esperando lock de deploy en $LOCK_FILE" >&2
  exit 1
fi

cd "$REPO_DIR"
git_sync_from_url "$REPO_URL" "$TARGET_REF"
echo "Repo sincronizado en $REPO_DIR @ $TARGET_REF"
