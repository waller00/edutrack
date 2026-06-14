#!/usr/bin/env bash
set -euo pipefail

env_file="${1:-.env.monitoring}"

if [[ ! -f "$env_file" ]]; then
  echo "No existe el archivo de entorno: $env_file" >&2
  exit 1
fi

address="$(
  sed -n 's/^TAILSCALE_BIND_ADDRESS=//p' "$env_file" |
    tail -n 1 |
    tr -d "\"'\r"
)"

if [[ ! "$address" =~ ^100\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]]; then
  echo "TAILSCALE_BIND_ADDRESS debe ser una IPv4 del rango 100.64.0.0/10." >&2
  exit 1
fi

second_octet="${BASH_REMATCH[1]}"
third_octet="${BASH_REMATCH[2]}"
fourth_octet="${BASH_REMATCH[3]}"

if ((second_octet < 64 || second_octet > 127 || third_octet > 255 || fourth_octet > 255)); then
  echo "TAILSCALE_BIND_ADDRESS queda fuera del rango 100.64.0.0/10." >&2
  exit 1
fi

echo "Bind Tailscale valido: $address"
