#!/usr/bin/env bash
set -euo pipefail

env_file="${1:-.env}"

if [[ ! -f "$env_file" ]]; then
  echo "No existe el archivo de entorno: $env_file" >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$env_file" |
    tail -n 1 |
    sed 's/[[:space:]]*#.*$//' |
    tr -d "\"'\r"
}

require_value() {
  local key="$1"
  local expected="$2"
  local actual
  actual="$(read_env_value "$key")"

  if [[ -z "$actual" ]]; then
    echo "Falta $key=$expected" >&2
    return 1
  fi

  if [[ "$actual" != "$expected" ]]; then
    echo "$key debe ser '$expected' y actualmente es '$actual'" >&2
    return 1
  fi

  echo "OK $key"
}

require_optional_warning() {
  local key="$1"
  local expected="$2"
  local actual
  actual="$(read_env_value "$key")"

  if [[ -z "$actual" ]]; then
    echo "WARN falta $key=$expected"
    return 0
  fi

  if [[ "$actual" != "$expected" ]]; then
    echo "WARN $key recomendado '$expected', actual '$actual'"
    return 0
  fi

  echo "OK $key"
}

failures=0

require_value CLOUDFLARE_ORIGIN_CERT_DIR /etc/ssl/cloudflare || failures=$((failures + 1))
require_value FRONTEND_URL https://edutrack-uy.com || failures=$((failures + 1))
require_value CORS_ORIGINS https://edutrack-uy.com,https://www.edutrack-uy.com || failures=$((failures + 1))
require_value NEXT_PUBLIC_API_URL https://api.edutrack-uy.com || failures=$((failures + 1))
require_value KEYCLOAK_HOSTNAME auth.edutrack-uy.com || failures=$((failures + 1))
require_value KEYCLOAK_ISSUER_URL https://auth.edutrack-uy.com/realms/edutrack || failures=$((failures + 1))
require_value KEYCLOAK_REDIRECT_URI https://api.edutrack-uy.com/auth/callback || failures=$((failures + 1))
require_value KEYCLOAK_ADMIN_BASE_URL http://keycloak:8080 || failures=$((failures + 1))
require_value KEYCLOAK_INTERNAL_URL http://keycloak:8080 || failures=$((failures + 1))
require_value COOKIE_SECURE true || failures=$((failures + 1))
require_value COOKIE_SAMESITE lax || failures=$((failures + 1))

cert_dir="$(read_env_value CLOUDFLARE_ORIGIN_CERT_DIR)"
cert_dir="${cert_dir:-/etc/ssl/cloudflare}"

if [[ ! -f "$cert_dir/cert.pem" ]]; then
  echo "Falta certificado: $cert_dir/cert.pem" >&2
  failures=$((failures + 1))
else
  echo "OK cert.pem"
fi

if [[ ! -f "$cert_dir/key.pem" ]]; then
  echo "Falta clave privada: $cert_dir/key.pem" >&2
  failures=$((failures + 1))
else
  echo "OK key.pem"
fi

require_optional_warning MOODLE_BASE_URL https://moodle.edutrack-uy.com
require_optional_warning MOODLE_PUBLIC_URL https://moodle.edutrack-uy.com
require_optional_warning MOODLE_CANONICAL_HOST moodle.edutrack-uy.com

if ((failures > 0)); then
  echo "Validacion fallida: $failures problema(s)." >&2
  exit 1
fi

echo "Variables de reverse proxy listas."
