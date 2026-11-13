#!/usr/bin/env bash
# Restaura un dump en formato custom de pg_dump (-Fc), típico prod-asistencias.dump.
# No reinicia Postgres: solo para web/auth, luego DROP/CREATE DB y pg_restore.
#
# Uso en el servidor (desde la raíz del repo, p. ej. ~/edutrack):
#   ./scripts/restore_pg_custom_dump_cloud.sh /root/prod-asistencias.dump
#
# Base de Keycloak (p. ej. el keycloak.dump de un snapshot de restic, ver docs/BACKUP_RESTIC_R2.md):
#   PG_SERVICE=keycloak-db POSTGRES_USER=keycloak POSTGRES_DB=keycloak RESTORE_STOP_SERVICES=keycloak \
#     ./scripts/restore_pg_custom_dump_cloud.sh /tmp/restore-edutrack/…/keycloak.dump
#
# Requisito: preferir "docker compose" (v2). Ver docs/TESTING_DB_RESTORE.md
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DC_CLOUD="$ROOT_DIR/scripts/dc-cloud.sh"
DUMP_PATH="${1:-}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-asistencias}"
PG_SERVICE="${PG_SERVICE:-pg}"
RESTORE_STOP_SERVICES="${RESTORE_STOP_SERVICES:-web auth}"

if [[ -z "$DUMP_PATH" || ! -f "$DUMP_PATH" ]]; then
  echo "Uso: $0 /ruta/al/archivo.dump" >&2
  echo "El archivo no existe o no indicaste ruta: ${DUMP_PATH:-"(vacío)"}" >&2
  exit 1
fi

read -r -a stop_services <<<"$RESTORE_STOP_SERVICES"

echo "==> Parando ${RESTORE_STOP_SERVICES} (Postgres sigue corriendo)"
"$DC_CLOUD" stop "${stop_services[@]}"

PG_CID="$("$DC_CLOUD" ps -q "$PG_SERVICE")"
if [[ -z "$PG_CID" ]]; then
  echo "No hay contenedor para el servicio '$PG_SERVICE'. ¿Está levantado Postgres?" >&2
  exit 1
fi

# El dump es texto plano con datos personales: no queda en el contenedor al terminar.
trap 'docker exec "$PG_CID" rm -f /tmp/restore.dump >/dev/null 2>&1 || true' EXIT

echo "==> Copiando dump al contenedor $PG_SERVICE"
docker cp "$DUMP_PATH" "${PG_CID}:/tmp/restore.dump"

echo "==> Cortando conexiones a la base $POSTGRES_DB"
"$DC_CLOUD" exec -T "$PG_SERVICE" psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POSTGRES_DB}' AND pid <> pg_backend_pid();" \
  || true

echo "==> DROP + CREATE DATABASE $POSTGRES_DB"
"$DC_CLOUD" exec -T "$PG_SERVICE" psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "DROP DATABASE IF EXISTS \"${POSTGRES_DB}\";"
"$DC_CLOUD" exec -T "$PG_SERVICE" psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "CREATE DATABASE \"${POSTGRES_DB}\";"

echo "==> pg_restore"
"$DC_CLOUD" exec "$PG_SERVICE" pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl /tmp/restore.dump

echo "==> Levantando ${RESTORE_STOP_SERVICES}"
"$DC_CLOUD" up -d "${stop_services[@]}"

echo "Listo."
