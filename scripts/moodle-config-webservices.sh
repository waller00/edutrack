#!/usr/bin/env bash
# Habilita REST y autoriza el token del servicio web EduTrack en Moodle.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PHP_SCRIPT="$ROOT/scripts/moodle-config-webservices.php"

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
  echo "No se encontró el contenedor moodle." >&2
  exit 1
fi

docker cp "$PHP_SCRIPT" "$CONTAINER:/tmp/moodle-config-webservices.php"
docker exec "$CONTAINER" php /tmp/moodle-config-webservices.php
