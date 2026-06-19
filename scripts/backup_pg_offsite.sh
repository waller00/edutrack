#!/usr/bin/env bash
# Genera un dump custom de PostgreSQL y lo copia a un servidor externo por SSH.
#
# Uso en el Droplet de produccion, desde la raiz del repo:
#   BACKUP_REMOTE_USER=backup ./scripts/backup_pg_offsite.sh
#
# Variables principales:
#   BACKUP_REMOTE_HOST       IP/DNS del destino off-site (default: 138.197.35.2)
#   BACKUP_REMOTE_USER       usuario SSH del destino (default: root)
#   BACKUP_REMOTE_DIR        carpeta remota de backups
#   BACKUP_SSH_KEY           llave privada opcional para SSH/scp
#   BACKUP_REMOTE_RETENTION_DAYS  retencion remota en dias (default: 30)
#   BACKUP_LOCAL_RETENTION_DAYS   retencion local en dias (default: 3)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DC_CLOUD="$ROOT_DIR/scripts/dc-cloud.sh"

BACKUP_REMOTE_HOST="${BACKUP_REMOTE_HOST:-138.197.35.2}"
BACKUP_REMOTE_USER="${BACKUP_REMOTE_USER:-root}"
BACKUP_REMOTE_PORT="${BACKUP_REMOTE_PORT:-22}"
BACKUP_REMOTE_DIR="${BACKUP_REMOTE_DIR:-/srv/edutrack-backups/production/postgres/daily}"
BACKUP_SSH_KEY="${BACKUP_SSH_KEY:-}"
BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-/root/backups/edutrack/postgres}"
BACKUP_REMOTE_RETENTION_DAYS="${BACKUP_REMOTE_RETENTION_DAYS:-30}"
BACKUP_LOCAL_RETENTION_DAYS="${BACKUP_LOCAL_RETENTION_DAYS:-3}"

POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-asistencias}"
PG_SERVICE="${PG_SERVICE:-pg}"

umask 077

if ! [[ "$BACKUP_REMOTE_RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "BACKUP_REMOTE_RETENTION_DAYS debe ser numerico." >&2
  exit 1
fi

if ! [[ "$BACKUP_LOCAL_RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "BACKUP_LOCAL_RETENTION_DAYS debe ser numerico." >&2
  exit 1
fi

if [[ ! -x "$DC_CLOUD" ]]; then
  echo "No se puede ejecutar $DC_CLOUD. Corregi permisos con: chmod +x scripts/dc-cloud.sh" >&2
  exit 1
fi

ssh_opts=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new -p "$BACKUP_REMOTE_PORT")
scp_opts=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new -P "$BACKUP_REMOTE_PORT")

if [[ -n "$BACKUP_SSH_KEY" ]]; then
  ssh_opts+=(-i "$BACKUP_SSH_KEY")
  scp_opts+=(-i "$BACKUP_SSH_KEY")
fi

remote_target="${BACKUP_REMOTE_USER}@${BACKUP_REMOTE_HOST}"
remote_dir_quoted="$(printf "%q" "$BACKUP_REMOTE_DIR")"

timestamp="$(date -u +%Y%m%d-%H%M%S)"
backup_name="edutrack-postgres-${POSTGRES_DB}-${timestamp}.dump"
backup_path="${BACKUP_LOCAL_DIR}/${backup_name}"
checksum_path="${backup_path}.sha256"

mkdir -p "$BACKUP_LOCAL_DIR"

echo "==> Verificando destino remoto ${remote_target}:${BACKUP_REMOTE_DIR}"
ssh "${ssh_opts[@]}" "$remote_target" "mkdir -p ${remote_dir_quoted} && chmod 700 ${remote_dir_quoted}"

echo "==> Generando dump PostgreSQL ${POSTGRES_DB}"
"$DC_CLOUD" exec -T "$PG_SERVICE" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges \
  > "$backup_path"

if [[ ! -s "$backup_path" ]]; then
  echo "El dump quedo vacio: $backup_path" >&2
  exit 1
fi

echo "==> Generando checksum"
(
  cd "$BACKUP_LOCAL_DIR"
  sha256sum "$backup_name" > "$(basename "$checksum_path")"
)

echo "==> Copiando backup al destino off-site"
scp "${scp_opts[@]}" "$backup_path" "$checksum_path" "${remote_target}:${BACKUP_REMOTE_DIR}/"

echo "==> Aplicando retencion local (${BACKUP_LOCAL_RETENTION_DAYS} dias)"
find "$BACKUP_LOCAL_DIR" -type f \( -name "edutrack-postgres-*.dump" -o -name "edutrack-postgres-*.dump.sha256" \) \
  -mtime +"$BACKUP_LOCAL_RETENTION_DAYS" -delete

echo "==> Aplicando retencion remota (${BACKUP_REMOTE_RETENTION_DAYS} dias)"
ssh "${ssh_opts[@]}" "$remote_target" \
  "find ${remote_dir_quoted} -type f \( -name 'edutrack-postgres-*.dump' -o -name 'edutrack-postgres-*.dump.sha256' \) -mtime +${BACKUP_REMOTE_RETENTION_DAYS} -delete"

echo "Backup off-site completado:"
echo "  Local:  $backup_path"
echo "  Remoto: ${remote_target}:${BACKUP_REMOTE_DIR}/${backup_name}"
