#!/usr/bin/env bash
# Verifica que el ultimo backup exitoso no sea demasiado viejo.
# No modifica el backup: si esta atrasado, escribe una linea BACKUP_STALE
# en /var/log/edutrack-backup.log para que Wazuh la vea.
set -euo pipefail

STATUS_FILE="${STATUS_FILE:-/var/lib/edutrack/backup-status.json}"
LOG_FILE="${LOG_FILE:-/var/log/edutrack-backup.log}"
MAX_AGE_SECONDS="${MAX_AGE_SECONDS:-108000}" # 30 horas
STALE_STATE="${STALE_STATE:-/var/lib/edutrack/backup-stale-last}"

mkdir -p "$(dirname "$STALE_STATE")"

if [[ ! -r "$STATUS_FILE" ]]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) BACKUP_STALE status_missing file=$STATUS_FILE" >> "$LOG_FILE"
  exit 0
fi

last_success="$(python3 - "$STATUS_FILE" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as fh:
    print(json.load(fh).get("last_success", ""))
PY
)"

if [[ -z "$last_success" ]]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) BACKUP_STALE last_success_missing" >> "$LOG_FILE"
  exit 0
fi

age="$(python3 - "$last_success" <<'PY'
import datetime
import sys
from datetime import timezone
try:
    dt = datetime.datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00"))
except ValueError:
    print("invalid")
    raise SystemExit(0)
if dt.tzinfo is None:
    dt = dt.replace(tzinfo=timezone.utc)
print(int((datetime.datetime.now(timezone.utc) - dt).total_seconds()))
PY
)"

if [[ "$age" == "invalid" ]]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) BACKUP_STALE invalid_timestamp last_success=$last_success" >> "$LOG_FILE"
  exit 0
fi

if (( age > MAX_AGE_SECONDS )); then
  today="$(date -u +%F)"
  last_alert="$(cat "$STALE_STATE" 2>/dev/null || true)"
  if [[ "$last_alert" != "$today" ]]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) BACKUP_STALE age_seconds=$age last_success=$last_success" >> "$LOG_FILE"
    printf '%s\n' "$today" > "$STALE_STATE"
  fi
fi
