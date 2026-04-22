#!/usr/bin/env bash
# Wrapper: siempre usa Compose v2 contra docker-compose.cloud.yml (evita KeyError ContainerConfig de docker-compose v1).
# Uso: ./scripts/dc-cloud.sh up -d web auth
#      ./scripts/dc-cloud.sh exec pg psql -U postgres -c "SELECT 1"
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if docker compose version >/dev/null 2>&1; then
  exec docker compose -f "$ROOT/docker-compose.cloud.yml" "$@"
fi
echo "Falta el plugin Compose v2. En Ubuntu/Droplet:" >&2
echo "  sudo apt-get update && sudo apt-get install -y docker-compose-plugin" >&2
echo "Si no existe el paquete: https://docs.docker.com/engine/install/ubuntu/" >&2
exit 1
