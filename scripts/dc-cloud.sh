#!/usr/bin/env bash
# Wrapper: siempre usa Compose v2 contra el stack cloud endurecido.
# Publica solo el reverse-proxy (80/443); web/auth/keycloak quedan privados.
# Uso: ./scripts/dc-cloud.sh up -d web auth reverse-proxy
#      ./scripts/dc-cloud.sh exec pg psql -U postgres -c "SELECT 1"
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if docker compose version >/dev/null 2>&1; then
  exec docker compose \
    -f "$ROOT/docker-compose.cloud.yml" \
    -f "$ROOT/docker-compose.proxy.yml" \
    -f "$ROOT/docker-compose.close-ports.prod.yml" \
    "$@"
fi
echo "Falta el plugin Compose v2. En Ubuntu/Droplet:" >&2
echo "  sudo apt-get update && sudo apt-get install -y docker-compose-plugin" >&2
echo "Si no existe el paquete: https://docs.docker.com/engine/install/ubuntu/" >&2
exit 1
