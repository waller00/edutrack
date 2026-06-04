#!/usr/bin/env bash
# Corrige wwwroot en un Moodle Bitnami ya instalado (p. ej. redirige a localhost:8080).
# Ejecutar en el VPS Moodle, desde la raíz del repo, con el compose levantado.
#
#   MOODLE_PUBLIC_URL=https://moodle.edutrack-uy.com ./scripts/moodle-fix-production.sh
#   MOODLE_CONTAINER=mi-moodle-1 ./scripts/moodle-fix-production.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MOODLE_PUBLIC_URL="${MOODLE_PUBLIC_URL:-https://moodle.edutrack-uy.com}"
FIX_PHP="$ROOT/scripts/fix-moodle-config-production.php"

if [[ ! -f "$FIX_PHP" ]]; then
  echo "No se encontró $FIX_PHP" >&2
  exit 1
fi

resolve_container() {
  if [[ -n "${MOODLE_CONTAINER:-}" ]]; then
    echo "$MOODLE_CONTAINER"
    return
  fi
  local id
  id="$(docker compose -f docker-compose.moodle.yml ps -q moodle 2>/dev/null || true)"
  if [[ -n "$id" ]]; then
    docker ps -q --no-trunc --filter "id=$id" | head -n1
    return
  fi
  docker ps --filter "ancestor=docker.io/bitnamilegacy/moodle:5.0.2" --format '{{.Names}}' | head -n1
}

CONTAINER="$(resolve_container)"
if [[ -z "$CONTAINER" ]]; then
  echo "No se encontró el contenedor moodle. Definí MOODLE_CONTAINER o levantá docker compose -f docker-compose.moodle.yml up -d" >&2
  exit 1
fi

echo "Contenedor: $CONTAINER"
echo "URL pública: $MOODLE_PUBLIC_URL"

docker cp "$FIX_PHP" "$CONTAINER:/tmp/fix-moodle-config-production.php"
docker exec -e "MOODLE_PUBLIC_URL=$MOODLE_PUBLIC_URL" "$CONTAINER" php /tmp/fix-moodle-config-production.php
docker exec "$CONTAINER" php /opt/bitnami/moodle/admin/cli/purge_caches.php

echo "Listo. Probá en el navegador: $MOODLE_PUBLIC_URL"
