#!/usr/bin/env bash
# Libera espacio en el Droplet antes de git fetch / docker build.
#
# IMPORTANTE: la limpieza a fondo (docker builder prune -af) solo corre si el
# disco supera el umbral. Vaciar el build cache en cada deploy hace que
# `next build` de web se reconstruya de cero y reviente el command_timeout del
# job de deploy (incidente 2026-06-13). Con disco holgado, conservar el cache.
set -euo pipefail

THRESHOLD="${DISK_CLEANUP_THRESHOLD:-80}"   # % de uso a partir del cual limpiar a fondo

echo "== Disco antes =="
df -h / || true
docker system df 2>/dev/null || true

# Limpieza liviana siempre: contenedores parados + imagenes dangling + logs.
# No toca el build cache ni imagenes etiquetadas en uso.
docker container prune -f 2>/dev/null || true
docker image prune -f 2>/dev/null || true
journalctl --vacuum-time=3d 2>/dev/null || true
apt-get clean 2>/dev/null || true

usage="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
usage="${usage:-0}"

if [ "$usage" -ge "$THRESHOLD" ]; then
  echo "Disco al ${usage}% (>= ${THRESHOLD}%): limpieza a fondo (se pierde build cache)."
  docker builder prune -af 2>/dev/null || true
  docker image prune -af 2>/dev/null || true
  # Imágenes viejas de EduTrack (conserva volúmenes pg/redis/keycloak)
  docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' 2>/dev/null | \
    awk '$1 !~ /^edutrack-(web|auth):latest$/ {print $2}' | \
    xargs -r docker rmi -f 2>/dev/null || true
else
  echo "Disco al ${usage}% (< ${THRESHOLD}%): se conserva el build cache."
fi

echo "== Disco después =="
df -h / || true
