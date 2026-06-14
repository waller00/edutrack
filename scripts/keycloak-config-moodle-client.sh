#!/usr/bin/env bash
# Crea o actualiza el client OIDC "moodle" en Keycloak (realm edutrack).
#
# Uso (desde la raíz del repo, con Keycloak levantado):
#   ./scripts/keycloak-config-moodle-client.sh
#   MOODLE_PUBLIC_URL=https://moodle.edutrack-uy.com ./scripts/keycloak-config-moodle-client.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

command -v curl >/dev/null || { echo "Falta 'curl'." >&2; exit 1; }
command -v python3 >/dev/null || { echo "Falta 'python3'." >&2; exit 1; }

env_get() {
  local key="$1"
  [ -f .env ] || return 0
  sed -n "s/^[[:space:]]*${key}=//p" .env | tail -n1
}

KC_URL="${KC_URL:-http://localhost:8089}"
REALM_NAME="${KEYCLOAK_REALM:-edutrack}"
CLIENT_ID="${MOODLE_KEYCLOAK_CLIENT_ID:-moodle}"
CLIENT_SECRET="${MOODLE_KEYCLOAK_CLIENT_SECRET:-moodle-sso-secret-change-me}"
MOODLE_PUBLIC_URL="${MOODLE_PUBLIC_URL:-http://localhost:8080}"
REDIRECT_URI="${MOODLE_PUBLIC_URL%/}/admin/oauth2callback.php"

ADMIN_USER="${KEYCLOAK_ADMIN:-$(env_get KEYCLOAK_ADMIN)}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:-$(env_get KEYCLOAK_ADMIN_PASSWORD)}"
[ -n "$ADMIN_PASS" ] || { echo "Falta KEYCLOAK_ADMIN_PASSWORD en el entorno o en ./.env" >&2; exit 1; }

echo ">> Keycloak: $KC_URL | realm: $REALM_NAME | client: $CLIENT_ID"
echo ">> Redirect URI: $REDIRECT_URI"

TOKEN=""
for attempt in $(seq 1 30); do
  TOKEN="$(curl -fsS -X POST "$KC_URL/realms/master/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=admin-cli \
    -d "username=$ADMIN_USER" --data-urlencode "password=$ADMIN_PASS" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)"
  [ -n "$TOKEN" ] && break
  echo "   intento $attempt/30: Keycloak aún no responde, reintento en 5s..."
  sleep 5
done
[ -n "$TOKEN" ] || { echo "No se pudo obtener token admin." >&2; exit 1; }

CLIENT_UUID="$(curl -fsS -G -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "clientId=$CLIENT_ID" \
  "$KC_URL/admin/realms/$REALM_NAME/clients" \
  | python3 -c "import sys,json; data=json.load(sys.stdin); print(data[0]['id'] if data else '')")"

MOODLE_ORIGIN="$(python3 -c "from urllib.parse import urlparse; u=urlparse('$MOODLE_PUBLIC_URL'); print(f'{u.scheme}://{u.netloc}')")"
POST_LOGOUT="${MOODLE_ORIGIN}/*"

CLIENT_BODY="$(python3 - <<PY
import json
print(json.dumps({
    "clientId": "$CLIENT_ID",
    "name": "Moodle LMS",
    "enabled": True,
    "protocol": "openid-connect",
    "publicClient": False,
    "secret": "$CLIENT_SECRET",
    "standardFlowEnabled": True,
    "implicitFlowEnabled": False,
    "directAccessGrantsEnabled": False,
    "serviceAccountsEnabled": False,
    "redirectUris": ["$REDIRECT_URI"],
    "webOrigins": ["+", "$MOODLE_ORIGIN"],
    "attributes": {
        "post.logout.redirect.uris": "$POST_LOGOUT"
    }
}))
PY
)"

if [ -z "$CLIENT_UUID" ]; then
  echo ">> Creando client '$CLIENT_ID'..."
  curl -fsS -X POST \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "$CLIENT_BODY" "$KC_URL/admin/realms/$REALM_NAME/clients"
  echo ">> Client creado."
else
  echo ">> Actualizando client '$CLIENT_ID' (#$CLIENT_UUID)..."
  CLIENT_CURRENT="$(curl -fsS -H "Authorization: Bearer $TOKEN" \
    "$KC_URL/admin/realms/$REALM_NAME/clients/$CLIENT_UUID")"
  TMP_DIR="$(mktemp -d)"
  printf '%s' "$CLIENT_CURRENT" > "$TMP_DIR/current.json"
  printf '%s' "$CLIENT_BODY" > "$TMP_DIR/patch.json"
  MERGED="$(python3 - "$TMP_DIR/current.json" "$TMP_DIR/patch.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    current = json.load(fh)
with open(sys.argv[2], encoding="utf-8") as fh:
    patch = json.load(fh)
redirect = patch["redirectUris"][0]
origin = patch["webOrigins"][1]
post_logout = patch["attributes"]["post.logout.redirect.uris"]
current["enabled"] = True
current["secret"] = patch["secret"]
current["standardFlowEnabled"] = True
current["redirectUris"] = list(dict.fromkeys((current.get("redirectUris") or []) + [redirect]))
current["webOrigins"] = list(dict.fromkeys((current.get("webOrigins") or []) + ["+", origin]))
attrs = current.setdefault("attributes", {})
existing = [x for x in (attrs.get("post.logout.redirect.uris") or "").split("##") if x]
attrs["post.logout.redirect.uris"] = "##".join(dict.fromkeys(existing + [post_logout]))
print(json.dumps(current))
PY
)"
  rm -rf "$TMP_DIR"
  curl -fsS -X PUT \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "$MERGED" "$KC_URL/admin/realms/$REALM_NAME/clients/$CLIENT_UUID"
  echo ">> Client actualizado."
fi

echo ">> OK. MOODLE_KEYCLOAK_CLIENT_ID=$CLIENT_ID"
echo ">> OK. MOODLE_KEYCLOAK_CLIENT_SECRET=$CLIENT_SECRET"
