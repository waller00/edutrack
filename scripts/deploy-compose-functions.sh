#!/usr/bin/env bash
# Helpers de Docker Compose v2 para deploy en el servidor.
# docker-compose v1 (Python) falla con Docker reciente: KeyError 'ContainerConfig'.
set -euo pipefail

ensure_compose_v2() {
  if docker compose version >/dev/null 2>&1; then
    return 0
  fi
  echo "Docker Compose v2 no encontrado; intentando instalar plugin..." >&2
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq docker-compose-plugin
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: se requiere 'docker compose' (v2). docker-compose v1 no es compatible." >&2
    exit 1
  fi
}

compose() {
  ensure_compose_v2
  docker compose "$@"
}

# Recrea servicios: stop + rm + up (evita --force-recreate con compose v1 legacy).
# Uso: compose_recreate_services -f docker-compose.cloud.yml web auth
compose_recreate_services() {
  local compose_files=()
  local services=()
  local arg skip_next=0
  for arg in "$@"; do
    if [ "$skip_next" -eq 1 ]; then
      compose_files+=(-f "$arg")
      skip_next=0
      continue
    fi
    if [ "$arg" = "-f" ]; then
      skip_next=1
      continue
    fi
    services+=("$arg")
  done
  if [ "${#services[@]}" -eq 0 ]; then
    compose "${compose_files[@]}" up -d
    return
  fi
  compose "${compose_files[@]}" stop "${services[@]}" 2>/dev/null || true
  compose "${compose_files[@]}" rm -f "${services[@]}" 2>/dev/null || true
  compose "${compose_files[@]}" up -d --no-build "${services[@]}"
}
