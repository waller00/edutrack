#!/usr/bin/env bash
#
# crowdsec-triage.sh — Revisión de alertas de CrowdSec, solo lectura.
#
# No crea ni borra decisiones, no cambia el modo de simulación y no escribe en
# la base. Solo lista e inspecciona alertas para la revisión periódica.
#
# Uso:
#   ./scripts/crowdsec-triage.sh                 # últimas 50 alertas
#   ./scripts/crowdsec-triage.sh --limit 200     # más historial
#   ./scripts/crowdsec-triage.sh --ip 203.0.113.7
#   ./scripts/crowdsec-triage.sh --id 42         # detalle de una alerta
#   ./scripts/crowdsec-triage.sh --json          # salida JSON
#
# Requiere que el proyecto docker-compose.crowdsec.yml esté levantado.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="${CROWDSEC_COMPOSE_FILE:-$ROOT/docker-compose.crowdsec.yml}"
LIMIT=50
IP=""
ALERT_ID=""
JSON=0

usage() {
  cat <<'EOF'
Uso: ./scripts/crowdsec-triage.sh [opciones]

Opciones:
  --limit N      máximo de alertas a listar (default 50)
  --ip IP        alertas de una IP
  --id ID        detalle de una alerta
  --json         salida JSON
  -h, --help     esta ayuda

Solo lectura: no crea ni borra decisiones.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit)
      LIMIT="${2:?Falta el valor de --limit}"
      shift 2
      ;;
    --ip)
      IP="${2:?Falta la IP}"
      shift 2
      ;;
    --id)
      ALERT_ID="${2:?Falta el ID}"
      shift 2
      ;;
    --json)
      JSON=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Opción desconocida: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERROR: no existe $COMPOSE_FILE" >&2
  exit 2
fi

CID="$(docker compose -f "$COMPOSE_FILE" ps -q crowdsec 2>/dev/null || true)"
if [[ -z "$CID" ]]; then
  echo "ERROR: el contenedor crowdsec no está corriendo." >&2
  echo "       Levantalo con: docker compose -f docker-compose.crowdsec.yml up -d" >&2
  exit 1
fi

run() {
  docker compose -f "$COMPOSE_FILE" exec -T crowdsec cscli "$@"
}

echo "== CrowdSec triage (solo lectura) =="
echo "No se crean ni borran decisiones. El detalle por IP queda en la salida."
echo

if [[ -n "$ALERT_ID" ]]; then
  run alerts inspect -d "$ALERT_ID"
elif [[ -n "$IP" ]]; then
  run alerts list --ip "$IP" --limit "$LIMIT"
elif [[ "$JSON" -eq 1 ]]; then
  run alerts list -o json --limit "$LIMIT"
else
  run alerts list --limit "$LIMIT"
fi

echo
echo "Detalle de una alerta:  $0 --id <ID>"
echo "Alertas de una IP:      $0 --ip <IP>"
echo "Simulación y bouncers:  docker compose -f docker-compose.crowdsec.yml exec -T crowdsec cscli simulation status"
echo "                        docker compose -f docker-compose.crowdsec.yml exec -T crowdsec cscli bouncers list"
