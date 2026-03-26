#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_FILE="${1:-$ROOT_DIR/data.sql}"
REMOTE_HOST="${REMOTE_HOST:-}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_PATH="${REMOTE_PATH:-/root/edutrack/data.sql}"

if [[ -z "$REMOTE_HOST" ]]; then
  echo "Falta REMOTE_HOST. Ejemplo: REMOTE_HOST=1.2.3.4 $0"
  exit 1
fi

if [[ ! -f "$LOCAL_FILE" ]]; then
  echo "No existe el archivo: $LOCAL_FILE"
  exit 1
fi

echo "Copiando $LOCAL_FILE a $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH"
scp "$LOCAL_FILE" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH"
echo "Archivo enviado correctamente."
