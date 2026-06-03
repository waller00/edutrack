#!/usr/bin/env bash
# Espera a que API y frontend respondan en localhost (post-deploy / recover).
set -euo pipefail

API_URL="${DEPLOY_HEALTH_API_URL:-http://127.0.0.1:4000/health}"
WEB_URL="${DEPLOY_HEALTH_WEB_URL:-http://127.0.0.1:3000/}"
# Tras cambios de schema, `prisma db push` puede tardar varios minutos en tablas grandes.
MAX_ATTEMPTS="${DEPLOY_HEALTH_ATTEMPTS:-120}"
SLEEP_SEC="${DEPLOY_HEALTH_SLEEP_SEC:-5}"

attempt=0
api_ok=0
web_ok=0

while [ "$attempt" -lt "$MAX_ATTEMPTS" ]; do
  attempt=$((attempt + 1))
  if [ "$api_ok" -eq 0 ] && curl -sf "$API_URL" >/dev/null 2>&1; then
    api_ok=1
    echo "OK API: $API_URL"
  fi
  if [ "$web_ok" -eq 0 ] && curl -sf "$WEB_URL" >/dev/null 2>&1; then
    web_ok=1
    echo "OK Web: $WEB_URL"
  fi
  if [ "$api_ok" -eq 1 ] && [ "$web_ok" -eq 1 ]; then
    exit 0
  fi
  echo "Esperando servicios ($attempt/$MAX_ATTEMPTS)..."
  sleep "$SLEEP_SEC"
done

echo "Timeout: API ok=$api_ok Web ok=$web_ok" >&2
exit 1
