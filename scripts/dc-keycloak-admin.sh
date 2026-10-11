#!/usr/bin/env bash
# Wrapper opt-in: no activa Serve ni cambia realms o restricciones publicas.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec docker compose \
  -f "$ROOT/docker-compose.cloud.yml" \
  -f "$ROOT/docker-compose.proxy.yml" \
  -f "$ROOT/docker-compose.close-ports.prod.yml" \
  -f "$ROOT/docker-compose.keycloak-admin.yml" \
  "$@"
