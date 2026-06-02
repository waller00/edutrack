#!/usr/bin/env bash
# Helpers de Docker Compose v2 para deploy en el servidor.
# docker-compose v1 (Python) falla con Docker reciente: KeyError 'ContainerConfig'.
set -euo pipefail

ensure_compose_v2() {
  if docker compose version >/dev/null 2>&1; then
    return 0
  fi
  echo "Docker Compose v2 no encontrado; intentando instalar plugin local..." >&2

  local arch compose_arch compose_version plugin_dir plugin_path
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) compose_arch="x86_64" ;;
    aarch64|arm64) compose_arch="aarch64" ;;
    *)
      echo "WARN: arquitectura no soportada para instalacion automatica de Compose: $arch" >&2
      compose_arch=""
      ;;
  esac

  compose_version="${DOCKER_COMPOSE_VERSION:-v2.29.7}"
  plugin_dir="${DOCKER_CONFIG:-$HOME/.docker}/cli-plugins"
  plugin_path="$plugin_dir/docker-compose"

  if [ -n "$compose_arch" ] && { command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1; }; then
    mkdir -p "$plugin_dir"
    local compose_url
    compose_url="https://github.com/docker/compose/releases/download/${compose_version}/docker-compose-linux-${compose_arch}"
    if command -v curl >/dev/null 2>&1 && curl -fsSL "$compose_url" -o "$plugin_path"; then
      chmod +x "$plugin_path"
    elif command -v wget >/dev/null 2>&1 && wget -q "$compose_url" -O "$plugin_path"; then
      chmod +x "$plugin_path"
    else
      rm -f "$plugin_path"
      echo "WARN: no se pudo descargar Docker Compose ${compose_version}; pruebo apt si esta disponible" >&2
    fi
  fi

  if ! docker compose version >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq docker-compose-plugin || true
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
