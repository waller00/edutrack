# shellcheck shell=bash
# Preferir Compose v2 (plugin): docker-compose v1 falla con Docker Engine reciente
# (KeyError: 'ContainerConfig' al recrear contenedores).
docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "ADVERTENCIA: se usa docker-compose v1; con Docker reciente suele fallar (ContainerConfig). Instalá el plugin v2, p. ej.: sudo apt-get install -y docker-compose-plugin" >&2
    docker-compose "$@"
  else
    echo "No se encontró 'docker compose' ni 'docker-compose'." >&2
    return 127
  fi
}
