#!/bin/sh
# Arranque de producción: schema rápido (sin índices pesados en db push) + API + SQL en background.
set -eu

PUSH_FLAGS="${PRISMA_DB_PUSH_FLAGS:-}"
PUSH_TIMEOUT_SEC="${PRISMA_DB_PUSH_TIMEOUT_SEC:-120}"
PUSH_REQUIRED="${PRISMA_DB_PUSH_REQUIRED:-0}"

echo "[auth] prisma db push --skip-generate ${PUSH_FLAGS} (timeout ${PUSH_TIMEOUT_SEC}s)"

set +e
if command -v timeout >/dev/null 2>&1; then
  timeout "$PUSH_TIMEOUT_SEC" npx prisma db push --skip-generate ${PUSH_FLAGS}
  push_status=$?
else
  npx prisma db push --skip-generate ${PUSH_FLAGS}
  push_status=$?
fi
set -e

if [ "$push_status" -ne 0 ]; then
  echo "[auth] WARN: prisma db push terminó con status ${push_status}; inicio API de todos modos."
  echo "[auth] WARN: si este deploy incluye cambios obligatorios de schema, revisar logs y ejecutar db push manualmente."
  if [ "$PUSH_REQUIRED" = "1" ] || [ "$PUSH_REQUIRED" = "true" ]; then
    echo "[auth] PRISMA_DB_PUSH_REQUIRED=${PUSH_REQUIRED}; abortando arranque."
    exit "$push_status"
  fi
fi

echo "[auth] optimizaciones SQL en segundo plano (indices, pg_trgm)..."
(npm run db:optimize >>/tmp/db-optimize.log 2>&1 || echo "[auth] WARN: db:optimize falló; ver /tmp/db-optimize.log") &

echo "[auth] iniciando servidor..."
exec npm start
