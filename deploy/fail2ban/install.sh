#!/usr/bin/env bash
#
# Instala/actualiza los jails de fail2ban de EduTrack en el servidor.
# Idempotente. Ejecutar como root en el droplet:  bash deploy/fail2ban/install.sh
#
# Requisito para el jail web (nginx-waf-cf): el API token de Cloudflare en /root/.cf_token
# (chmod 600). El token NO está en el repo. Sin ese archivo, solo se instala el jail sshd.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PROXY="${PROXY_CONTAINER:-edutrack-reverse-proxy-1}"

command -v fail2ban-client >/dev/null || { echo "fail2ban no está instalado (apt-get install -y fail2ban)"; exit 1; }

# 1. filtro + acción
cp "$DIR/filter.d/nginx-waf-cf.conf" /etc/fail2ban/filter.d/
cp "$DIR/action.d/cloudflare-zone.conf" /etc/fail2ban/action.d/

# 2. jail.local: completar el logpath con el json-log de Docker del reverse-proxy
LOGP="$(docker inspect --format '{{.LogPath}}' "$PROXY")"
[ -n "$LOGP" ] || { echo "No pude obtener el LogPath de $PROXY"; exit 1; }
sed "s#__DOCKER_JSONLOG__#${LOGP}#" "$DIR/jail.local" > /etc/fail2ban/jail.local

# 3. token de Cloudflare
if [ -s /root/.cf_token ]; then
  chmod 600 /root/.cf_token
  echo "token de Cloudflare: presente."
else
  echo "AVISO: falta /root/.cf_token → el jail nginx-waf-cf no podrá banear en Cloudflare."
fi

# 4. validar el filtro contra el log real
echo "== fail2ban-regex (debe encontrar matches en los 444/403/405/429) =="
fail2ban-regex "$LOGP" /etc/fail2ban/filter.d/nginx-waf-cf.conf | grep -iE '^\s*(Failregex|Lines|matched|missed)' || true

# 5. recargar y verificar
systemctl restart fail2ban
sleep 2
echo "== jails activos =="
fail2ban-client status
echo "== nginx-waf-cf =="
fail2ban-client status nginx-waf-cf || true

cat <<'EOT'

Listo. Prueba manual del baneo en Cloudflare (opcional, usa una IP reservada):
  fail2ban-client set nginx-waf-cf banip 192.0.2.1
  # verificar en Cloudflare:
  curl -s "https://api.cloudflare.com/client/v4/zones/4584a387a67e88275ccbd99b5a797c44/firewall/access_rules/rules?configuration.value=192.0.2.1" \
    -H "Authorization: Bearer $(cat /root/.cf_token)" | python3 -m json.tool | grep -E 'value|mode|id'
  # quitar:
  fail2ban-client set nginx-waf-cf unbanip 192.0.2.1

Ver baneos: tail -f /var/log/fail2ban-cloudflare.log
EOT
