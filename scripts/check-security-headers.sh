#!/usr/bin/env bash
# Comprueba (sólo lectura) las cabeceras de seguridad que sirve producción. Es la evidencia de que
# lo que dice nginx.conf es lo que de verdad le llega al navegador, a través de Cloudflare.
#
# Uso: ./scripts/check-security-headers.sh [https://edutrack-uy.com] [https://api.edutrack-uy.com]
set -uo pipefail

FRONT="${1:-https://edutrack-uy.com}"
API="${2:-https://api.edutrack-uy.com}"
failures=0

headers_of() {
  curl -sS -o /dev/null -D - --max-time 15 "$1" | tr -d '\r'
}

expect_header() {
  local label="$1" headers="$2" pattern="$3"
  if printf '%s\n' "$headers" | grep -qiE "$pattern"; then
    echo "  OK    $label"
  else
    echo "  FALTA $label"
    failures=$((failures + 1))
  fi
}

reject_header() {
  local label="$1" headers="$2" pattern="$3"
  if printf '%s\n' "$headers" | grep -qiE "$pattern"; then
    echo "  MAL   $label: $(printf '%s\n' "$headers" | grep -iE "$pattern" | head -1)"
    failures=$((failures + 1))
  else
    echo "  OK    $label"
  fi
}

echo "== Front: $FRONT/login"
front="$(headers_of "$FRONT/login")"
expect_header "HSTS (1 año, subdominios)" "$front" '^strict-transport-security: max-age=31536000; includesubdomains'
expect_header "X-Content-Type-Options: nosniff" "$front" '^x-content-type-options: nosniff'
expect_header "X-Frame-Options" "$front" '^x-frame-options: (sameorigin|deny)'
expect_header "Referrer-Policy" "$front" '^referrer-policy: '
expect_header "Content-Security-Policy (o Report-Only)" "$front" '^content-security-policy(-report-only)?: .*default-src'
reject_header "sin X-Powered-By" "$front" '^x-powered-by:'

echo "== Front: optimizador de imágenes de Next cerrado"
image_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$FRONT/_next/image?url=%2Ffavicon.ico&w=64&q=75")"
if [[ "$image_status" == "404" ]]; then
  echo "  OK    /_next/image responde 404"
else
  echo "  MAL   /_next/image responde $image_status (tiene que ser 404 mientras siga Next 14)"
  failures=$((failures + 1))
fi

echo "== API: $API/health"
api="$(headers_of "$API/health")"
expect_header "HSTS" "$api" '^strict-transport-security: max-age='
expect_header "X-Content-Type-Options: nosniff" "$api" '^x-content-type-options: nosniff'
expect_header "Content-Security-Policy (Helmet)" "$api" '^content-security-policy: '
reject_header "sin X-Powered-By" "$api" '^x-powered-by:'

echo "== API: escritura desde otro origen (CSRF)"
csrf_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X POST -H 'Origin: https://evil.example' \
  -H 'Content-Type: application/json' -d '{}' "$API/messages/conversations")"
if [[ "$csrf_status" == "403" ]]; then
  echo "  OK    POST con Origin ajeno responde 403"
else
  echo "  MAL   POST con Origin ajeno responde $csrf_status (tiene que ser 403)"
  failures=$((failures + 1))
fi

echo
if [[ $failures -eq 0 ]]; then
  echo "Todo en orden."
else
  echo "$failures control(es) fallaron."
fi
exit $(( failures > 0 ))
