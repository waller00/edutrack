#!/usr/bin/env bash
# Deja una REDIS_PASSWORD en el .env del servidor si todavía no hay una (la genera una sola vez).
#
# docker-compose.cloud.yml no arranca sin ella (arma REDIS_URL con la contraseña) y
# validate-production-routes.sh la exige. La corre el deploy antes de validar, así el primer
# deploy con Redis protegido no necesita que alguien entre al servidor. Sólo hex: va dentro de la
# URL. Nunca imprime el valor.
#
# Uso: bash scripts/ensure-redis-password.sh [.env]
set -euo pipefail

ENV_FILE="${1:-.env}"
[[ -f "$ENV_FILE" ]] || { echo "No existe $ENV_FILE" >&2; exit 1; }

current="$(sed -n 's/^[[:space:]]*REDIS_PASSWORD=//p' "$ENV_FILE" | tail -n1 | tr -d "\r\"' ")"
if [[ -n "$current" ]]; then
  echo "REDIS_PASSWORD ya está en $ENV_FILE"
  exit 0
fi

value="$(openssl rand -hex 32)"
if grep -qE '^[[:space:]]*REDIS_PASSWORD=' "$ENV_FILE"; then
  # Línea vacía (p. ej. copiada de .env.compose.example): se completa en el lugar.
  sed -i -E "s|^[[:space:]]*REDIS_PASSWORD=.*|REDIS_PASSWORD=${value}|" "$ENV_FILE"
else
  # Sin salto de línea final, el valor quedaría pegado a la última variable.
  [[ -z "$(tail -c1 "$ENV_FILE")" ]] || printf '\n' >> "$ENV_FILE"
  printf 'REDIS_PASSWORD=%s\n' "$value" >> "$ENV_FILE"
fi
echo "REDIS_PASSWORD generada en $ENV_FILE (no se muestra)"
