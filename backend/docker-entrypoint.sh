#!/bin/sh
# Arranque de producción: schema rápido (sin índices pesados en db push) + API + SQL en background.
set -eu

PUSH_FLAGS="${PRISMA_DB_PUSH_FLAGS:-}"
echo "[auth] prisma db push --skip-generate ${PUSH_FLAGS}"

if command -v timeout >/dev/null 2>&1; then
  timeout 300 npx prisma db push --skip-generate ${PUSH_FLAGS}
else
  npx prisma db push --skip-generate ${PUSH_FLAGS}
fi

echo "[auth] optimizaciones SQL en segundo plano (indices, pg_trgm)..."
(npm run db:optimize >>/tmp/db-optimize.log 2>&1 || echo "[auth] WARN: db:optimize falló; ver /tmp/db-optimize.log") &

echo "[auth] iniciando servidor..."
exec npm start
