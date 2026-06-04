#!/usr/bin/env bash
# Recupera variables de entorno desde contenedores Docker aún en ejecución
# (útil si se sobrescribió .env por error). NO incluye secretos de archivos nunca cargados.
#
#   ./scripts/recover-env-from-containers.sh
#   ./scripts/recover-env-from-containers.sh --compose docker-compose.cloud.yml --service auth
set -euo pipefail

COMPOSE_FILE="docker-compose.cloud.yml"
SERVICE=""
OUT=".env.recovered"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --compose) COMPOSE_FILE="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "Uso: $0 [--compose FILE] [--service NAME] [--out FILE]" >&2; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "No existe $COMPOSE_FILE" >&2
  exit 1
fi

ids=()
if [[ -n "$SERVICE" ]]; then
  id="$(docker compose -f "$COMPOSE_FILE" ps -q "$SERVICE" 2>/dev/null || true)"
  [[ -n "$id" ]] && ids+=("$id")
else
  while read -r id; do
    [[ -n "$id" ]] && ids+=("$id")
  done < <(docker compose -f "$COMPOSE_FILE" ps -q 2>/dev/null || true)
fi

if [[ ${#ids[@]} -eq 0 ]]; then
  echo "No hay contenedores corriendo para $COMPOSE_FILE. Probá: docker ps" >&2
  exit 1
fi

declare -A seen
{
  echo "# Recuperado $(date -Iseconds) desde contenedores en ejecución"
  echo "# Revisá, completá lo que falte y renombrá a .env cuando esté bien:"
  echo "#   mv .env.recovered .env"
  echo "# NO commitear este archivo."
  echo ""
  for id in "${ids[@]}"; do
    name="$(docker inspect --format '{{.Name}}' "$id" | sed 's#^/##')"
    echo "# --- $name ---"
    while IFS= read -r line; do
      key="${line%%=*}"
      [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
      [[ -n "${seen[$key]+x}" ]] && continue
      seen[$key]=1
      printf '%s\n' "$line"
    done < <(docker inspect "$id" --format '{{range .Config.Env}}{{println .}}{{end}}' | LC_ALL=C sort)
    echo ""
  done
} > "$OUT"

echo "Escrito: $OUT ($(wc -l < "$OUT") líneas, ${#seen[@]} variables únicas)"
echo "Editá el archivo, restaurá secretos que falten (GitHub Secrets, Keycloak, etc.) y: mv $OUT .env"
