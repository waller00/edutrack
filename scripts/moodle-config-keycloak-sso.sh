#!/usr/bin/env bash
# Configura SSO Moodle ↔ Keycloak (client OIDC + emisor OAuth2 + auth oauth2).
#
# Uso local (Keycloak :8089, Moodle :8080):
#   ./scripts/moodle-config-keycloak-sso.sh
#
# Producción:
#   MOODLE_PUBLIC_URL=https://moodle.edutrack-uy.com \
#   KEYCLOAK_ISSUER_URL=https://auth.edutrack-uy.com/realms/edutrack \
#   ./scripts/moodle-config-keycloak-sso.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

env_get() {
  local key="$1"
  [ -f .env ] || return 0
  sed -n "s/^[[:space:]]*${key}=//p" .env | tail -n1
}

PHP_SCRIPT="$ROOT/scripts/moodle-config-keycloak-sso.php"
MOODLE_PUBLIC_URL="${MOODLE_PUBLIC_URL:-http://localhost:8080}"
KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL:-$(env_get KEYCLOAK_ISSUER_URL)}"
KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL:-http://localhost:8089/realms/edutrack}"
KEYCLOAK_INTERNAL_URL="${KEYCLOAK_INTERNAL_URL:-$(env_get KEYCLOAK_INTERNAL_URL)}"
KEYCLOAK_INTERNAL_URL="${KEYCLOAK_INTERNAL_URL:-http://keycloak:8080}"
MOODLE_KEYCLOAK_CLIENT_ID="${MOODLE_KEYCLOAK_CLIENT_ID:-moodle}"
MOODLE_KEYCLOAK_CLIENT_SECRET="${MOODLE_KEYCLOAK_CLIENT_SECRET:-moodle-sso-secret-change-me}"

# Discovery desde el contenedor Moodle: host.docker.internal en local; issuer público en prod.
if [[ "$KEYCLOAK_ISSUER_URL" == http://localhost:* || "$KEYCLOAK_ISSUER_URL" == http://127.0.0.1:* ]]; then
  MOODLE_KEYCLOAK_DISCOVERY_INTERNAL="${MOODLE_KEYCLOAK_DISCOVERY_INTERNAL:-http://host.docker.internal:8089/realms/edutrack}"
else
  MOODLE_KEYCLOAK_DISCOVERY_INTERNAL="${MOODLE_KEYCLOAK_DISCOVERY_INTERNAL:-$KEYCLOAK_ISSUER_URL}"
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
  docker ps --filter "ancestor=docker.io/bitnamilegacy/moodle:5.0.2" --format '{{.ID}}' | head -n1
}

echo "== 1/2 Keycloak: client OIDC moodle =="
chmod +x "$ROOT/scripts/keycloak-config-moodle-client.sh"
MOODLE_PUBLIC_URL="$MOODLE_PUBLIC_URL" \
MOODLE_KEYCLOAK_CLIENT_ID="$MOODLE_KEYCLOAK_CLIENT_ID" \
MOODLE_KEYCLOAK_CLIENT_SECRET="$MOODLE_KEYCLOAK_CLIENT_SECRET" \
"$ROOT/scripts/keycloak-config-moodle-client.sh"

CONTAINER="$(resolve_container)"
if [[ -z "$CONTAINER" ]]; then
  echo "No se encontró el contenedor moodle." >&2
  exit 1
fi
echo "Contenedor Moodle: $CONTAINER"

echo "== 2/2 Moodle: emisor OAuth2 + auth oauth2 =="
docker cp "$PHP_SCRIPT" "$CONTAINER:/tmp/moodle-config-keycloak-sso.php"
docker exec \
  -e "KEYCLOAK_ISSUER_URL=$KEYCLOAK_ISSUER_URL" \
  -e "MOODLE_KEYCLOAK_ISSUER=$KEYCLOAK_ISSUER_URL" \
  -e "MOODLE_KEYCLOAK_DISCOVERY_INTERNAL=$MOODLE_KEYCLOAK_DISCOVERY_INTERNAL" \
  -e "MOODLE_KEYCLOAK_CLIENT_ID=$MOODLE_KEYCLOAK_CLIENT_ID" \
  -e "MOODLE_KEYCLOAK_CLIENT_SECRET=$MOODLE_KEYCLOAK_CLIENT_SECRET" \
  "$CONTAINER" php /tmp/moodle-config-keycloak-sso.php

docker exec -u daemon "$CONTAINER" php /bitnami/moodle/admin/cli/purge_caches.php

echo "== Listo =="
echo "Probar login: ${MOODLE_PUBLIC_URL%/}/login/index.php"
echo "Opcional en .env del backend: MOODLE_USER_AUTH=oauth2"
