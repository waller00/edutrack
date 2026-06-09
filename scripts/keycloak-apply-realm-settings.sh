#!/usr/bin/env bash
# Aplica de forma idempotente los settings criticos del realm, client OIDC y Google IdP
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
  local value
  [ -f .env ] || return 0
  value="$(sed -n "s/^[[:space:]]*${key}=//p" .env | tail -n1 | tr -d '\r')"
  value="$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

url_origin() {
  printf '%s' "$1" | sed -E 's#^(https?://[^/]+).*$#\1#'
}

urlencode() {
  jq -nr --arg v "$1" '$v|@uri'
}
ADMIN_USER="${KEYCLOAK_ADMIN:-$(env_get KEYCLOAK_ADMIN)}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:-$(env_get KEYCLOAK_ADMIN_PASSWORD)}"
[ -n "$ADMIN_PASS" ] || { echo "Falta KEYCLOAK_ADMIN_PASSWORD en el entorno o en ./.env" >&2; exit 1; }

REALM_NAME="$(jq -r '.realm' "$REALM_FILE")"
[ -n "$REALM_NAME" ] && [ "$REALM_NAME" != "null" ] || { echo "No pude leer .realm de $REALM_FILE" >&2; exit 1; }

echo ">> Pidiendo token admin a $KC_URL (con reintentos) ..."
TOKEN=""
TOKEN_BODY_FILE="$(mktemp)"
trap 'rm -f "$TOKEN_BODY_FILE"' EXIT
for attempt in $(seq 1 30); do
  TOKEN_HTTP_STATUS="$(curl -sS -o "$TOKEN_BODY_FILE" -w "%{http_code}" -X POST "$KC_URL/realms/master/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=admin-cli \
    -d "username=$ADMIN_USER" --data-urlencode "password=$ADMIN_PASS" 2>/dev/null || true)"
  if [ "$TOKEN_HTTP_STATUS" = "200" ]; then
    TOKEN="$(jq -r '.access_token // empty' "$TOKEN_BODY_FILE" 2>/dev/null || true)"
  elif [ "$TOKEN_HTTP_STATUS" = "400" ] || [ "$TOKEN_HTTP_STATUS" = "401" ]; then
    ERROR_MSG="$(jq -r '.error_description // .error // empty' "$TOKEN_BODY_FILE" 2>/dev/null || true)"
    echo "No se pudo obtener token admin: credenciales rechazadas para usuario '$ADMIN_USER'. ${ERROR_MSG}" >&2
    exit 1
  fi
  [ -n "$TOKEN" ] && break
  echo "   intento $attempt/30: Keycloak aun no entrega token admin (HTTP ${TOKEN_HTTP_STATUS:-000}), reintento en 5s..."
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

AFTER="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$KC_URL/admin/realms/$REALM_NAME" | jq -r '.loginTheme')"
echo ">> OK. loginTheme del realm '$REALM_NAME' = $AFTER"

CLIENT_ID="${KEYCLOAK_CLIENT_ID:-$(env_get KEYCLOAK_CLIENT_ID)}"
CLIENT_ID="${CLIENT_ID:-edutrack-web}"
FRONTEND_URL="${FRONTEND_URL:-$(env_get FRONTEND_URL)}"
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-$(env_get NEXT_PUBLIC_API_URL)}"
KEYCLOAK_REDIRECT_URI="${KEYCLOAK_REDIRECT_URI:-$(env_get KEYCLOAK_REDIRECT_URI)}"
CLIENT_SECRET="${KEYCLOAK_CLIENT_SECRET:-$(env_get KEYCLOAK_CLIENT_SECRET)}"
if [ -z "$CLIENT_SECRET" ]; then
  CLIENT_SECRET="$(jq -r --arg id "$CLIENT_ID" '(.clients[]? | select(.clientId==$id) | .secret) // empty' "$REALM_FILE")"
fi

CLIENT_UUID="$(curl -fsS -G -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "clientId=$CLIENT_ID" \
  "$KC_URL/admin/realms/$REALM_NAME/clients" | jq -r '.[0].id // empty')"

if [ -z "$CLIENT_UUID" ]; then
  CLIENT_TEMPLATE="$(jq --arg id "$CLIENT_ID" '.clients[]? | select(.clientId==$id)' "$REALM_FILE")"
  if [ -z "$CLIENT_TEMPLATE" ] || [ "$CLIENT_TEMPLATE" = "null" ]; then
    echo ">> Client '$CLIENT_ID': no existe en Keycloak ni en $REALM_FILE; no puedo crearlo." >&2
  else
    echo ">> Client '$CLIENT_ID': no existe; lo creo desde $REALM_FILE."
    CLIENT_CREATE="$(printf '%s' "$CLIENT_TEMPLATE" | jq --arg secret "$CLIENT_SECRET" '
      .enabled = true
      | .protocol = "openid-connect"
      | .publicClient = false
      | .clientAuthenticatorType = "client-secret"
      | .standardFlowEnabled = true
      | .implicitFlowEnabled = false
      | .directAccessGrantsEnabled = false
      | .serviceAccountsEnabled = true
      | if $secret != "" then .secret = $secret else . end
    ')"
    curl -fsS -X POST \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d "$CLIENT_CREATE" "$KC_URL/admin/realms/$REALM_NAME/clients"
    CLIENT_UUID="$(curl -fsS -G -H "Authorization: Bearer $TOKEN" \
      --data-urlencode "clientId=$CLIENT_ID" \
      "$KC_URL/admin/realms/$REALM_NAME/clients" | jq -r '.[0].id // empty')"
  fi
fi

if [ -z "$CLIENT_UUID" ]; then
  echo "ERROR: no pude resolver el client '$CLIENT_ID' en el realm '$REALM_NAME'." >&2
  exit 1
fi

CLIENT_URL="$KC_URL/admin/realms/$REALM_NAME/clients/$CLIENT_UUID"
CLIENT_CURRENT="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$CLIENT_URL")"
FRONTEND_ORIGIN=""
POST_LOGOUT=""
if [ -n "$FRONTEND_URL" ]; then
  FRONTEND_ORIGIN="$(url_origin "$FRONTEND_URL")"
  POST_LOGOUT="${FRONTEND_ORIGIN}/*"
fi
API_ORIGIN=""
if [ -n "$NEXT_PUBLIC_API_URL" ]; then
  API_ORIGIN="$(url_origin "$NEXT_PUBLIC_API_URL")"
elif [ -n "$KEYCLOAK_REDIRECT_URI" ]; then
  API_ORIGIN="$(url_origin "$KEYCLOAK_REDIRECT_URI")"
fi

CLIENT_PATCHED="$(printf '%s' "$CLIENT_CURRENT" | jq \
  --arg redirect "$KEYCLOAK_REDIRECT_URI" \
  --arg postLogout "$POST_LOGOUT" \
  --arg frontendOrigin "$FRONTEND_ORIGIN" \
  --arg apiOrigin "$API_ORIGIN" \
  --arg secret "$CLIENT_SECRET" '
    .enabled = true
    | .protocol = "openid-connect"
    | .publicClient = false
    | .clientAuthenticatorType = "client-secret"
    | .standardFlowEnabled = true
    | .implicitFlowEnabled = false
    | .directAccessGrantsEnabled = false
    | .serviceAccountsEnabled = true
    | if $secret != "" then .secret = $secret else . end
    | if $redirect != "" then .redirectUris = ((.redirectUris // []) + [$redirect] | unique) else . end
    | if $frontendOrigin != "" then .baseUrl = $frontendOrigin else . end
    | if $frontendOrigin != "" then .webOrigins = ((.webOrigins // []) + ["+", $frontendOrigin] | unique) else . end
    | if $apiOrigin != "" then .webOrigins = ((.webOrigins // []) + [$apiOrigin] | unique) else . end
    | if $postLogout != "" then
        .attributes = (.attributes // {})
        | .attributes["post.logout.redirect.uris"] = (
            ((.attributes["post.logout.redirect.uris"] // "")
              | split("##")
              | map(select(length > 0))
              + [$postLogout]
              | unique)
            | join("##")
          )
      else . end
  ')"
curl -fsS -X PUT \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$CLIENT_PATCHED" "$CLIENT_URL"
echo ">> OK. Client '$CLIENT_ID': habilitado como confidential OIDC standard flow"
if [ -n "$KEYCLOAK_REDIRECT_URI" ]; then
  echo ">> OK. Client '$CLIENT_ID': redirectUris incluye $KEYCLOAK_REDIRECT_URI"
fi
if [ -n "$POST_LOGOUT" ]; then
  echo ">> OK. Client '$CLIENT_ID': post logout incluye $POST_LOGOUT"
fi

if [ -n "$KEYCLOAK_REDIRECT_URI" ]; then
  REDIRECT_COUNT="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$CLIENT_URL" \
    | jq --arg redirect "$KEYCLOAK_REDIRECT_URI" '[.redirectUris[]? | select(. == $redirect)] | length')"
  [ "$REDIRECT_COUNT" -gt 0 ] || { echo "ERROR: el redirect_uri no quedo aplicado en Keycloak." >&2; exit 1; }

  curl -fsS -o /dev/null -G "$KC_URL/realms/$REALM_NAME/protocol/openid-connect/auth" \
    --data-urlencode "client_id=$CLIENT_ID" \
    --data-urlencode "redirect_uri=$KEYCLOAK_REDIRECT_URI" \
    --data-urlencode "response_type=code" \
    --data-urlencode "scope=openid"
  echo ">> OK. Keycloak acepta el redirect_uri del login."
fi

if [ -n "$CLIENT_SECRET" ]; then
  CLIENT_TOKEN="$(curl -fsS -X POST "$KC_URL/realms/$REALM_NAME/protocol/openid-connect/token" \
    -d grant_type=client_credentials \
    -d "client_id=$CLIENT_ID" \
    --data-urlencode "client_secret=$CLIENT_SECRET" \
    | jq -r '.access_token // empty')"
  [ -n "$CLIENT_TOKEN" ] || { echo "ERROR: Keycloak no acepta KEYCLOAK_CLIENT_SECRET para '$CLIENT_ID'." >&2; exit 1; }
  echo ">> OK. Client '$CLIENT_ID': secret validado con client_credentials."
fi

FLOW_ALIAS="reset credentials"
FLOW_PATH="$(urlencode "$FLOW_ALIAS")"
EXEC_URL="$KC_URL/admin/realms/$REALM_NAME/authentication/flows/$FLOW_PATH/executions"
RESET_OTP_EXEC="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$EXEC_URL" \
  | jq -r '.[]? | select(.displayName=="Reset - Conditional OTP") | "\(.id) \(.requirement)"' | head -n1)"
if [ -n "$RESET_OTP_EXEC" ]; then
  RESET_OTP_ID="${RESET_OTP_EXEC%% *}"
  RESET_OTP_REQ="${RESET_OTP_EXEC#* }"
  if [ "$RESET_OTP_REQ" != "DISABLED" ]; then
    curl -fsS -X PUT "$EXEC_URL" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d "{\"id\":\"${RESET_OTP_ID}\",\"requirement\":\"DISABLED\"}"
    echo ">> OK. Reset - Conditional OTP deshabilitado en el flujo de recuperacion."
  else
    echo ">> OK. Reset - Conditional OTP ya estaba deshabilitado."
  fi
else
  echo ">> WARN. No encontre Reset - Conditional OTP en el flujo '$FLOW_ALIAS'."
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
