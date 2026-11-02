#!/usr/bin/env bash
# Rota los secretos de ejemplo del .env de producción antes de desplegar.
#
# Uso, en el droplet desde la raíz del repo:   bash scripts/rotate-production-secrets.sh [--env .env]
#
# - KEYCLOAK_CLIENT_SECRET y JWT_SECRET: si faltan, son de ejemplo (`…-change-me`) o son cortos, pone
#   uno nuevo al azar. El deploy (keycloak-apply-realm-settings.sh) sube el del cliente a Keycloak.
# - KEYCLOAK_ADMIN_PASSWORD: sólo avisa. Tiene que coincidir con la del admin del realm `master`, así
#   que se cambia primero en Keycloak y después en el .env, a mano.
#
# Deja una copia del .env anterior (.env.bak-<fecha>, sólo legible por root) y nunca imprime un valor.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
if [ "${1:-}" = "--env" ] && [ -n "${2:-}" ]; then ENV_FILE="$2"; fi
[ -f "$ENV_FILE" ] || { echo "ERROR: no existe $ENV_FILE" >&2; exit 1; }

env_get() {
  sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" | tail -n1 | tr -d '\r' | sed -E 's/^["'\'']//; s/["'\'']$//'
}

is_weak() {
  local value="$1" min="$2"
  [ -z "$value" ] && return 0
  printf '%s' "$value" | grep -qi 'change-me\|changeme\|REEMPLAZAR\|REPLACE' && return 0
  [ "${#value}" -lt "$min" ]
}

# Reemplaza (o agrega) KEY=VALUE sin pasar el valor por sed: un base64 trae / y +.
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  KEY="$key" VALUE="$value" awk '
    BEGIN { key = ENVIRON["KEY"]; value = ENVIRON["VALUE"]; done = 0 }
    $0 ~ "^[[:space:]]*" key "=" { if (!done) { print key "=" value; done = 1 }; next }
    { print }
    END { if (!done) print key "=" value }
  ' "$ENV_FILE" > "$tmp"
  chmod --reference="$ENV_FILE" "$tmp" 2>/dev/null || chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

backup="${ENV_FILE}.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$ENV_FILE" "$backup"
chmod 600 "$backup"
echo "Copia del .env anterior: $backup"

changed=0
for pair in "KEYCLOAK_CLIENT_SECRET:24:32" "JWT_SECRET:32:48"; do
  key="${pair%%:*}"
  rest="${pair#*:}"
  min="${rest%%:*}"
  bytes="${rest#*:}"
  if is_weak "$(env_get "$key")" "$min"; then
    env_set "$key" "$(openssl rand -base64 "$bytes" | tr -d '\n')"
    echo "ROTADO  $key (nuevo, al azar)"
    changed=1
  else
    echo "OK      $key (ya era propio; no se toca)"
  fi
done

admin="$(env_get KEYCLOAK_ADMIN_PASSWORD)"
if is_weak "$admin" 12 || [ "$admin" = "admin" ]; then
  echo "AVISO   KEYCLOAK_ADMIN_PASSWORD es débil: cambiala primero en Keycloak (realm master) y después acá."
else
  echo "OK      KEYCLOAK_ADMIN_PASSWORD"
fi

if [ "$changed" -eq 0 ]; then
  rm -f "$backup"
  echo "No hubo cambios; borré la copia."
else
  echo "Listo. El próximo deploy aplica el secreto del cliente en Keycloak y recrea la API."
fi
