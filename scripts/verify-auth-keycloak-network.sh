#!/usr/bin/env bash
# Verifica que el contenedor `auth` resuelva `keycloak` por DNS de Docker.
#
# Si no lo resuelve, el discovery OIDC del backend falla con EAI_AGAIN
# (getaddrinfo) y TODO el login queda roto: /auth/login responde
# 302 -> /login?error=oidc antes de redirigir a Keycloak.
#
# Causa tipica: `auth` y `keycloak` terminan en redes Docker distintas
# (p. ej. edutrack_appnet vs edutrack_net) cuando se mezclan archivos compose.
# Con la red unificada (name: edutrack_net en todos los compose) no deberia
# volver a pasar; este chequeo es el cinturon de seguridad del deploy.
#
# Uso: DEPLOY_COMPOSE_FILES="-f docker-compose.cloud.yml" bash scripts/verify-auth-keycloak-network.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/deploy-compose-functions.sh
. "$SCRIPT_DIR/deploy-compose-functions.sh"

CF="${DEPLOY_COMPOSE_FILES:--f docker-compose.cloud.yml}"

for i in $(seq 1 10); do
  if compose $CF exec -T auth getent hosts keycloak >/dev/null 2>&1; then
    echo "OK: el contenedor 'auth' resuelve 'keycloak' (red compartida correcta)."
    exit 0
  fi
  echo "auth todavia no resuelve 'keycloak' (intento $i/10)..."
  sleep 3
done

echo "ERROR: 'auth' no resuelve 'keycloak'. El login OIDC fallara con EAI_AGAIN." >&2
echo "Redes actuales de 'auth':" >&2
docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' \
  "$(compose $CF ps -q auth)" >&2 || true
echo "Revisa que 'auth' y 'keycloak' compartan la red edutrack_net." >&2
exit 1
