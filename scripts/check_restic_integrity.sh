#!/usr/bin/env bash
# Verificacion semanal de integridad del repositorio restic.
# --read-data-subset=5% lee y valida el 5% de los data packs; no restaura nada.
set -euo pipefail

RESTIC_ENV_FILE="${RESTIC_ENV_FILE:-/root/.restic-r2.env}"
LOG_FILE="${LOG_FILE:-/var/log/edutrack-backup.log}"
SUBSET="${SUBSET:-5%}"

if [[ ! -r "$RESTIC_ENV_FILE" ]]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) RESTIC_CHECK_FAILED missing_env=$RESTIC_ENV_FILE" >> "$LOG_FILE"
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$RESTIC_ENV_FILE"
set +a

if restic check --read-data-subset="$SUBSET" >> "$LOG_FILE" 2>&1; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) RESTIC_CHECK_OK subset=$SUBSET" >> "$LOG_FILE"
else
  rc=$?
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) RESTIC_CHECK_FAILED subset=$SUBSET rc=$rc" >> "$LOG_FILE"
  exit "$rc"
fi
