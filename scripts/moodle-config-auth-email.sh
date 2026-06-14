#!/usr/bin/env bash
# Configura SSO OAuth2 y SMTP de Moodle para alinearlo con EduTrack.
#
# Uso (desde la raíz del repo, con Moodle levantado):
#   ./scripts/moodle-config-auth-email.sh
#   ENV_FILE=/root/edutrack/.env ./scripts/moodle-config-auth-email.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PHP_SCRIPT="$ROOT/scripts/moodle-config-auth-email.php"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

if [[ ! -f "$PHP_SCRIPT" ]]; then
  echo "No se encontró $PHP_SCRIPT" >&2
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
  echo "No se encontró el contenedor moodle." >&2
  exit 1
fi

echo "Contenedor Moodle: $CONTAINER"

docker cp "$PHP_SCRIPT" "$CONTAINER:/tmp/moodle-config-auth-email.php"

EXEC=(docker exec)
if [[ -f "$ENV_FILE" ]]; then
  echo "Variables SMTP desde: $ENV_FILE"
  EXEC+=(--env-file "$ENV_FILE")
else
  echo "AVISO: no hay $ENV_FILE; solo se aplicará OAuth sin SMTP." >&2
fi

"${EXEC[@]}" "$CONTAINER" php /tmp/moodle-config-auth-email.php

echo "Listo."
