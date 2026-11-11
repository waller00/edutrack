#!/usr/bin/env bash
# Backup diario de EduTrack: DBs + configuracion + moodledata, cifrado con restic.
# Los secretos viven fuera del repo:
#   /root/.restic-r2.env
#   /root/.restic-password
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-/root/edutrack}"
DC_CLOUD="$ROOT_DIR/scripts/dc-cloud.sh"
RESTIC_ENV_FILE="${RESTIC_ENV_FILE:-/root/.restic-r2.env}"
STAGING_ROOT="${STAGING_ROOT:-/var/backups/edutrack/restic-staging}"
STATUS_DIR="${STATUS_DIR:-/var/lib/edutrack}"
STATUS_FILE="$STATUS_DIR/backup-status.json"
LOCK_FILE="${LOCK_FILE:-/var/lock/edutrack-backup.lock}"
KEEP_STAGING_DAYS="${KEEP_STAGING_DAYS:-2}"

umask 077

if [[ ! -x "$DC_CLOUD" ]]; then
  echo "No se puede ejecutar $DC_CLOUD" >&2
  exit 1
fi
if [[ ! -r "$RESTIC_ENV_FILE" ]]; then
  echo "No existe $RESTIC_ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$RESTIC_ENV_FILE"
set +a

if [[ -z "${RESTIC_REPOSITORY:-}" ]]; then
  echo "RESTIC_REPOSITORY no esta definido" >&2
  exit 1
fi
if [[ -z "${RESTIC_PASSWORD_FILE:-}" || ! -r "${RESTIC_PASSWORD_FILE}" ]]; then
  echo "RESTIC_PASSWORD_FILE no esta definido o no se puede leer" >&2
  exit 1
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Otro backup esta en ejecucion"
  exit 75
fi

mkdir -p "$STAGING_ROOT" "$STATUS_DIR"
timestamp="$(date -u +%Y%m%d-%H%M%S)"
staging="$STAGING_ROOT/$timestamp"
mkdir -p "$staging"

success=0
cleanup() {
  if [[ "$success" -eq 1 ]]; then
    rm -rf "$staging"
  else
    echo "Backup fallido; se conserva $staging para diagnostico" >&2
  fi
}
trap cleanup EXIT

echo "==> Limpiando staging viejo (${KEEP_STAGING_DAYS} dias)"
find "$STAGING_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_STAGING_DAYS" -exec rm -rf {} + || true

echo "==> Dump asistencias"
"$DC_CLOUD" exec -T pg \
  pg_dump -U postgres -d asistencias -Fc --no-owner --no-privileges \
  > "$staging/asistencias.dump"
[[ -s "$staging/asistencias.dump" ]] || { echo "Dump de asistencias vacio" >&2; exit 1; }

echo "==> Dump keycloak"
"$DC_CLOUD" exec -T keycloak-db \
  pg_dump -U keycloak -d keycloak -Fc --no-owner --no-privileges \
  > "$staging/keycloak.dump"
[[ -s "$staging/keycloak.dump" ]] || { echo "Dump de keycloak vacio" >&2; exit 1; }

echo "==> Dump Moodle DB"
docker exec edutrack-moodle-db-1 sh -c \
  'MYSQL_PWD="${MARIADB_ROOT_PASSWORD}" mariadb-dump -uroot --single-transaction --quick --routines --triggers --events "${MARIADB_DATABASE:-bitnami_moodle}"' \
  | gzip -c > "$staging/moodle.sql.gz"
[[ -s "$staging/moodle.sql.gz" ]] || { echo "Dump de Moodle vacio" >&2; exit 1; }

echo "==> Checksums"
(
  cd "$staging"
  sha256sum asistencias.dump keycloak.dump moodle.sql.gz > SHA256SUMS
)

moodle_data="$(docker inspect edutrack-moodle-1 \
  --format '{{range .Mounts}}{{if eq .Destination "/bitnami/moodledata"}}{{.Source}}{{end}}{{end}}')"
if [[ -z "$moodle_data" || ! -d "$moodle_data" ]]; then
  echo "No se encontro moodledata" >&2
  exit 1
fi

config_paths=(
  "$ROOT_DIR/.env"
  "$ROOT_DIR/.env.monitoring"
  "$ROOT_DIR/nginx"
  "$ROOT_DIR/monitoring"
  /etc/ssl/cloudflare
)
for f in "$ROOT_DIR"/docker-compose*.yml; do
  [[ -f "$f" ]] && config_paths+=("$f")
done

for p in "${config_paths[@]}"; do
  [[ -e "$p" ]] || { echo "Falta ruta de configuracion: $p" >&2; exit 1; }
done

echo "==> Snapshot restic"
restic backup \
  --host "$(hostname -s)" \
  --tag edutrack-daily \
  "$staging" \
  "${config_paths[@]}" \
  "$moodle_data"

echo "==> Retencion 30 dias"
restic forget --keep-daily 30 --prune

repo_stats="$(restic stats --mode raw-data --json)"
repo_bytes="$(printf '%s' "$repo_stats" | python3 -c 'import json,sys; print(int(json.load(sys.stdin).get("total_size", 0)))')"
r2_alert_bytes=$((8 * 1000 * 1000 * 1000))
if (( repo_bytes > r2_alert_bytes )); then
  echo "R2_USAGE_HIGH total_size=$repo_bytes threshold=$r2_alert_bytes"
fi

snapshot_id="$(restic snapshots --latest 1 --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[-1]["short_id"] if d else "")')"
size_bytes="$(du -sb "$staging" | awk '{print $1}')"
files_count="$(find "$staging" -type f | wc -l | tr -d ' ')"

python3 - "$STATUS_FILE" "$snapshot_id" "$timestamp" "$size_bytes" "$files_count" "$repo_bytes" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

path, snapshot, stamp, size, files, repo_bytes = sys.argv[1:7]
data = {
    "last_success": datetime.now(timezone.utc).isoformat(),
    "snapshot": snapshot,
    "run_id": stamp,
    "staging_bytes": int(size),
    "staging_files": int(files),
    "repository_bytes": int(repo_bytes),
    "repository": "r2:backup-edutrack",
    "retention_days": 30,
}
os.makedirs(os.path.dirname(path), exist_ok=True)
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
os.replace(tmp, path)
PY

success=1
echo "Backup completado: snapshot=$snapshot_id status=$STATUS_FILE"
