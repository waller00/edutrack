#!/usr/bin/env bash
# Valida que las URLs publicas y de Keycloak esten alineadas antes de desplegar.
# No imprime secretos. Pensado para correr en el Droplet antes de reconstruir web/auth.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
PRODUCTION=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env)
      ENV_FILE="$2"
      shift 2
      ;;
    --production)
      PRODUCTION=1
      shift
      ;;
    *)
      echo "Uso: $0 [--env .env] [--production]" >&2
      exit 2
      ;;
  esac
done

[ -f "$ENV_FILE" ] || { echo "ERROR: no existe $ENV_FILE" >&2; exit 1; }

env_get() {
  local key="$1"
  local value
  value="$(sed -n "s/^[[:space:]]*${key}=//p" "$ENV_FILE" | tail -n1 | tr -d '\r')"
  value="$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

warn() {
  echo "WARN: $*" >&2
}

require_var() {
  local key="$1"
  local value
  value="$(env_get "$key")"
  [ -n "$value" ] || fail "falta $key en $ENV_FILE"
}

check_clean_url() {
  local key="$1"
  local value
  value="$(env_get "$key")"
  [ -n "$value" ] || return 0
  case "$value" in
    *'{'*|*'}'*|*'%7B'*|*'%7b'*|*'%7D'*|*'%7d'*)
      fail "$key tiene llaves o URL encoding de llaves: $value"
      ;;
    *[[:space:]]*)
      fail "$key contiene espacios: $value"
      ;;
  esac
  case "$value" in
    http://*|https://*) ;;
    *) fail "$key debe empezar con http:// o https://: $value" ;;
  esac
}

check_no_trailing_slash() {
  local key="$1"
  local value
  value="$(env_get "$key")"
  [ -n "$value" ] || return 0
  case "$value" in
    */) fail "$key no debe terminar con slash: $value" ;;
  esac
}

origin_of() {
  local value="$1"
  local rest
  case "$value" in
    http://*) rest="${value#http://}"; printf 'http://%s' "${rest%%/*}" ;;
    https://*) rest="${value#https://}"; printf 'https://%s' "${rest%%/*}" ;;
    *) printf '%s' "$value" ;;
  esac
}

host_of() {
  local origin
  origin="$(origin_of "$1")"
  origin="${origin#http://}"
  origin="${origin#https://}"
  printf '%s' "${origin%%:*}"
}

path_of() {
  local value="$1"
  local rest
  rest="${value#http://}"
  rest="${rest#https://}"
  case "$rest" in
    */*) printf '/%s' "${rest#*/}" ;;
    *) printf '/' ;;
  esac
}

is_public_bad_host() {
  case "$(host_of "$1")" in
    localhost|127.*|keycloak) return 0 ;;
    *) return 1 ;;
  esac
}

required=(
  FRONTEND_URL
  NEXT_PUBLIC_API_URL
  KEYCLOAK_ISSUER_URL
  KEYCLOAK_INTERNAL_URL
  KEYCLOAK_REDIRECT_URI
)

for key in "${required[@]}"; do
  require_var "$key"
  check_clean_url "$key"
done
check_no_trailing_slash FRONTEND_URL
check_no_trailing_slash NEXT_PUBLIC_API_URL
check_no_trailing_slash KEYCLOAK_ISSUER_URL
check_no_trailing_slash KEYCLOAK_INTERNAL_URL

FRONTEND_URL="$(env_get FRONTEND_URL)"
API_URL="$(env_get NEXT_PUBLIC_API_URL)"
ISSUER_URL="$(env_get KEYCLOAK_ISSUER_URL)"
INTERNAL_URL="$(env_get KEYCLOAK_INTERNAL_URL)"
REDIRECT_URI="$(env_get KEYCLOAK_REDIRECT_URI)"
GOOGLE_CALLBACK_URL="$(env_get GOOGLE_CALLBACK_URL)"
COOKIE_SECURE="$(env_get COOKIE_SECURE)"
COOKIE_SAMESITE="$(env_get COOKIE_SAMESITE)"
COOKIE_DOMAIN="$(env_get COOKIE_DOMAIN)"
KEYCLOAK_HOSTNAME="$(env_get KEYCLOAK_HOSTNAME)"

check_clean_url GOOGLE_CALLBACK_URL

if [ "$PRODUCTION" -eq 1 ]; then
  for pair in \
    "FRONTEND_URL:$FRONTEND_URL" \
    "NEXT_PUBLIC_API_URL:$API_URL" \
    "KEYCLOAK_ISSUER_URL:$ISSUER_URL" \
    "KEYCLOAK_REDIRECT_URI:$REDIRECT_URI"; do
    key="${pair%%:*}"
    value="${pair#*:}"
    case "$value" in
      https://*) ;;
      *) fail "$key debe usar https en produccion: $value" ;;
    esac
    if is_public_bad_host "$value"; then
      fail "$key apunta a un host no publico en produccion: $value"
    fi
  done

  case "$INTERNAL_URL" in
    http://keycloak:8080|http://keycloak:8080/*) ;;
    *) fail "KEYCLOAK_INTERNAL_URL debe ser http://keycloak:8080 en Docker: $INTERNAL_URL" ;;
  esac

  [ "$COOKIE_SECURE" = "true" ] || fail "COOKIE_SECURE debe ser true cuando FRONTEND/API usan HTTPS"
fi

case "$(path_of "$ISSUER_URL")" in
  /realms/*) ;;
  *) fail "KEYCLOAK_ISSUER_URL debe terminar en /realms/<realm>: $ISSUER_URL" ;;
esac

if [ "$(origin_of "$REDIRECT_URI")" != "$(origin_of "$API_URL")" ]; then
  fail "KEYCLOAK_REDIRECT_URI debe usar el mismo origen que NEXT_PUBLIC_API_URL ($API_URL): $REDIRECT_URI"
fi

[ "$(path_of "$REDIRECT_URI")" = "/auth/callback" ] || \
  fail "KEYCLOAK_REDIRECT_URI debe terminar en /auth/callback: $REDIRECT_URI"

if [ -n "$GOOGLE_CALLBACK_URL" ]; then
  if [ "$(origin_of "$GOOGLE_CALLBACK_URL")" != "$(origin_of "$API_URL")" ]; then
    fail "GOOGLE_CALLBACK_URL debe usar el mismo origen que NEXT_PUBLIC_API_URL ($API_URL): $GOOGLE_CALLBACK_URL"
  fi
fi

if [ -n "$KEYCLOAK_HOSTNAME" ]; then
  case "$KEYCLOAK_HOSTNAME" in
    http://*|https://*) kc_host="$(host_of "$KEYCLOAK_HOSTNAME")" ;;
    *) kc_host="${KEYCLOAK_HOSTNAME%%:*}" ;;
  esac
  [ "$kc_host" = "$(host_of "$ISSUER_URL")" ] || \
    fail "KEYCLOAK_HOSTNAME ($KEYCLOAK_HOSTNAME) no coincide con KEYCLOAK_ISSUER_URL ($ISSUER_URL)"
fi

case "$COOKIE_SAMESITE" in
  ""|lax|Lax|LAX|none|None|NONE|strict|Strict|STRICT) ;;
  *) fail "COOKIE_SAMESITE invalido: $COOKIE_SAMESITE" ;;
esac

if [ -n "$COOKIE_DOMAIN" ]; then
  cookie_base="${COOKIE_DOMAIN#.}"
  case "$(host_of "$API_URL")" in
    "$cookie_base"|*".$cookie_base") ;;
    *) warn "COOKIE_DOMAIN ($COOKIE_DOMAIN) no parece cubrir el host API ($(host_of "$API_URL"))" ;;
  esac
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  rendered="$(docker compose --env-file "$ENV_FILE" -f "$ROOT/docker-compose.cloud.yml" config 2>/dev/null || true)"
  if [ -n "$rendered" ]; then
    route_lines="$(printf '%s' "$rendered" | grep -E 'FRONTEND_URL|NEXT_PUBLIC_API_URL|KEYCLOAK_ISSUER_URL|KEYCLOAK_REDIRECT_URI|GOOGLE_CALLBACK_URL|KEYCLOAK_INTERNAL_URL' || true)"
    printf '%s' "$route_lines" | grep -E '(%7D|%7d|%7B|%7b|\})' >/dev/null && \
      fail "docker compose config contiene llaves renderizadas en variables de rutas; revisa interpolacion"
    printf '%s' "$rendered" | grep -F "NEXT_PUBLIC_API_URL: $API_URL" >/dev/null || \
      fail "docker compose config no renderiza NEXT_PUBLIC_API_URL como $API_URL"
    printf '%s' "$rendered" | grep -F "FRONTEND_URL: $FRONTEND_URL" >/dev/null || \
      fail "docker compose config no renderiza FRONTEND_URL como $FRONTEND_URL"
    printf '%s' "$rendered" | grep -F "KEYCLOAK_ISSUER_URL: $ISSUER_URL" >/dev/null || \
      fail "docker compose config no renderiza KEYCLOAK_ISSUER_URL como $ISSUER_URL"
  else
    warn "no pude renderizar docker compose config; salteo esa validacion"
  fi
fi

echo "OK rutas:"
echo "  FRONTEND_URL=$(origin_of "$FRONTEND_URL")"
echo "  NEXT_PUBLIC_API_URL=$(origin_of "$API_URL")"
echo "  KEYCLOAK_ISSUER_URL=$ISSUER_URL"
echo "  KEYCLOAK_INTERNAL_URL=$INTERNAL_URL"
echo "  KEYCLOAK_REDIRECT_URI=$REDIRECT_URI"
