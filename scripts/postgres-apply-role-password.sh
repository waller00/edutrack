#!/usr/bin/env bash
# Alinea el password del rol Postgres persistido con el DATABASE_URL efectivo
# del servicio auth (docker compose config). .env queda como fallback.
#
# Los passwords de la imagen oficial de Postgres solo se aplican al inicializar
# el volumen. Si .env cambia despues, el contenedor arranca pero auth no puede
# conectar. Este script repara ese drift de forma idempotente antes de levantar
# el backend.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
COMPOSE_FILES="${DEPLOY_COMPOSE_FILES:--f docker-compose.cloud.yml}"
PG_SERVICE="${PG_SERVICE:-pg}"
PG_ADMIN_USER="${PG_ADMIN_USER:-postgres}"
PG_ADMIN_DB="${PG_ADMIN_DB:-postgres}"
MAX_ATTEMPTS="${POSTGRES_ROLE_PASSWORD_ATTEMPTS:-30}"
SLEEP_SEC="${POSTGRES_ROLE_PASSWORD_SLEEP_SEC:-2}"

[ -f "$ENV_FILE" ] || { echo "ERROR: no existe $ENV_FILE" >&2; exit 1; }
command -v python3 >/dev/null || { echo "ERROR: falta python3." >&2; exit 1; }
command -v docker >/dev/null || { echo "ERROR: falta docker." >&2; exit 1; }

SQL="$(
  ENV_FILE="$ENV_FILE" COMPOSE_FILES="$COMPOSE_FILES" python3 - <<'PY'
import os
import pathlib
import re
import shlex
import subprocess
import urllib.parse

def unquote(value: str) -> str:
    value = value.strip()
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    return value

def env_file_values() -> dict[str, str]:
    env_file = pathlib.Path(os.environ["ENV_FILE"])
    values = {}
    for raw in env_file.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = unquote(value)
    return values

def compose_database_url() -> str:
    compose_files = shlex.split(os.environ.get("COMPOSE_FILES", ""))
    if not compose_files:
        return ""
    try:
        rendered = subprocess.run(
            ["docker", "compose", *compose_files, "config"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    except Exception:
        return ""

    in_auth = False
    in_env = False
    for raw in rendered.splitlines():
        if re.match(r"^  [A-Za-z0-9_.-]+:", raw):
            in_auth = raw.strip().split(":", 1)[0] == "auth"
            in_env = False
            continue
        if not in_auth:
            continue
        if re.match(r"^    [A-Za-z0-9_.-]+:", raw):
            in_env = raw.strip().split(":", 1)[0] == "environment"
            continue
        if in_env:
            m = re.match(r"^      DATABASE_URL:\s*(.*)$", raw)
            if m:
                return unquote(m.group(1))
    return ""

values = env_file_values()
database_url = os.environ.get("DATABASE_URL", "") or compose_database_url() or values.get("DATABASE_URL", "")
parsed = urllib.parse.urlsplit(database_url)
role = urllib.parse.unquote(parsed.username or values.get("POSTGRES_USER", "postgres"))
password = urllib.parse.unquote(parsed.password or values.get("POSTGRES_PASSWORD", ""))

if not role:
    raise SystemExit("ERROR: no pude resolver usuario Postgres desde DATABASE_URL/POSTGRES_USER")
if not password:
    raise SystemExit("ERROR: no pude resolver password Postgres desde DATABASE_URL/POSTGRES_PASSWORD")

def quote_ident(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'

def quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"

print(f"ALTER ROLE {quote_ident(role)} PASSWORD {quote_literal(password)};")
PY
)"

echo ">> Alineando password del rol Postgres usado por auth en servicio '$PG_SERVICE'..."
# COMPOSE_FILES es controlado por los workflows/scripts del repo (-f docker-compose...).
# shellcheck disable=SC2086
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  if printf '%s\n' "$SQL" | docker compose $COMPOSE_FILES exec -T -u "$PG_ADMIN_USER" "$PG_SERVICE" \
    psql -v ON_ERROR_STOP=1 -U "$PG_ADMIN_USER" -d "$PG_ADMIN_DB" >/dev/null; then
    echo ">> OK. Password del rol Postgres aplicado sin imprimir secretos."
    exit 0
  fi

  echo "   intento $attempt/$MAX_ATTEMPTS: Postgres aun no acepta ALTER ROLE, reintento en ${SLEEP_SEC}s..." >&2
  sleep "$SLEEP_SEC"
done

echo "ERROR: no pude aplicar el password del rol Postgres despues de $MAX_ATTEMPTS intentos." >&2
exit 1
