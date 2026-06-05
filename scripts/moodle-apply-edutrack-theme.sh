#!/usr/bin/env bash
# Instala/actualiza y activa el tema EduTrack en Moodle.
#
# Uso local:
#   docker compose -f docker-compose.moodle.yml up -d
#   ./scripts/moodle-apply-edutrack-theme.sh
#
# Produccion:
#   MOODLE_PUBLIC_URL=https://moodle.edutrack-uy.com MOODLE_ENV_FILE=.env.moodle ./scripts/moodle-apply-edutrack-theme.sh
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

resolve_moodle_dir() {
  if docker exec "$CONTAINER" test -f /bitnami/moodle/admin/cli/cfg.php 2>/dev/null; then
    echo "/bitnami/moodle"
    return
  fi
  if docker exec "$CONTAINER" test -f /opt/bitnami/moodle/admin/cli/cfg.php 2>/dev/null; then
    echo "/opt/bitnami/moodle"
    return
  fi
}

echo "Esperando config.php de Moodle..."
for i in $(seq 1 90); do
  if docker exec "$CONTAINER" test -f /opt/bitnami/moodle/config.php 2>/dev/null; then
    break
  fi
  if docker exec "$CONTAINER" test -f /bitnami/moodle/config.php 2>/dev/null; then
    docker exec -u root "$CONTAINER" ln -sf /bitnami/moodle/config.php /opt/bitnami/moodle/config.php 2>/dev/null || true
    break
  fi
  sleep 2
done

if ! docker exec "$CONTAINER" test -f /opt/bitnami/moodle/config.php 2>/dev/null; then
  echo "Moodle todavia no tiene /opt/bitnami/moodle/config.php." >&2
  echo "Revisa logs: ${COMPOSE[*]} logs --tail=80 moodle" >&2
  exit 1
fi

MOODLE_DIR="$(resolve_moodle_dir)"
if [[ -z "$MOODLE_DIR" ]]; then
  echo "No se encontro el CLI de Moodle dentro del contenedor." >&2
  echo "Revisa si existe /bitnami/moodle/admin/cli/cfg.php o /opt/bitnami/moodle/admin/cli/cfg.php." >&2
  exit 1
fi
echo "Directorio Moodle: $MOODLE_DIR"

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

if [[ -n "${MOODLE_PUBLIC_URL:-}" ]]; then
  FIX_PHP="$ROOT/scripts/fix-moodle-config-production.php"
  if [[ ! -f "$FIX_PHP" ]]; then
    echo "No se encontro $FIX_PHP para corregir la URL publica." >&2
    exit 1
  fi
  echo "Corrigiendo URL publica de Moodle: $MOODLE_PUBLIC_URL"
  docker cp "$FIX_PHP" "$CONTAINER:/tmp/fix-moodle-config-production.php"
  docker exec -e "MOODLE_PUBLIC_URL=$MOODLE_PUBLIC_URL" "$CONTAINER" php /tmp/fix-moodle-config-production.php
fi

docker exec -u daemon "$CONTAINER" php "$MOODLE_DIR/admin/cli/upgrade.php" --non-interactive
if docker exec "$CONTAINER" test -f "$MOODLE_DIR/admin/tool/langimport/cli/import.php" 2>/dev/null; then
  docker exec -u daemon "$CONTAINER" php "$MOODLE_DIR/admin/tool/langimport/cli/import.php" --lang=es || true
fi
docker exec -u daemon "$CONTAINER" php "$MOODLE_DIR/admin/cli/cfg.php" --name=theme --set=edutrack
docker exec -u daemon "$CONTAINER" php "$MOODLE_DIR/admin/cli/cfg.php" --name=lang --set=es
docker exec -u daemon "$CONTAINER" php "$MOODLE_DIR/admin/cli/cfg.php" --name=langmenu --set=0
docker exec -u daemon "$CONTAINER" php "$MOODLE_DIR/admin/cli/cfg.php" --name=guestloginbutton --set=0
docker exec -u daemon "$CONTAINER" php "$MOODLE_DIR/admin/cli/cfg.php" --name=registerauth --set=
docker exec -u daemon "$CONTAINER" php "$MOODLE_DIR/admin/cli/cfg.php" --name=auth_instructions --set=
docker exec -u daemon "$CONTAINER" php "$MOODLE_DIR/admin/cli/purge_caches.php"

echo "Tema activo:"
docker exec -u daemon "$CONTAINER" php "$MOODLE_DIR/admin/cli/cfg.php" --name=theme
echo "Idioma activo:"
docker exec -u daemon "$CONTAINER" php "$MOODLE_DIR/admin/cli/cfg.php" --name=lang
