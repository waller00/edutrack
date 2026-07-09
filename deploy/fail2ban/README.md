# fail2ban — EduTrack

Dos jails:

| Jail | Qué protege | Dónde banea |
|------|-------------|-------------|
| `sshd` | Fuerza bruta al SSH del droplet (tiene password auth) | iptables/nftables del host (IP real, directa) |
| `nginx-waf-cf` | Reincidentes del WAF web (444/403/405/429) | **Cloudflare** (IP Access Rules) vía API |

## Por qué el web se banea en Cloudflare y no en iptables
El origen está detrás de Cloudflare: a nivel de red solo ve IPs de Cloudflare. Un ban en
el firewall del host no cortaría al atacante real (y banear un rango de CF = outage). Por eso
el jail web usa la acción `cloudflare-zone`, que agrega la IP real del atacante a las
**IP Access Rules** de Cloudflare (bloqueo en el borde). nginx ya restaura la IP real
(`CF-Connecting-IP`), así que la que se loguea —y se banea— es la del cliente, no la de CF.

## Requisito: token de Cloudflare (no versionado)
El archivo `/root/.cf_token` debe contener un **API Token** con permiso
`Zone → Firewall Services → Edit` sobre `edutrack-uy.com` (idealmente restringido por IP al
servidor). `chmod 600`, dueño root. **Nunca se commitea.**

## Deploy
En el servidor, como root:

```bash
cd /root/edutrack        # el repo desplegado
git pull                 # traer estos archivos
bash deploy/fail2ban/install.sh
```

El instalador copia el filtro y la acción, completa el `logpath` con el json-log de Docker del
reverse-proxy, valida el filtro con `fail2ban-regex`, reinicia fail2ban y muestra el estado.

## Verificar / operar
```bash
fail2ban-client status nginx-waf-cf         # baneos activos
tail -f /var/log/fail2ban-cloudflare.log    # log de la acción Cloudflare

# Prueba manual con IP reservada (no afecta a nadie):
fail2ban-client set nginx-waf-cf banip 192.0.2.1
fail2ban-client set nginx-waf-cf unbanip 192.0.2.1
```

## Notas / mantenimiento
- Si se **recrea** el contenedor del proxy, cambia la ruta del json-log → re-correr `install.sh`.
- Los rangos de Cloudflare están en `ignoreip` (red de seguridad para no banear un edge de CF);
  si Cloudflare agrega rangos, actualizarlos aquí y en el WAF (ver `scripts/waf-cloudflare-ranges.sh`).
- Umbrales conservadores (`maxretry=8`/`findtime=10m`): el tráfico legítimo no genera 4xx del WAF,
  así que el riesgo de falso positivo es muy bajo.
