#!/usr/bin/env bash
#
# waf-cloudflare-ranges.sh — Detecta si los rangos IP de Cloudflare cambiaron
# respecto de los cableados en el WAF del reverse-proxy.
#
# Por qué: el WAF de nginx (nginx/reverse-proxy/nginx.conf) usa los rangos de
# Cloudflare en dos lugares — `set_real_ip_from` (restaurar IP real) y el bloque
# `geo $realip_remote_addr $cf_ok` (lockdown: solo Cloudflare llega al origen).
# Si Cloudflare AGREGA un rango y no lo reflejamos, el tráfico legítimo que salga
# por esa IP cae en el lockdown (HTTP 444) → incidente difícil de diagnosticar.
#
# Este script NO modifica nada: solo compara y reporta. Pensado para correr por
# cron (semanal) y avisar. Sale con código != 0 si hay drift.
#
# Uso:
#   scripts/waf-cloudflare-ranges.sh [ruta-al-nginx.conf]
# Default: nginx/reverse-proxy/nginx.conf (relativo a la raíz del repo).

set -euo pipefail

CONF="${1:-$(cd "$(dirname "$0")/.." && pwd)/nginx/reverse-proxy/nginx.conf}"
V4_URL="https://www.cloudflare.com/ips-v4"
V6_URL="https://www.cloudflare.com/ips-v6"

if [[ ! -f "$CONF" ]]; then
  echo "ERROR: no existe la config: $CONF" >&2
  exit 2
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# --- Rangos oficiales (abortar si la descarga falla; no queremos falsos positivos) ---
if ! curl -fsS --max-time 20 "$V4_URL/" -o "$tmp/v4" || ! curl -fsS --max-time 20 "$V6_URL/" -o "$tmp/v6"; then
  echo "ERROR: no se pudieron descargar los rangos de Cloudflare (¿red?). Abortando sin reportar drift." >&2
  exit 2
fi
sort -u "$tmp/v4" "$tmp/v6" | grep -E '/[0-9]+$' > "$tmp/official"

official_count="$(wc -l < "$tmp/official" | tr -d ' ')"
if [[ "$official_count" -lt 10 ]]; then
  echo "ERROR: la lista oficial trajo solo $official_count rangos (respuesta inesperada). Abortando." >&2
  exit 2
fi

# --- Verificar que CADA rango oficial esté presente en la config (en cualquiera de los dos bloques) ---
missing=()
while IFS= read -r range; do
  [[ -z "$range" ]] && continue
  if ! grep -qF -- "$range" "$CONF"; then
    missing+=("$range")
  fi
done < "$tmp/official"

# --- Rangos tipo Cloudflare en `set_real_ip_from` que ya no están en la lista oficial (informativo) ---
grep -oE 'set_real_ip_from[[:space:]]+[0-9a-fA-F:.]+/[0-9]+' "$CONF" \
  | awk '{print $2}' | sort -u > "$tmp/in_config"
obsolete="$(comm -23 "$tmp/in_config" "$tmp/official" || true)"

echo "Config:   $CONF"
echo "Oficiales: $official_count rangos de Cloudflare"
echo

if [[ ${#missing[@]} -eq 0 && -z "$obsolete" ]]; then
  echo "OK — el WAF está en sync con los rangos de Cloudflare."
  exit 0
fi

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "DRIFT (RIESGO): ${#missing[@]} rango(s) de Cloudflare FALTAN en el WAF."
  echo "  → Tráfico legítimo por esas IPs sería bloqueado (444). Agregarlos a"
  echo "    'set_real_ip_from' Y al bloque 'geo \$realip_remote_addr \$cf_ok':"
  printf '    %s\n' "${missing[@]}"
  echo
fi

if [[ -n "$obsolete" ]]; then
  echo "OBSOLETOS (bajo riesgo): en 'set_real_ip_from' pero ya no en Cloudflare:"
  printf '    %s\n' $obsolete
  echo
fi

echo "Para aplicar: editar nginx/reverse-proxy/nginx.conf, 'nginx -t', y REINICIAR"
echo "el contenedor del proxy (docker restart edutrack-reverse-proxy-1) — un simple"
echo "reload no basta por el bind-mount de archivo único (el inode queda desincronizado)."
exit 1
