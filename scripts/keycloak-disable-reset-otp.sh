#!/usr/bin/env bash
#
# Deshabilita el paso "Reset - Conditional OTP" del flujo de reset de
# credenciales de Keycloak. Sin esto, un usuario con 2FA que recupera su
# contraseña es forzado a reconfigurar el 2FA ("Configurar 2FA"), lo cual no
# tiene sentido: recuperar la contraseña no debe tocar el 2FA.
#
# El cambio persiste en la base de Keycloak (sobrevive reinicios). Hay que
# correrlo UNA vez por entorno (local, testing, producción), porque el realm
# se importa con los flujos default y este ajuste no viaja en el realm JSON.
#
# Uso:
#   KC_URL=http://localhost:8089 KC_REALM=edutrack \
#   KC_ADMIN=admin KC_ADMIN_PASSWORD=admin \
#   ./scripts/keycloak-disable-reset-otp.sh
#
# Es idempotente: si ya está deshabilitado, no hace nada.
set -euo pipefail

KC_URL="${KC_URL:-http://localhost:8089}"
KC_REALM="${KC_REALM:-edutrack}"
KC_ADMIN="${KC_ADMIN:-admin}"
KC_ADMIN_PASSWORD="${KC_ADMIN_PASSWORD:-admin}"
FLOW_ALIAS="reset credentials"
TARGET="Reset - Conditional OTP"

echo "→ Keycloak: ${KC_URL} | realm: ${KC_REALM}"

TOKEN="$(curl -fsS -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "grant_type=password" \
  -d "username=${KC_ADMIN}" --data-urlencode "password=${KC_ADMIN_PASSWORD}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"

FLOW_PATH="$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "${FLOW_ALIAS}")"
EXEC_URL="${KC_URL}/admin/realms/${KC_REALM}/authentication/flows/${FLOW_PATH}/executions"

read -r EXEC_ID CURRENT < <(curl -fsS "${EXEC_URL}" -H "Authorization: Bearer ${TOKEN}" \
  | python3 -c "
import json,sys
target=sys.argv[1]
for e in json.load(sys.stdin):
    if e.get('displayName')==target:
        print(e.get('id'), e.get('requirement')); break
" "${TARGET}")

if [ -z "${EXEC_ID:-}" ]; then
  echo "✗ No encontré el paso \"${TARGET}\" en el flujo \"${FLOW_ALIAS}\"." >&2
  exit 1
fi

if [ "${CURRENT}" = "DISABLED" ]; then
  echo "✓ \"${TARGET}\" ya estaba DISABLED. Nada que hacer."
  exit 0
fi

curl -fsS -X PUT "${EXEC_URL}" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d "{\"id\":\"${EXEC_ID}\",\"requirement\":\"DISABLED\"}"

echo "✓ \"${TARGET}\" deshabilitado. La recuperación de contraseña ya no fuerza 2FA."
