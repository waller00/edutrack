#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_FILE="${1:-$ROOT_DIR/data.sql}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
PG_SERVICE="${PG_SERVICE:-pg}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-asistencias}"

echo "Exportando base local a: $OUTPUT_FILE"
mkdir -p "$(dirname "$OUTPUT_FILE")"

docker compose -f "$ROOT_DIR/$COMPOSE_FILE" exec -T "$PG_SERVICE" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges \
  > "$OUTPUT_FILE"

echo "Dump generado correctamente."
