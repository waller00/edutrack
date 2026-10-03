#!/usr/bin/env bash
# Espera a que API y frontend respondan (post-deploy / recover).
# Por defecto valida dentro de los contenedores, para funcionar aunque los
# puertos publicos directos de auth/web esten cerrados en produccion.
set -euo pipefail

API_URL="${DEPLOY_HEALTH_API_URL:-http://127.0.0.1:4000/ready}"
WEB_URL="${DEPLOY_HEALTH_WEB_URL:-http://127.0.0.1:3000/}"
HEALTH_MODE="${DEPLOY_HEALTH_MODE:-internal}"
# Tras cambios de schema, `prisma db push` puede tardar varios minutos en tablas grandes.
MAX_ATTEMPTS="${DEPLOY_HEALTH_ATTEMPTS:-120}"
SLEEP_SEC="${DEPLOY_HEALTH_SLEEP_SEC:-5}"
COMPOSE_FILES="${DEPLOY_COMPOSE_FILES:--f docker-compose.cloud.yml}"

attempt=0
api_ok=0
web_ok=0

print_diagnostics() {
  echo "== Diagnóstico de deploy ==" >&2
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    echo "docker compose no disponible para diagnostico" >&2
    return
  fi

  # COMPOSE_FILES es controlado por los workflows/scripts del repo (-f docker-compose...).
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES ps >&2 || true
  echo "== Logs auth ==" >&2
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES logs --tail=220 auth >&2 || true
  echo "== Logs web ==" >&2
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES logs --tail=220 web >&2 || true
  echo "== Prueba interna web ==" >&2
  # No ocultar el error: muestra si fue rechazo HTTP o conexion a 127.0.0.1.
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES exec -T web node -e \
    "fetch('$WEB_URL').then(async r=>{console.error('HTTP',r.status,r.url);process.exit(r.ok?0:1)}).catch(e=>{console.error(e.cause?.code||e.message);process.exit(1)})" >&2 || true
  echo "== Logs db:optimize auth ==" >&2
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES exec -T auth sh -lc 'tail -120 /tmp/db-optimize.log 2>/dev/null || true' >&2 || true
}

while [ "$attempt" -lt "$MAX_ATTEMPTS" ]; do
  attempt=$((attempt + 1))
  if [ "$api_ok" -eq 0 ]; then
    if [ "$HEALTH_MODE" = "internal" ]; then
      # shellcheck disable=SC2086
      if docker compose $COMPOSE_FILES exec -T auth node -e "fetch('$API_URL').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
        api_ok=1
        echo "OK API: $API_URL"
      fi
    elif curl -sf "$API_URL" >/dev/null 2>&1; then
      api_ok=1
      echo "OK API: $API_URL"
    fi
  fi
  if [ "$web_ok" -eq 0 ]; then
    if [ "$HEALTH_MODE" = "internal" ]; then
      # shellcheck disable=SC2086
      if docker compose $COMPOSE_FILES exec -T web node -e "fetch('$WEB_URL').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
        web_ok=1
        echo "OK Web: $WEB_URL"
      fi
    elif curl -sf "$WEB_URL" >/dev/null 2>&1; then
      web_ok=1
      echo "OK Web: $WEB_URL"
    fi
  fi
  if [ "$api_ok" -eq 1 ] && [ "$web_ok" -eq 1 ]; then
    exit 0
  fi
  echo "Esperando servicios ($attempt/$MAX_ATTEMPTS)..."
  sleep "$SLEEP_SEC"
done

echo "Timeout: API ok=$api_ok Web ok=$web_ok" >&2
print_diagnostics
exit 1
