#!/bin/bash
# Despliega en PRODUCCIÓN el mismo código y stack que TESTING (rama develop + docker-compose.cloud.yml).
# Ejecutar en el Droplet de producción como root: bash scripts/deploy-prod-like-testing.sh
set -euo pipefail

cd /root/edutrack

PROD_HOST="${PROD_HOST:-165.22.34.95}"
PROD_BASE="http://${PROD_HOST}.nip.io"

echo "==> Backup .env"
cp -a .env ".env.bak.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true

echo "==> Código = origin/develop (igual que testing)"
git fetch origin
git reset --hard origin/develop
echo "HEAD: $(git log -1 --oneline)"

echo "==> Variables Keycloak/Redis en .env (si faltan)"
touch .env
ensure_var() {
  local key="$1" val="$2"
  if ! grep -q "^${key}=" .env 2>/dev/null; then
    echo "${key}=${val}" >> .env
  fi
}

ensure_var REDIS_URL "redis://redis:6379"
ensure_var PRISMA_DB_PUSH_FLAGS "--accept-data-loss"
sed -i 's/^PRISMA_DB_PUSH_FLAGS=--force-reset/PRISMA_DB_PUSH_FLAGS=--accept-data-loss/' .env 2>/dev/null || true

ensure_var FRONTEND_URL "${PROD_BASE}:3000"
ensure_var NEXT_PUBLIC_API_URL "${PROD_BASE}:4000"
ensure_var KEYCLOAK_ISSUER_URL "${PROD_BASE}:8089/realms/edutrack"
ensure_var KEYCLOAK_REDIRECT_URI "${PROD_BASE}:4000/auth/callback"
ensure_var KEYCLOAK_HOSTNAME "${PROD_BASE}:8089"
ensure_var KEYCLOAK_CLIENT_ID "edutrack-web"
ensure_var KEYCLOAK_ADMIN_BASE_URL "http://keycloak:8080"
ensure_var KEYCLOAK_ADMIN_REALM "edutrack"
ensure_var KEYCLOAK_ADMIN "admin"

if ! grep -q "^KEYCLOAK_CLIENT_SECRET=" .env; then
  echo "KEYCLOAK_CLIENT_SECRET=edutrack-web-secret-change-me" >> .env
  echo "AVISO: definí KEYCLOAK_CLIENT_SECRET en .env (copiá el de testing o rotá en prod)."
fi
if ! grep -q "^KEYCLOAK_ADMIN_PASSWORD=" .env; then
  echo "AVISO: falta KEYCLOAK_ADMIN_PASSWORD en .env — copialo del servidor de testing."
fi
if ! grep -q "^KEYCLOAK_DB_PASSWORD=" .env; then
  echo "KEYCLOAK_DB_PASSWORD=keycloak" >> .env
  echo "AVISO: conviene KEYCLOAK_DB_PASSWORD fuerte en prod."
fi

echo "==> Variables Moodle (auth + compose Moodle en edutrack_moodle-net)"
PROD_MOODLE_PUBLISH_PORT="${PROD_MOODLE_PUBLISH_PORT:-8082}"
PROD_MOODLE_HOST="${PROD_MOODLE_HOST:-${PROD_HOST}.nip.io:${PROD_MOODLE_PUBLISH_PORT}}"
ensure_var MOODLE_PUBLISH_PORT "${PROD_MOODLE_PUBLISH_PORT}"
ensure_var MOODLE_BASE_URL "http://moodle:8080"
ensure_var MOODLE_CANONICAL_HOST "${PROD_MOODLE_HOST}"
ensure_var MOODLE_HOST "${PROD_MOODLE_HOST}"
if ! grep -q "^MOODLE_WS_TOKEN=" .env; then
  echo "AVISO: falta MOODLE_WS_TOKEN — creá el token REST en Moodle prod y agregalo a .env (copiá el de testing si es la misma instancia)."
fi

echo "==> Variables biométrico ADMS (mismos valores que testing; F22 sin reconfigurar)"
ensure_var ZKTECO_ICLOCK_PORT "0"
ensure_var BIOMETRIC_DEVICE_CODE "F22-TEST-01"
ensure_var BIOMETRIC_ADMS_SERIAL "SRN5260500102"
ensure_var BIOMETRIC_DEVICE_NAME "ZKTeco F22 Testing"
ensure_var BIOMETRIC_DEVICE_SECRET "cambialo-por-un-secreto-largo"
ensure_var BIOMETRIC_DEVICE_TZ "America/Montevideo"

echo "==> Red Moodle"
docker network inspect edutrack_moodle-net >/dev/null 2>&1 || docker network create edutrack_moodle-net

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

CF="-f docker-compose.cloud.yml"

echo "==> Moodle (si aún no está levantado)"
if compose -f docker-compose.moodle.yml ps 2>/dev/null | grep -q "Up"; then
  echo "Moodle ya en ejecución."
else
  compose -f docker-compose.moodle.yml up -d || echo "AVISO: revisá docker-compose.moodle.yml (primera instalación ~5–8 min)."
fi

echo "==> Build y up (pg + redis + keycloak + auth + web)"
compose $CF down || true
compose $CF build --no-cache web
compose $CF build auth
compose $CF up -d

if grep -q "^MOODLE_WS_TOKEN=.\+" .env 2>/dev/null && grep -q "^BIOMETRIC_ADMS_SERIAL=.\+" .env 2>/dev/null; then
  echo "==> Seed dispositivo biométrico en BD (idempotente)"
  compose $CF exec -T auth npm run seed:biometric 2>/dev/null || true
fi

echo "==> Estado"
compose $CF ps
echo ""
echo "Health API:"
curl -sf http://127.0.0.1:4000/health || echo "(auth aún no responde — revisá logs)"
echo ""
echo "Keycloak (puerto 8089):"
curl -sf -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8089/ || true
echo ""
echo "Listo. Revisá: compose $CF logs --tail=40 auth keycloak"
echo "Si login falla: alineá KEYCLOAK_* y FRONTEND_URL con la URL pública real (Cloudflare/dominio)."
