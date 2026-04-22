#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/docker_compose_cmd.sh
source "$ROOT_DIR/scripts/lib/docker_compose_cmd.sh"

INPUT_FILE="${1:-$ROOT_DIR/data.sql}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.cloud.yml}"
PG_SERVICE="${PG_SERVICE:-pg}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-asistencias}"

if [[ ! -f "$INPUT_FILE" ]]; then
  echo "No existe el archivo: $INPUT_FILE"
  exit 1
fi

echo "Importando dump desde $INPUT_FILE en la base $POSTGRES_DB"
docker_compose -f "$ROOT_DIR/$COMPOSE_FILE" exec -T "$PG_SERVICE" \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$INPUT_FILE"

echo "Importacion completada."
