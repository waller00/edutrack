#!/usr/bin/env bash
# Valida la config del reverse-proxy con `nginx -t`, con la misma imagen que producción.
#
# Un error de sintaxis en nginx.conf no lo ve ningún test, y en el deploy el reverse-proxy no
# levanta: se cae el sitio entero. Esto corre en CI y como corte antes de desplegar.
#
# Uso (necesita Docker): ./scripts/check-nginx-config.sh [ruta/al/nginx.conf]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="${1:-$ROOT_DIR/nginx/reverse-proxy/nginx.conf}"
IMAGE="${NGINX_IMAGE:-$(awk '/image: *nginx:/ {print $2; exit}' "$ROOT_DIR/docker-compose.proxy.yml")}"

[[ -f "$CONF" ]] || { echo "No existe $CONF" >&2; exit 1; }

# Git Bash (Windows) convierte a rutas de Windows todo lo que empieza con "/": a openssl se le
# excluye sólo el "/CN=…", y a docker se le pasan rutas ya convertidas con cygpath. En Linux
# (CI, servidor) estas variables no hacen nada.
docker_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

# Certificado descartable: nginx -t abre los archivos de ssl_certificate.
# Dentro del repo (.tmp/ está en .gitignore): Docker Desktop no monta carpetas de %TEMP%.
mkdir -p "$ROOT_DIR/.tmp"
CERT_DIR="$(mktemp -d "$ROOT_DIR/.tmp/nginx-check.XXXXXX")"
trap 'rm -rf "$CERT_DIR"' EXIT
MSYS2_ARG_CONV_EXCL="/CN" openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj "/CN=nginx-config-check" \
  -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" >/dev/null 2>&1 \
  || { echo "openssl no pudo generar el certificado de prueba" >&2; exit 1; }
chmod 644 "$CERT_DIR"/*.pem

# Los upstream (auth, web, keycloak, moodle) se resuelven al cargar la config: se apuntan a
# localhost para que el chequeo sea de sintaxis y directivas, no de red.
hosts=()
while read -r host; do
  hosts+=(--add-host "$host:127.0.0.1")
done < <(grep -oE 'proxy_pass https?://[a-z0-9_.-]+' "$CONF" | sed -E 's#proxy_pass https?://##' | sort -u)

echo "==> nginx -t con $IMAGE ($(( ${#hosts[@]} / 2 )) upstreams apuntados a localhost)"
# Docker Desktop (Windows) a veces corta con "error during connect" al montar una carpeta recién
# creada; se reintenta sólo ese error. Un fallo de nginx -t no se reintenta.
for attempt in 1 2 3 4 5; do
  set +e
  output="$(MSYS_NO_PATHCONV=1 docker run --rm "${hosts[@]}" \
    -v "$(docker_path "$CONF"):/etc/nginx/nginx.conf:ro" \
    -v "$(docker_path "$CERT_DIR"):/etc/ssl/cloudflare:ro" \
    "$IMAGE" nginx -t 2>&1)"
  status=$?
  set -e
  if [[ $status -ne 0 && "$output" == *"error during connect"* && $attempt -lt 5 ]]; then
    sleep 3
    continue
  fi
  printf '%s\n' "$output" | grep -v "docker-entrypoint" || true
  exit "$status"
done
