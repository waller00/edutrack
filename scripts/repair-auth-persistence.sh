#!/usr/bin/env bash
# Repara drift persistente de auth local/cloud sin borrar volumenes:
# - alinea password real del rol Postgres con DATABASE_URL/.env
# - aplica settings vivos de Keycloak desde keycloak/realm-edutrack.json
# - recrea auth/web para tomar la configuracion corregida
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
CF="-f $COMPOSE_FILE"

docker network inspect edutrack_moodle-net >/dev/null 2>&1 || docker network create edutrack_moodle-net >/dev/null

DEPLOY_COMPOSE_FILES="$CF" bash scripts/postgres-apply-role-password.sh

docker compose $CF up -d keycloak
bash scripts/keycloak-apply-realm-settings.sh
docker compose $CF up -d --force-recreate auth web

echo ">> OK. Auth reparado. Verificando /ready ..."
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4000/ready >/dev/null; then
    echo ">> OK. API lista."
    exit 0
  fi
  echo "   intento $attempt/30: API aun no lista, reintento en 3s..."
  sleep 3
done

echo "ERROR: la API no quedo lista; revisa: docker compose $CF logs --tail=200 auth" >&2
exit 1
