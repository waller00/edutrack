#!/usr/bin/env bash
# Aplica de forma idempotente los settings de tema, contraseña y Google IdP del realm
# desde keycloak/realm-edutrack.json al realm vivo, via Admin API.
#
# No usamos --import-realm --override: borra usuarios y credenciales del realm.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REALM_FILE="${REALM_FILE:-keycloak/realm-edutrack.json}"
KC_URL="${KC_URL:-http://localhost:8089}"

command -v curl >/dev/null || { echo "Falta 'curl'." >&2; exit 1; }
command -v jq   >/dev/null || { echo "Falta 'jq'." >&2; exit 1; }
[ -f "$REALM_FILE" ] || { echo "No existe $REALM_FILE" >&2; exit 1; }

env_get() {
  local key="$1"
  [ -f .env ] || return 0
  sed -n "s/^[[:space:]]*${key}=//p" .env | tail -n1
}
ADMIN_USER="${KEYCLOAK_ADMIN:-$(env_get KEYCLOAK_ADMIN)}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:-$(env_get KEYCLOAK_ADMIN_PASSWORD)}"
[ -n "$ADMIN_PASS" ] || { echo "Falta KEYCLOAK_ADMIN_PASSWORD en el entorno o en ./.env" >&2; exit 1; }

REALM_NAME="$(jq -r '.realm' "$REALM_FILE")"
[ -n "$REALM_NAME" ] && [ "$REALM_NAME" != "null" ] || { echo "No pude leer .realm de $REALM_FILE" >&2; exit 1; }

echo ">> Pidiendo token admin a $KC_URL (con reintentos) ..."
TOKEN=""
for attempt in $(seq 1 30); do
  TOKEN="$(curl -fsS -X POST "$KC_URL/realms/master/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=admin-cli \
    -d "username=$ADMIN_USER" --data-urlencode "password=$ADMIN_PASS" 2>/dev/null \
    | jq -r '.access_token // empty' 2>/dev/null || true)"
  [ -n "$TOKEN" ] && break
  echo "   intento $attempt/30: Keycloak aun no responde, reintento en 5s..."
  sleep 5
done
[ -n "$TOKEN" ] || { echo "No se pudo obtener token admin (revisa user/pass/URL)." >&2; exit 1; }

PATCH="$(jq '{
  loginTheme,
  accountTheme,
  emailTheme,
  adminTheme,
  loginWithEmailAllowed,
  editUsernameAllowed,
  duplicateEmailsAllowed,
  registrationAllowed,
  resetPasswordAllowed,
  rememberMe,
  verifyEmail,
  passwordPolicy,
  internationalizationEnabled,
  supportedLocales,
  defaultLocale
} | with_entries(select(.value != null))' "$REALM_FILE")"
echo ">> Settings a aplicar al realm '$REALM_NAME': $PATCH"

CURRENT="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$KC_URL/admin/realms/$REALM_NAME")"
MERGED="$(jq -s '.[0] * .[1]' <(printf '%s' "$CURRENT") <(printf '%s' "$PATCH"))"

curl -fsS -X PUT \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$MERGED" "$KC_URL/admin/realms/$REALM_NAME"

AFTER="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$KC_URL/admin/realms/$REALM_NAME")"
AFTER_THEME="$(printf '%s' "$AFTER" | jq -r '.loginTheme')"
AFTER_PASSWORD_POLICY="$(printf '%s' "$AFTER" | jq -r '.passwordPolicy')"
echo ">> OK. loginTheme del realm '$REALM_NAME' = $AFTER_THEME"
echo ">> OK. passwordPolicy del realm '$REALM_NAME' = $AFTER_PASSWORD_POLICY"

CLIENT_ID="${KEYCLOAK_CLIENT_ID:-$(env_get KEYCLOAK_CLIENT_ID)}"
CLIENT_ID="${CLIENT_ID:-edutrack-web}"
FRONTEND_URL="${FRONTEND_URL:-$(env_get FRONTEND_URL)}"
KEYCLOAK_REDIRECT_URI="${KEYCLOAK_REDIRECT_URI:-$(env_get KEYCLOAK_REDIRECT_URI)}"

if [ -n "$FRONTEND_URL" ] && [ -n "$KEYCLOAK_REDIRECT_URI" ]; then
  CLIENT_UUID="$(curl -fsS -G -H "Authorization: Bearer $TOKEN" \
    --data-urlencode "clientId=$CLIENT_ID" \
    "$KC_URL/admin/realms/$REALM_NAME/clients" | jq -r '.[0].id // empty')"

  if [ -z "$CLIENT_UUID" ]; then
    echo ">> Client '$CLIENT_ID': no existe; no puedo aplicar redirect/logout."
  else
    CLIENT_URL="$KC_URL/admin/realms/$REALM_NAME/clients/$CLIENT_UUID"
    CLIENT_CURRENT="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$CLIENT_URL")"
    FRONTEND_ORIGIN="$(printf '%s' "$FRONTEND_URL" | sed -E 's#^(https?://[^/]+).*$#\1#')"
    POST_LOGOUT="${FRONTEND_ORIGIN}/*"
    CLIENT_PATCHED="$(printf '%s' "$CLIENT_CURRENT" | jq \
      --arg redirect "$KEYCLOAK_REDIRECT_URI" \
      --arg postLogout "$POST_LOGOUT" \
      --arg frontendOrigin "$FRONTEND_ORIGIN" '
        .redirectUris = ((.redirectUris // []) + [$redirect] | unique)
        | .webOrigins = ((.webOrigins // []) + ["+", $frontendOrigin] | unique)
        | .attributes = (.attributes // {})
        | .attributes["post.logout.redirect.uris"] = (
            ((.attributes["post.logout.redirect.uris"] // "")
              | split("##")
              | map(select(length > 0))
              + [$postLogout]
              | unique)
            | join("##")
          )
      ')"
    curl -fsS -X PUT \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d "$CLIENT_PATCHED" "$CLIENT_URL"
    echo ">> OK. Client '$CLIENT_ID': redirectUris incluye $KEYCLOAK_REDIRECT_URI"
    echo ">> OK. Client '$CLIENT_ID': post logout incluye $POST_LOGOUT"
  fi
else
  echo ">> Client '$CLIENT_ID': faltan FRONTEND_URL o KEYCLOAK_REDIRECT_URI; no aplico redirect/logout."
fi

GOOGLE_ID="${GOOGLE_CLIENT_ID:-$(env_get GOOGLE_CLIENT_ID)}"
GOOGLE_SECRET="${GOOGLE_CLIENT_SECRET:-$(env_get GOOGLE_CLIENT_SECRET)}"
if [ -z "$GOOGLE_ID" ]; then
  GOOGLE_ID="$(jq -r '(.identityProviders[]? | select(.alias=="google") | .config.clientId) // empty' "$REALM_FILE")"
fi
if [ -z "$GOOGLE_SECRET" ]; then
  GOOGLE_SECRET="$(jq -r '(.identityProviders[]? | select(.alias=="google") | .config.clientSecret) // empty' "$REALM_FILE")"
fi

GP="$KC_URL/admin/realms/$REALM_NAME/identity-provider/instances/google"
GCUR="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$GP" 2>/dev/null || true)"
if [ -z "$GCUR" ] || [ "$GCUR" = "null" ]; then
  echo ">> Google IdP: no existe el IdP 'google' en el realm; lo salteo."
elif [ -z "$GOOGLE_ID" ] || [ -z "$GOOGLE_SECRET" ] || \
     echo "$GOOGLE_ID" | grep -qi 'REEMPLAZAR\|REPLACE\|CHANGE'; then
  echo ">> Google IdP: WARN no hay GOOGLE_CLIENT_ID/SECRET validos; no lo toco."
else
  GNEW="$(printf '%s' "$GCUR" | jq --arg id "$GOOGLE_ID" --arg sec "$GOOGLE_SECRET" \
    '.enabled=true | .config.clientId=$id | .config.clientSecret=$sec')"
  curl -fsS -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "$GNEW" "$GP"
  GAFTER="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$GP" | jq -r '.config.clientId')"
  echo ">> OK. Google IdP clientId = $GAFTER"
fi

echo ">> Hace un hard refresh (Ctrl+Shift+R) en la pantalla de login."
