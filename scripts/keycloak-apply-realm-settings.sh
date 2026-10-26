#!/usr/bin/env bash
# Aplica de forma idempotente los settings de tema, contraseña y Google IdP del realm
# desde keycloak/realm-edutrack.json al realm vivo, via Admin API.
#
# No usamos --import-realm --override: borra usuarios y credenciales del realm.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REALM_FILE="${REALM_FILE:-keycloak/realm-edutrack.json}"

command -v curl >/dev/null || { echo "Falta 'curl'." >&2; exit 1; }
command -v jq   >/dev/null || { echo "Falta 'jq'." >&2; exit 1; }
[ -f "$REALM_FILE" ] || { echo "No existe $REALM_FILE" >&2; exit 1; }

# En desarrollo Keycloak suele estar publicado en localhost:8089. En
# produccion ese puerto se cierra y el host debe hablar con la IP privada del
# contenedor en edutrack_net. KC_URL explicita siempre tiene precedencia.
discover_keycloak_url() {
  command -v docker >/dev/null 2>&1 || return 1

  local container_id container_ip network_name
  network_name="${KEYCLOAK_DOCKER_NETWORK:-edutrack_net}"
  container_id="$(docker ps \
    --filter 'label=com.docker.compose.service=keycloak' \
    --filter 'status=running' \
    --format '{{.ID}}' 2>/dev/null | head -n1)"
  [ -n "$container_id" ] || return 1

  container_ip="$(docker inspect "$container_id" 2>/dev/null \
    | jq -r --arg network "$network_name" \
      '.[0].NetworkSettings.Networks[$network].IPAddress // empty')"
  [ -n "$container_ip" ] || return 1

  printf 'http://%s:8080' "$container_ip"
}

if [ -z "${KC_URL:-}" ]; then
  KC_URL="$(discover_keycloak_url || true)"
  if [ -n "$KC_URL" ]; then
    echo ">> Keycloak accesible por la red Docker privada (puerto 8089 no publicado)."
  else
    KC_URL="http://localhost:8089"
  fi
fi

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
  TOKEN_RESPONSE="$(curl -sS --connect-timeout 3 --max-time 10 \
    -w $'\n%{http_code}' \
    -X POST "$KC_URL/realms/master/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=admin-cli \
    -d "username=$ADMIN_USER" --data-urlencode "password=$ADMIN_PASS" 2>/dev/null || true)"
  TOKEN_HTTP_CODE="${TOKEN_RESPONSE##*$'\n'}"
  TOKEN_BODY="${TOKEN_RESPONSE%$'\n'*}"
  TOKEN="$(printf '%s' "$TOKEN_BODY" | jq -r '.access_token // empty' 2>/dev/null || true)"
  [ -n "$TOKEN" ] && break

  TOKEN_ERROR="$(printf '%s' "$TOKEN_BODY" | jq -r '.error // empty' 2>/dev/null || true)"
  if { [ "$TOKEN_HTTP_CODE" = "400" ] || [ "$TOKEN_HTTP_CODE" = "401" ]; } && [ -n "$TOKEN_ERROR" ]; then
    echo "Keycloak respondio, pero rechazo las credenciales del admin (HTTP $TOKEN_HTTP_CODE)." >&2
    echo "KEYCLOAK_ADMIN_PASSWORD debe coincidir con el password actual del admin del realm master." >&2
    exit 1
  fi
  echo "   intento $attempt/30: Keycloak aun no responde, reintento en 5s..."
  sleep 5
done
[ -n "$TOKEN" ] || { echo "No se pudo conectar o autenticar contra Keycloak en $KC_URL." >&2; exit 1; }

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
  bruteForceProtected,
  permanentLockout,
  failureFactor,
  waitIncrementSeconds,
  maxFailureWaitSeconds,
  quickLoginCheckMilliSeconds,
  minimumQuickLoginWaitSeconds,
  maxDeltaTimeSeconds,
  passwordPolicy,
  accessTokenLifespan,
  ssoSessionIdleTimeout,
  ssoSessionMaxLifespan,
  ssoSessionIdleTimeoutRememberMe,
  ssoSessionMaxLifespanRememberMe,
  clientSessionIdleTimeout,
  clientSessionMaxLifespan,
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
AFTER_SSO_IDLE="$(printf '%s' "$AFTER" | jq -r '.ssoSessionIdleTimeout')"
AFTER_SSO_MAX="$(printf '%s' "$AFTER" | jq -r '.ssoSessionMaxLifespan')"
AFTER_BRUTE_FORCE="$(printf '%s' "$AFTER" | jq -r '.bruteForceProtected')"
AFTER_EDIT_USERNAME="$(printf '%s' "$AFTER" | jq -r '.editUsernameAllowed')"
echo ">> OK. loginTheme del realm '$REALM_NAME' = $AFTER_THEME"
echo ">> OK. bruteForceProtected=$AFTER_BRUTE_FORCE editUsernameAllowed=$AFTER_EDIT_USERNAME"
echo ">> OK. passwordPolicy del realm '$REALM_NAME' = $AFTER_PASSWORD_POLICY"
echo ">> OK. ssoSessionIdleTimeout=$AFTER_SSO_IDLE ssoSessionMaxLifespan=$AFTER_SSO_MAX"

# Ningún cliente público del realm acepta usuario y contraseña directo (password grant): Keycloak crea
# `admin-cli` con eso prendido, y deja probar contraseñas contra el endpoint de token sin pasar por la
# pantalla de login. El cliente de verificación de 2FA es confidencial y lo necesita: no se toca. El
# `admin-cli` del realm master (el que usan el backend y estos scripts) tampoco.
PUBLIC_ROPG_CLIENTS="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$KC_URL/admin/realms/$REALM_NAME/clients" \
  | jq -r '.[] | select(.publicClient == true and .directAccessGrantsEnabled == true) | "\(.id) \(.clientId)"')"
if [ -z "$PUBLIC_ROPG_CLIENTS" ]; then
  echo ">> OK. Ningún cliente público con password grant."
else
  while read -r CLIENT_UUID_ROPG CLIENT_ID_ROPG; do
    [ -n "$CLIENT_UUID_ROPG" ] || continue
    CLIENT_ROPG_URL="$KC_URL/admin/realms/$REALM_NAME/clients/$CLIENT_UUID_ROPG"
    curl -fsS -H "Authorization: Bearer $TOKEN" "$CLIENT_ROPG_URL" \
      | jq '.directAccessGrantsEnabled = false' \
      | curl -fsS -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
          --data-binary @- "$CLIENT_ROPG_URL"
    echo ">> OK. Password grant deshabilitado en: $CLIENT_ID_ROPG"
  done <<< "$PUBLIC_ROPG_CLIENTS"
fi

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

# El secreto real va sólo en el .env (GOOGLE_CLIENT_SECRET): el realm del repo trae un texto de
# ejemplo. Un valor de ejemplo cuenta como faltante y el IdP queda con el secreto que ya tiene
# guardado Keycloak; si se subiera, "Continuar con Google" dejaría de funcionar.
is_placeholder() {
  printf '%s' "$1" | grep -qi 'REEMPLAZAR\|REPLACE\|CHANGE'
}

GP="$KC_URL/admin/realms/$REALM_NAME/identity-provider/instances/google"
GCUR="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$GP" 2>/dev/null || true)"
if [ -z "$GCUR" ] || [ "$GCUR" = "null" ]; then
  echo ">> Google IdP: no existe el IdP 'google' en el realm; lo salteo."
elif [ -z "$GOOGLE_ID" ] || [ -z "$GOOGLE_SECRET" ] || is_placeholder "$GOOGLE_ID" || is_placeholder "$GOOGLE_SECRET"; then
  echo ">> Google IdP: WARN no hay GOOGLE_CLIENT_ID/SECRET validos en el .env; no lo toco (queda el secreto guardado)."
else
  GNEW="$(printf '%s' "$GCUR" | jq --arg id "$GOOGLE_ID" --arg sec "$GOOGLE_SECRET" \
    '.enabled=true | .config.clientId=$id | .config.clientSecret=$sec')"
  curl -fsS -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "$GNEW" "$GP"
  GAFTER="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$GP" | jq -r '.config.clientId')"
  echo ">> OK. Google IdP clientId = $GAFTER"
fi

# Correo del realm (opcional). Recuperar contraseña ya lo manda EduTrack por Brevo
# (auth/password-reset.ts); esto sólo hace falta para correos nativos de Keycloak. DigitalOcean
# bloquea el 25/465/587: usar el relay SMTP de Brevo en el 2525 con su clave SMTP, no la de la API.
SMTP_KC_HOST="${KEYCLOAK_SMTP_HOST:-$(env_get KEYCLOAK_SMTP_HOST)}"
SMTP_KC_PORT="${KEYCLOAK_SMTP_PORT:-$(env_get KEYCLOAK_SMTP_PORT)}"
SMTP_KC_USER="${KEYCLOAK_SMTP_USER:-$(env_get KEYCLOAK_SMTP_USER)}"
SMTP_KC_PASS="${KEYCLOAK_SMTP_PASSWORD:-$(env_get KEYCLOAK_SMTP_PASSWORD)}"
SMTP_KC_FROM="${KEYCLOAK_SMTP_FROM:-$(env_get KEYCLOAK_SMTP_FROM)}"
SMTP_KC_FROM="${SMTP_KC_FROM:-${SMTP_FROM:-$(env_get SMTP_FROM)}}"
if [ -z "$SMTP_KC_HOST" ] || [ -z "$SMTP_KC_USER" ] || [ -z "$SMTP_KC_PASS" ] || [ -z "$SMTP_KC_FROM" ]; then
  echo ">> SMTP del realm: sin KEYCLOAK_SMTP_*; no lo toco (recuperar contraseña usa el correo de EduTrack)."
else
  REALM_NOW="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$KC_URL/admin/realms/$REALM_NAME")"
  REALM_SMTP="$(printf '%s' "$REALM_NOW" | jq \
    --arg host "$SMTP_KC_HOST" --arg port "${SMTP_KC_PORT:-2525}" \
    --arg user "$SMTP_KC_USER" --arg pass "$SMTP_KC_PASS" --arg from "$SMTP_KC_FROM" '
      .smtpServer = {
        host: $host, port: $port, from: $from, fromDisplayName: "EduTrack",
        auth: "true", user: $user, password: $pass, starttls: "true", ssl: "false"
      }')"
  curl -fsS -X PUT \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "$REALM_SMTP" "$KC_URL/admin/realms/$REALM_NAME"
  echo ">> OK. SMTP del realm = $SMTP_KC_HOST:${SMTP_KC_PORT:-2525} (remitente $SMTP_KC_FROM)"
fi

echo ">> Hace un hard refresh (Ctrl+Shift+R) en la pantalla de login."
