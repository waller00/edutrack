#!/usr/bin/env bash
# Instala/actualiza y activa el tema EduTrack en Moodle.
#
# Uso local:
#   docker compose -f docker-compose.moodle.yml up -d
#   ./scripts/moodle-apply-edutrack-theme.sh
#
# Produccion:
#   MOODLE_ENV_FILE=.env.moodle ./scripts/moodle-apply-edutrack-theme.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.moodle.yml)
MOODLE_ENV_FILE="${MOODLE_ENV_FILE:-.env.moodle}"
[[ -f "$MOODLE_ENV_FILE" ]] && COMPOSE+=(--env-file "$MOODLE_ENV_FILE")

resolve_container() {
  if [[ -n "${MOODLE_CONTAINER:-}" ]]; then
    echo "$MOODLE_CONTAINER"
    return
  fi
  local id
  id="$("${COMPOSE[@]}" ps -q moodle 2>/dev/null || true)"
  [[ -n "$id" ]] && docker ps -q --filter "id=$id" | head -n1 && return
  docker ps --filter "ancestor=docker.io/bitnamilegacy/moodle:5.0.2" --format '{{.ID}}' | head -n1
}

CONTAINER="$(resolve_container)"
if [[ -z "$CONTAINER" ]]; then
  echo "No se encontro el contenedor moodle. Levantalo con docker compose -f docker-compose.moodle.yml up -d" >&2
  exit 1
fi

echo "Contenedor Moodle: $CONTAINER"

if ! test -f "$ROOT/moodle/theme/edutrack/version.php"; then
  echo "No se encontro el tema en el repo: $ROOT/moodle/theme/edutrack/version.php" >&2
  echo "Asegurate de estar en el repo actualizado y de haber hecho git pull." >&2
  exit 1
fi

if ! docker exec "$CONTAINER" test -f /bitnami/moodle/theme/edutrack/version.php; then
  echo "El tema no esta montado dentro del contenedor Moodle." >&2
  echo "Recrea el servicio para que tome el volumen del docker-compose.moodle.yml:" >&2
  echo "  ${COMPOSE[*]} up -d --force-recreate moodle" >&2
  exit 1
fi

docker exec -u daemon "$CONTAINER" php /opt/bitnami/moodle/admin/cli/upgrade.php --non-interactive
docker exec -u daemon "$CONTAINER" php /opt/bitnami/moodle/admin/cli/cfg.php --name=theme --set=edutrack
docker exec -u daemon "$CONTAINER" php /opt/bitnami/moodle/admin/cli/purge_caches.php

echo "Tema activo:"
docker exec -u daemon "$CONTAINER" php /opt/bitnami/moodle/admin/cli/cfg.php --name=theme
