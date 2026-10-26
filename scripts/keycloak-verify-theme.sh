#!/usr/bin/env bash
# Comprueba (sólo lectura) que Keycloak sirva el CSS y el JS del tema `edutrack` iguales a los del
# commit desplegado y con el `?v=` de su `theme.properties`.
#
# Keycloak sirve una copia comprimida de cada recurso del tema (data/tmp/kc-gzip-cache) que no se
# entera de los cambios y sobrevive a `restart`; si el archivo viejo sale con el `?v=` nuevo,
# Cloudflare lo guarda 30 días. El deploy vacía esa caché al cambiar el tema
# (`keycloak_restart_for_theme`); esto confirma que lo servido es lo nuevo.
#
# Sale 0 si coincide, 1 si Keycloak sirve otra cosa y 2 si no lo pudo comprobar.
# Uso, en el servidor y desde la raíz del repo: bash scripts/keycloak-verify-theme.sh
#   KC_URL=https://auth.edutrack-uy.com para mirarlo desde afuera (pasa por Cloudflare).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

THEME="keycloak/themes/edutrack/login"
REALM="${REALM:-edutrack}"

# Mismo acceso que keycloak-apply-realm-settings.sh: en producción el 8089 está cerrado y se habla
# con la IP privada del contenedor.
discover_keycloak_url() {
  command -v docker >/dev/null 2>&1 || return 1
  local container_id container_ip
  container_id="$(docker ps --filter 'label=com.docker.compose.service=keycloak' --filter 'status=running' \
    --format '{{.ID}}' 2>/dev/null | head -n1)"
  [ -n "$container_id" ] || return 1
  container_ip="$(docker inspect -f "{{with index .NetworkSettings.Networks \"${KEYCLOAK_DOCKER_NETWORK:-edutrack_net}\"}}{{.IPAddress}}{{end}}" \
    "$container_id" 2>/dev/null)"
  [ -n "$container_ip" ] || return 1
  printf 'http://%s:8080' "$container_ip"
}

expected_version="$(git show "HEAD:$THEME/theme.properties" 2>/dev/null \
  | sed -n 's/^scripts=js\/edutrack-login\.js?v=\([0-9a-zA-Z]*\).*/\1/p' || true)"
[ -n "$expected_version" ] || { echo "WARN tema: no encontré el ?v= de $THEME/theme.properties en HEAD" >&2; exit 2; }

# Cualquier pantalla del tema trae sus <link> y <script>; la de error no necesita cliente ni sesión.
# Tras un reinicio Keycloak tarda en contestar: se espera hasta 3 minutos.
page=""
base=""
for attempt in $(seq 1 36); do
  base="${KC_URL:-$(discover_keycloak_url || echo "http://localhost:8089")}"
  page="$(curl -sS --max-time 10 "$base/realms/$REALM/protocol/openid-connect/auth" 2>/dev/null || true)"
  case "$page" in *edutrack-login.js*) break ;; esac
  if [ "$attempt" -lt 36 ]; then sleep 5; fi
done
case "$page" in
  *edutrack-login.js*) ;;
  *) echo "WARN tema: Keycloak ($base) no devolvió una pantalla del tema; no pude comprobarlo." >&2; exit 2 ;;
esac

status=0
for resource in css/edutrack.css js/edutrack-login.js; do
  served_path="$(printf '%s' "$page" | grep -o "/resources/[a-z0-9.-]*/login/edutrack/$resource?v=[0-9a-zA-Z]*" | head -n1 || true)"
  if [ -z "$served_path" ]; then
    echo "WARN tema: la pantalla no pide $resource; no pude comprobarlo." >&2
    exit 2
  fi
  served_version="${served_path##*v=}"
  # `--compressed` pide gzip, como Cloudflare y los navegadores: así sale la copia que guarda Keycloak.
  served_sha="$(curl -fsS --compressed --max-time 15 "$base$served_path" | sha256sum | cut -d' ' -f1)" || {
    echo "WARN tema: no pude bajar $base$served_path" >&2
    exit 2
  }
  commit_sha="$(git show "HEAD:$THEME/resources/$resource" | sha256sum | cut -d' ' -f1)"
  disk_sha="$(sha256sum "$THEME/resources/$resource" | cut -d' ' -f1)"

  if [ "$served_version" != "$expected_version" ]; then
    echo "ERROR tema: Keycloak pide $resource?v=$served_version y el commit dice ?v=$expected_version (¿no se reinició?)." >&2
    status=1
  elif [ "$served_sha" != "$commit_sha" ]; then
    echo "ERROR tema: Keycloak sirve otro $resource (servido ${served_sha:0:12}, commit ${commit_sha:0:12}, disco ${disk_sha:0:12})." >&2
    if [ "$disk_sha" = "$commit_sha" ]; then
      echo "  El disco está bien: es la caché comprimida de Keycloak (data/tmp/kc-gzip-cache)." >&2
    else
      echo "  El archivo en disco no es el del commit: revisar el checkout del servidor." >&2
    fi
    status=1
  else
    echo "OK tema: $resource?v=$served_version es el del commit."
  fi
done
exit "$status"
