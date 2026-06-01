#!/usr/bin/env bash
# Libera espacio en el Droplet antes de git fetch / docker build (evita "No space left on device").
set -euo pipefail

echo "== Disco antes =="
df -h / || true
docker system df 2>/dev/null || true

docker builder prune -af 2>/dev/null || true
docker image prune -af 2>/dev/null || true
docker container prune -f 2>/dev/null || true

# Imágenes viejas de EduTrack (conserva volúmenes pg/redis/keycloak)
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' 2>/dev/null | \
  awk '$1 !~ /^edutrack-(web|auth):latest$/ {print $2}' | \
  xargs -r docker rmi -f 2>/dev/null || true

journalctl --vacuum-time=3d 2>/dev/null || true
apt-get clean 2>/dev/null || true

echo "== Disco después =="
df -h / || true
