#!/usr/bin/env bash
# Corrige permisos de /bitnami/moodledata (error "Invalid permissions... create a directory").
# Ejecutar en el VPS Moodle, desde la raíz del repo, con compose levantado o moodle parado.
#
#   ./scripts/moodle-fix-permissions.sh
#   MOODLE_ENV_FILE=.env.moodle ./scripts/moodle-fix-permissions.sh
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

VOL="$(docker volume ls -q | grep moodle_moodledata | head -1)"
if [[ -z "$VOL" ]]; then
  echo "No se encontró volumen moodle_moodledata" >&2
  exit 1
fi

echo "Volumen moodledata: $VOL"

# UID/GID del usuario Apache en la imagen Bitnami
read -r APACHE_UID APACHE_GID <<<"$(
  docker run --rm --entrypoint bash docker.io/bitnamilegacy/moodle:5.0.2 \
    -c 'id -u daemon; id -g daemon'
)"

echo "Usuario moodle/apache: daemon ($APACHE_UID:$APACHE_GID)"
if [[ -z "$APACHE_UID" || -z "$APACHE_GID" ]]; then
  echo "No se pudo leer UID/GID de daemon (¿salida contaminada por el entrypoint?)." >&2
  exit 1
fi

"${COMPOSE[@]}" stop moodle 2>/dev/null || true

docker run --rm -u root --entrypoint bash \
  -v "${VOL}:/bitnami/moodledata" \
  docker.io/bitnamilegacy/moodle:5.0.2 \
  -c "
    set -e
    mkdir -p /bitnami/moodledata/{temp,cache,localcache,sessions,filedir,lang,trashdir}
    chown -R ${APACHE_UID}:${APACHE_GID} /bitnami/moodledata
    find /bitnami/moodledata -type d -exec chmod 775 {} \;
    find /bitnami/moodledata -type f -exec chmod 664 {} \;
    chmod 775 /bitnami/moodledata
    echo ok-permissions
  "

"${COMPOSE[@]}" up -d moodle

CONTAINER="$(resolve_container)"
[[ -n "$CONTAINER" ]] || { echo "Moodle no arrancó" >&2; exit 1; }

for i in $(seq 1 30); do
  if docker exec "$CONTAINER" test -f /bitnami/moodle/config.php 2>/dev/null; then
    break
  fi
  sleep 2
done

docker exec -u root "$CONTAINER" chown -R "${APACHE_UID}:${APACHE_GID}" /bitnami/moodledata /bitnami/moodle 2>/dev/null || true
docker exec -u root "$CONTAINER" rm -rf /bitnami/moodledata/localcache/* /bitnami/moodledata/temp/* /bitnami/moodledata/cache/* 2>/dev/null || true
docker exec -u daemon "$CONTAINER" php /opt/bitnami/moodle/admin/cli/purge_caches.php 2>/dev/null || true

echo "Probar:"
echo "  curl -sI 'http://127.0.0.1:8080/theme/styles.php/boost/1/all' | head -3"
echo "  docker logs $CONTAINER --tail 20"
