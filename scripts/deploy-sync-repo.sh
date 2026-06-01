#!/usr/bin/env bash
# Sincroniza el clone en el servidor de forma serializada (flock) y limpia locks
# stale de git antes de fetch/reset. Evita fallos tipo "could not set remote.origin.url"
# cuando dos deploys coinciden o quedó un config.lock colgado.
set -euo pipefail

REPO_DIR="${1:?falta REPO_DIR}"
REPO_URL="${2:?falta REPO_URL}"
TARGET_REF="${3:?falta TARGET_REF (branch, tag o SHA)}"
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/edutrack-deploy.lock}"
LOCK_WAIT_SEC="${DEPLOY_LOCK_WAIT_SEC:-900}"

release_git_locks() {
  local repo="$1"
  rm -f "$repo/.git/config.lock" "$repo/.git/index.lock" 2>/dev/null || true
  find "$repo/.git" -maxdepth 2 -name '*.lock' -type f -delete 2>/dev/null || true
}

sync_repo() {
  mkdir -p "$(dirname "$REPO_DIR")"
  if [ ! -d "$REPO_DIR/.git" ]; then
    git clone "$REPO_URL" "$REPO_DIR"
  fi
  cd "$REPO_DIR"
  release_git_locks "$REPO_DIR"
  git remote set-url origin "$REPO_URL"
  git fetch --all --tags --prune
  git reset --hard "$TARGET_REF"
  git clean -fd
}

exec 200>"$LOCK_FILE"
if ! flock -w "$LOCK_WAIT_SEC" 200; then
  echo "Timeout (${LOCK_WAIT_SEC}s) esperando lock de deploy en $LOCK_FILE" >&2
  exit 1
fi

sync_repo
echo "Repo sincronizado en $REPO_DIR @ $TARGET_REF"
