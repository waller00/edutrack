# Reverse proxy publico con Cloudflare

Este documento describe como publicar EduTrack por HTTPS detras de Cloudflare
usando Nginx como reverse proxy. En produccion el proxy publica `80/443`; los
servicios internos `web`, `auth` y `keycloak` no deben publicar `3000`, `4000`
ni `8089` directamente.

## Arquitectura

```text
Usuario
  |
  v
Cloudflare DNS/WAF
  |
  v
reverse-proxy:80/443
  |-- edutrack-uy.com, www.edutrack-uy.com -> web:3000
  |-- api.edutrack-uy.com                 -> auth:4000
  |-- auth.edutrack-uy.com                -> keycloak:8080
  |-- moodle.edutrack-uy.com              -> moodle:8080
```

El proxy se une a la red Docker `edutrack_net`, por lo que no cambia la
comunicacion interna entre `web`, `auth`, `keycloak`, `redis` y `pg`. Tambien se
une a `edutrack_moodle-net` para conservar el acceso publico a Moodle por
`https://moodle.edutrack-uy.com`.

## Archivos agregados

- `docker-compose.proxy.yml`: agrega el servicio `reverse-proxy`.
- `nginx/reverse-proxy/nginx.conf`: define los virtual hosts y los headers
  `X-Forwarded-*`.
- `.env.proxy.example`: plantilla de variables publicas para el proxy.

## Requisitos previos

1. DNS en Cloudflare con nube naranja para:
   - `edutrack-uy.com`
   - `www.edutrack-uy.com`
   - `api.edutrack-uy.com`
   - `auth.edutrack-uy.com`
   - `moodle.edutrack-uy.com`
2. Certificado de origen o certificado valido en el servidor:
   - `/etc/ssl/cloudflare/cert.pem`
   - `/etc/ssl/cloudflare/key.pem`
3. Modo SSL/TLS de Cloudflare en **Full (strict)**.
4. Stack cloud base funcionando con `docker-compose.cloud.yml`.

## Variables recomendadas

Copiar los valores de `.env.proxy.example` al `.env` real del servidor y ajustar
lo que corresponda:

```env
CLOUDFLARE_ORIGIN_CERT_DIR=/etc/ssl/cloudflare
FRONTEND_URL=https://edutrack-uy.com
CORS_ORIGINS=https://edutrack-uy.com,https://www.edutrack-uy.com
NEXT_PUBLIC_API_URL=https://api.edutrack-uy.com
KEYCLOAK_HOSTNAME=auth.edutrack-uy.com
KEYCLOAK_ISSUER_URL=https://auth.edutrack-uy.com/realms/edutrack
KEYCLOAK_REDIRECT_URI=https://api.edutrack-uy.com/auth/callback
KEYCLOAK_ADMIN_BASE_URL=http://keycloak:8080
KEYCLOAK_INTERNAL_URL=http://keycloak:8080
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
```

Si se cambia `NEXT_PUBLIC_API_URL`, reconstruir `web`, porque Next.js embebe las
variables `NEXT_PUBLIC_*` durante el build.

Validar el `.env` del servidor sin imprimir secretos:

```bash
bash scripts/validate-reverse-proxy-env.sh .env
```

## Levantar el proxy

Validar configuracion combinada:

```bash
docker compose -f docker-compose.cloud.yml -f docker-compose.proxy.yml -f docker-compose.close-ports.prod.yml config
```

Levantar o actualizar:

```bash
docker compose -f docker-compose.cloud.yml -f docker-compose.proxy.yml -f docker-compose.close-ports.prod.yml up -d reverse-proxy
```

Si se modificaron variables de frontend:

```bash
docker compose -f docker-compose.cloud.yml -f docker-compose.proxy.yml -f docker-compose.close-ports.prod.yml up -d --build web auth keycloak reverse-proxy
```

Si Moodle se levanta en el mismo servidor, cerrarlo tambien detras del proxy:

```bash
docker compose -f docker-compose.moodle.yml -f docker-compose.close-ports.moodle.prod.yml up -d
```

## Prueba local sin TLS

Antes de tocar el droplet se puede validar el ruteo local por HTTP en el puerto
`18080`. Agregar al archivo `hosts` de Windows, normalmente
`C:\Windows\System32\drivers\etc\hosts`, ejecutando el editor como
administrador:

```text
127.0.0.1 edutrack-uy.local
127.0.0.1 www.edutrack-uy.local
127.0.0.1 api.edutrack-uy.local
127.0.0.1 auth.edutrack-uy.local
127.0.0.1 moodle.edutrack-uy.local
```

Levantar el proxy local:

```bash
docker compose -f docker-compose.yml -f docker-compose.moodle.yml -f docker-compose.proxy.local.yml up -d reverse-proxy-local
```

El override local marca `edutrack_net` como red externa para poder reutilizar la
red compartida aunque haya sido creada por otro compose del proyecto.

Probar:

```bash
curl -I http://edutrack-uy.local:18080/healthz
curl -I http://api.edutrack-uy.local:18080/health
curl -I http://auth.edutrack-uy.local:18080/realms/edutrack/.well-known/openid-configuration
curl -I http://moodle.edutrack-uy.local:18080/healthz
```

Esta prueba valida Nginx, resolucion de contenedores y headers basicos. No
valida Cloudflare, WAF, TLS ni cookies seguras.

Nota: en el proxy local, Moodle reenvia `Host: localhost:8080` porque la
instancia local se instala con ese `wwwroot`. En produccion se conserva
`moodle.edutrack-uy.com`.

## Validacion inicial

Probar desde fuera del servidor:

```bash
curl -I https://edutrack-uy.com/healthz
curl -I https://api.edutrack-uy.com/health
curl -I https://auth.edutrack-uy.com/realms/edutrack/.well-known/openid-configuration
curl -I https://moodle.edutrack-uy.com/healthz
```

Luego validar manualmente:

- carga del frontend;
- inicio de sesion con Keycloak;
- callback `/auth/callback`;
- cookie `sid` marcada como segura;
- `GET https://api.edutrack-uy.com/ready`;
- carga de Moodle por `https://moodle.edutrack-uy.com`;
- flujos externos que entren al backend, como Didit o ZKTeco si estan activos.

## Monitoreo y k6

El proxy publico no reemplaza el acceso privado de monitoreo. Grafana,
Prometheus, Loki y el remote-write de k6 por Tailscale deben seguir por sus
compose y redes actuales.

El reverse proxy expone `stub_status` solo dentro de la red Docker en
`http://reverse-proxy:8081/nginx_status`. El stack de monitoreo agrega
`nginx-prometheus-exporter`, Prometheus scrapea el job `reverse-proxy` y Grafana
provisiona el dashboard **Reverse Proxy Nginx**.

Los logs del proxy tambien viajan a Loki mediante Alloy porque se recolectan los
contenedores Docker del proyecto `edutrack`. El dashboard incluye:

- **Important log rate**: tasa de logs con errores, warnings, 4xx, 5xx o fallos
  de upstream.
- **Important proxy logs**: detalle filtrado de esos eventos.
- **Recent proxy access logs**: accesos recientes del proxy.

Si k6 apunta a `https://edutrack-uy.com` o `https://api.edutrack-uy.com`, la
carga pasara por Cloudflare y por este proxy. Eso es deseable para medir el
camino real, pero despues de activar WAF se deben revisar `403`, `429` o
challenges para evitar que las reglas afecten la baseline.

## Endurecimiento posterior

Cuando las validaciones anteriores pasen:

1. quitar la publicacion directa de `web`, `auth`, `keycloak` y `moodle` o
   bindearla a `127.0.0.1`;
2. restringir el firewall del droplet para exponer publicamente solo `80` y
   `443`;
3. opcionalmente permitir `80/443` solo desde rangos de Cloudflare;
4. activar WAF en modo conservador;
5. revisar Security Events antes de bloquear agresivamente.

## Rollback

Detener solo el proxy:

```bash
docker compose -f docker-compose.cloud.yml -f docker-compose.proxy.yml -f docker-compose.close-ports.prod.yml stop reverse-proxy
```

Si se detiene el proxy en produccion, el sitio publico deja de responder; los
servicios internos siguen vivos en la red Docker para diagnostico con
`./scripts/dc-cloud.sh exec`.
