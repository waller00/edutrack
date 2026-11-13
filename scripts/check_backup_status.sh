#!/usr/bin/env bash
# Verifica que el ultimo backup exitoso no sea demasiado viejo.
# No modifica el backup: si esta atrasado, escribe una linea BACKUP_STALE
# en /var/log/edutrack-backup.log para que Wazuh la vea.
# Ademas publica la hora del ultimo exito como metrica (textfile collector de node-exporter):
# de ahi sale la alerta "EduTrack backup atrasado" de Grafana, que llega por Telegram aunque el
# manager de Wazuh este apagado.
set -euo pipefail

STATUS_FILE="${STATUS_FILE:-/var/lib/edutrack/backup-status.json}"
LOG_FILE="${LOG_FILE:-/var/log/edutrack-backup.log}"
MAX_AGE_SECONDS="${MAX_AGE_SECONDS:-108000}" # 30 horas
STALE_STATE="${STALE_STATE:-/var/lib/edutrack/backup-stale-last}"
METRICS_DIR="${METRICS_DIR:-/var/lib/edutrack-watchdog/textfile}"

mkdir -p "$(dirname "$STALE_STATE")"

# Escribe la metrica de forma atomica. Sin el directorio (node-exporter no lo lee) no hace nada.
write_metric() {
  [[ -d "$METRICS_DIR" ]] || return 0
  python3 - "$STATUS_FILE" "$METRICS_DIR" <<'PY' || true
import datetime
import json
import os
import sys

status_path, metrics_dir = sys.argv[1:3]
with open(status_path, encoding="utf-8") as fh:
    status = json.load(fh)

def epoch(value):
    dt = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return int(dt.timestamp())

lines = [
    "# HELP edutrack_backup_last_success_timestamp_seconds Ultimo backup restic completo (R2).",
    "# TYPE edutrack_backup_last_success_timestamp_seconds gauge",
    f'edutrack_backup_last_success_timestamp_seconds{{repository="r2"}} {epoch(status["last_success"])}',
    "# HELP edutrack_backup_testing_copy_ok 1 si la segunda copia (testing) salio bien en el ultimo backup.",
    "# TYPE edutrack_backup_testing_copy_ok gauge",
    f'edutrack_backup_testing_copy_ok {1 if status.get("testing_backup_ok") else 0}',
    "# HELP edutrack_backup_repository_bytes Tamano del repositorio restic en R2.",
    "# TYPE edutrack_backup_repository_bytes gauge",
    f'edutrack_backup_repository_bytes{{repository="r2"}} {int(status.get("repository_bytes", 0))}',
]
tmp = os.path.join(metrics_dir, f".edutrack_backup.prom.{os.getpid()}")
with open(tmp, "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines) + "\n")
os.chmod(tmp, 0o644)
os.replace(tmp, os.path.join(metrics_dir, "edutrack_backup.prom"))
PY
}

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

write_metric

if (( age > MAX_AGE_SECONDS )); then
  today="$(date -u +%F)"
  last_alert="$(cat "$STALE_STATE" 2>/dev/null || true)"
  if [[ "$last_alert" != "$today" ]]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) BACKUP_STALE age_seconds=$age last_success=$last_success" >> "$LOG_FILE"
    printf '%s\n' "$today" > "$STALE_STATE"
  fi
fi
