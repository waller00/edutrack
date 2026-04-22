#!/usr/bin/env bash
# Restaura un dump en formato custom de pg_dump (-Fc), típico prod-asistencias.dump.
# No reinicia Postgres: solo para web/auth, luego DROP/CREATE DB y pg_restore.
#
# Uso en el servidor (desde la raíz del repo, p. ej. ~/edutrack):
#   ./scripts/restore_pg_custom_dump_cloud.sh /root/prod-asistencias.dump
#
# Requisito: preferir "docker compose" (v2). Ver docs/TESTING_DB_RESTORE.md
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DC_CLOUD="$ROOT_DIR/scripts/dc-cloud.sh"
DUMP_PATH="${1:-}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-asistencias}"
PG_SERVICE="${PG_SERVICE:-pg}"

if [[ -z "$DUMP_PATH" || ! -f "$DUMP_PATH" ]]; then
  echo "Uso: $0 /ruta/al/archivo.dump" >&2
  echo "El archivo no existe o no indicaste ruta: ${DUMP_PATH:-"(vacío)"}" >&2
  exit 1
fi

echo "==> Parando web y auth (Postgres sigue corriendo)"
"$DC_CLOUD" stop web auth

PG_CID="$("$DC_CLOUD" ps -q "$PG_SERVICE")"
if [[ -z "$PG_CID" ]]; then
  echo "No hay contenedor para el servicio '$PG_SERVICE'. ¿Está levantado Postgres?" >&2
  exit 1
fi

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

echo "==> Levantando web y auth"
"$DC_CLOUD" up -d web auth

echo "Listo."
