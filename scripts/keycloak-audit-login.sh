#!/usr/bin/env bash
# Auditoría de SÓLO LECTURA del ingreso en Keycloak: cómo está configurado de verdad el realm vivo
# (lo que el realm del repo no garantiza, porque `--import-realm` sólo importa la primera vez).
#
# Revisa lo que necesitan los dos recorridos de ingreso:
#   - registrado con contraseña que entra con Google (vinculación en "first broker login");
#   - registrado con Google que entra con contraseña ("Olvidé mi contraseña" / crearla en el perfil);
#   - "Vincular con Google" desde el perfil (acción idp_link: pide account/manage-account).
#
# No cambia nada y NUNCA imprime secretos: de los secretos de cliente sólo dice si coinciden con
# los del repo (que es público). Correr en el servidor, desde la raíz del repo:
#   bash scripts/keycloak-audit-login.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REALM_FILE="${REALM_FILE:-keycloak/realm-edutrack.json}"
command -v curl >/dev/null || { echo "Falta 'curl'." >&2; exit 1; }
command -v jq   >/dev/null || { echo "Falta 'jq'." >&2; exit 1; }

# Mismo acceso que keycloak-apply-realm-settings.sh: en producción el 8089 está cerrado y se habla
# con la IP privada del contenedor.
discover_keycloak_url() {
  command -v docker >/dev/null 2>&1 || return 1
  local container_id container_ip
  container_id="$(docker ps --filter 'label=com.docker.compose.service=keycloak' --filter 'status=running' \
    --format '{{.ID}}' 2>/dev/null | head -n1)"
  [ -n "$container_id" ] || return 1
  container_ip="$(docker inspect "$container_id" 2>/dev/null \
    | jq -r --arg network "${KEYCLOAK_DOCKER_NETWORK:-edutrack_net}" '.[0].NetworkSettings.Networks[$network].IPAddress // empty')"
  [ -n "$container_ip" ] || return 1
  printf 'http://%s:8080' "$container_ip"
}

env_get() {
  [ -f .env ] || return 0
  sed -n "s/^[[:space:]]*$1=//p" .env | tail -n1
}

KC_URL="${KC_URL:-$(discover_keycloak_url || echo "http://localhost:8089")}"
ADMIN_USER="${KEYCLOAK_ADMIN:-$(env_get KEYCLOAK_ADMIN)}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:-$(env_get KEYCLOAK_ADMIN_PASSWORD)}"
[ -n "$ADMIN_PASS" ] || { echo "Falta KEYCLOAK_ADMIN_PASSWORD en el entorno o en ./.env" >&2; exit 1; }
REALM="$(jq -r '.realm' "$REALM_FILE")"

TOKEN="$(curl -fsS -X POST "$KC_URL/realms/master/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=admin-cli -d "username=$ADMIN_USER" \
  --data-urlencode "password=$ADMIN_PASS" | jq -r '.access_token // empty')"
[ -n "$TOKEN" ] || { echo "No se pudo obtener el token de administración en $KC_URL" >&2; exit 1; }

api() { curl -fsS -H "Authorization: Bearer $TOKEN" "$KC_URL/admin/realms/$REALM$1"; }

echo "== Keycloak $KC_URL · realm '$REALM'"

echo
echo "== Realm"
api "" | jq -r '
  "loginTheme=\(.loginTheme)  resetPasswordAllowed=\(.resetPasswordAllowed)  verifyEmail=\(.verifyEmail)",
  "loginWithEmailAllowed=\(.loginWithEmailAllowed)  duplicateEmailsAllowed=\(.duplicateEmailsAllowed)  editUsernameAllowed=\(.editUsernameAllowed)",
  "SMTP del realm: \(if (.smtpServer.host // "") == "" then "NO configurado (vincular Google pide la contraseña; recuperar contraseña es de EduTrack)" else "configurado (\(.smtpServer.host))" end)"'

echo
echo "== Google (identity provider)"
GOOGLE="$(api "/identity-provider/instances/google" 2>/dev/null || true)"
if [ -z "$GOOGLE" ]; then
  echo "NO existe el IdP 'google': «Continuar con Google» no aparece."
else
  printf '%s' "$GOOGLE" | jq -r '
    "enabled=\(.enabled)  trustEmail=\(.trustEmail)  hideOnLogin=\(.hideOnLogin // false)",
    "firstBrokerLoginFlowAlias=\(.firstBrokerLoginFlowAlias)  postBrokerLoginFlowAlias=\(.postBrokerLoginFlowAlias // "-")",
    "syncMode=\(.config.syncMode // "-")  clientId=\(.config.clientId // "-")"'
  FLOW="$(printf '%s' "$GOOGLE" | jq -r '.firstBrokerLoginFlowAlias // "first broker login"')"
  echo
  echo "== Flujo '$FLOW' (primer ingreso con Google)"
  api "/authentication/flows/$(jq -rn --arg f "$FLOW" '$f|@uri')/executions" \
    | jq -r '.[] | "\([range(.level // 0)] | map("  ") | join(""))- \(.displayName // .alias // .providerId): \(.requirement)"'
fi

echo
echo "== Rol por defecto (Vincular con Google desde el perfil necesita account/manage-account)"
api "/roles/default-roles-$REALM/composites" \
  | jq -r 'if any(.[]; .name == "manage-account" or .name == "manage-account-links")
           then "OK: default-roles-'"$REALM"' incluye manage-account(-links)"
           else "FALTA: default-roles-'"$REALM"' no incluye account/manage-account: idp_link no va a funcionar" end'

echo
echo "== Clientes"
for CLIENT in edutrack-web moodle; do
  ROW="$(api "/clients?clientId=$CLIENT" | jq -c '.[0] // empty')"
  if [ -z "$ROW" ]; then echo "$CLIENT: no existe"; continue; fi
  printf '%s' "$ROW" | jq -r '"\(.clientId): publicClient=\(.publicClient) directAccessGrantsEnabled=\(.directAccessGrantsEnabled) fullScopeAllowed=\(.fullScopeAllowed)"'
  UUID="$(printf '%s' "$ROW" | jq -r '.id')"
  LIVE_SECRET="$(api "/clients/$UUID/client-secret" | jq -r '.value // empty')"
  REPO_SECRET="$(jq -r --arg c "$CLIENT" '(.clients[]? | select(.clientId == $c) | .secret) // empty' "$REALM_FILE")"
  if [ -n "$LIVE_SECRET" ] && [ "$LIVE_SECRET" = "$REPO_SECRET" ]; then
    echo "  secreto: IGUAL al del repo (público). Rotarlo en Keycloak y en el .env."
  else
    echo "  secreto: distinto del repo"
  fi
done
ENV_CLIENT_SECRET="$(env_get KEYCLOAK_CLIENT_SECRET)"
if [ -n "$ENV_CLIENT_SECRET" ] && [ "$ENV_CLIENT_SECRET" = "$(jq -r '(.clients[]? | select(.clientId == "edutrack-web") | .secret) // empty' "$REALM_FILE")" ]; then
  echo "  KEYCLOAK_CLIENT_SECRET del .env: IGUAL al del repo. Rotarlo."
fi

echo
echo "Listo. No se cambió nada."
