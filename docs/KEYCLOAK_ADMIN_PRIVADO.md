# Keycloak: acceso administrativo privado por Tailscale

Estado al 2026-10-11: fases 1 y 2 aplicadas en produccion. Serve activo;
master usa la URL privada y la API administrativa interna responde 200.
Desde la PC se verificaron consola y formulario de login privado (HTTP 200),
certificado valido e issuer privado. Login interactivo confirmado por el usuario.
Fase 3 aplicada: consola, API admin y endpoints master publicos devuelven 404.
Se probaron diez rutas/variantes publicas; consola privada 200, web 200, Moodle
303 e issuer publico de edutrack conservado. Respaldo del proxy previo al cierre:
`/root/keycloak-admin-backup-20261011/nginx-before-public-close.conf`.
Respaldos protegidos en servidor: `/root/keycloak-admin-backup-20261011/`.
La configuracion y su integracion CI/CD se versionan junto con este documento.

Validacion local realizada: Compose fusionado sin puertos publicados de Keycloak
y con proxy ligado solo a loopback; `bash -n`; `nginx -t` con la imagen indicada.
En contenedores efimeros aislados se probaron cuatro rutas permitidas y cinco
denegadas, y la sustitucion de Host, esquema, puerto y XFF manipulados por el
cliente. El upstream de esa prueba fue simulado: faltan el login real de
Keycloak, certificados/ACL de Tailscale y las pruebas de integracion en servidor.

## Resultado previsto

PC autorizada -> Tailscale HTTPS :443 -> Serve -> 127.0.0.1:18090
-> proxy privado Nginx -> keycloak:8080.

URL prevista: `https://edutrack-production.tail6c4540.ts.net/admin/master/console/`.
El login de EduTrack conserva `https://auth.edutrack-uy.com/realms/edutrack`.
El backend conserva `KEYCLOAK_ADMIN_BASE_URL=http://keycloak:8080`.
No se cambian cuentas, contraseñas, MFA, version de Keycloak ni modo de arranque.

El override es exclusivo para produccion de EduTrack: fija el hostname publico
actual. No usarlo en testing sin adaptar ese valor. No publicar el puerto 8089.

## Antes de aplicar

- Confirmar la regla Tailscale PC `100.92.202.71` -> servidor `100.92.202.72`, TCP 443.
- Confirmar MagicDNS y HTTPS Certificates habilitados y dispositivos conectados.
- Conservar una sesion SSH de recuperacion y respaldo vigente de la BD Keycloak.
- Guardar el valor actual de **master -> Realm settings -> General -> Frontend URL**
  (incluido si esta vacio), y la configuracion efectiva de los clients
  `security-admin-console` y `account-console` antes de alterar URLs.
- Revisar `tailscale serve status` y `tailscale funnel status`. No sobrescribir
  otro servicio en 443. No habilitar Funnel: esta entrada debe ser privada.
- Comprobar que `127.0.0.1:18090` este libre. Revisar la version Docker y su
  aislamiento de puertos loopback; no confiar solo en UFW para puertos Docker.
- Coordinar la ventana: recrear Keycloak puede interrumpir temporalmente el login.
- Evitar despliegues concurrentes durante la prueba (CI puede recrear Keycloak).

## Fase 1: levantar la entrada privada, conservando las rutas publicas

Tras aprobar el despliegue, agregar al `.env` del servidor, sin exponer secretos:

```dotenv
KEYCLOAK_ADMIN_PRIVATE_HOST=edutrack-production.tail6c4540.ts.net
KEYCLOAK_PUBLIC_BIND_IP=165.22.34.95
```

El override liga el 443 publico a `KEYCLOAK_PUBLIC_BIND_IP` para que Serve pueda
escuchar en el 443 de Tailscale. Verificar la IP antes de aplicar. En este servidor
no hay IPv6 publica; si se agrega, configurar su binding por separado.

Desde la raiz `edutrack` en el servidor:

```bash
bash scripts/dc-keycloak-admin.sh config --quiet
bash scripts/dc-keycloak-admin.sh up -d --no-deps reverse-proxy
bash scripts/dc-keycloak-admin.sh up -d --no-deps keycloak
bash scripts/dc-keycloak-admin.sh up -d --no-deps keycloak-admin-proxy
bash scripts/dc-keycloak-admin.sh exec keycloak-admin-proxy nginx -t
curl --fail --silent --show-error http://127.0.0.1:18090/admin/master/console/ -o /dev/null
sudo tailscale serve --bg --https=443 http://127.0.0.1:18090
tailscale serve status
```

Si Keycloak aun arranca, esperar a que responda antes de continuar. Serve termina
TLS con un certificado valido del hostname MagicDNS. El proxy fija Host, esquema
y puerto; no depende de la IP cambiante del contenedor. El proxy HTTP local NO
debe publicarse en 0.0.0.0 ni en la IP Tailscale.

Desde la PC autorizada abrir la URL privada. En esta primera prueba el login de
master puede redirigir todavia al dominio publico. Esto no valida aun el cierre.

## Fase 2: llevar tambien la autenticacion de master a la direccion privada

Con la consola privada operativa, en **master -> Realm settings -> General ->
Frontend URL**, establecer:

```text
https://edutrack-production.tail6c4540.ts.net
```

No cambiar el Frontend URL de `edutrack`. `KC_HOSTNAME_ADMIN` cambia la consola,
pero la autenticacion usa la URL frontend del realm: hacen falta ambas partes.
El cambio de master altera su issuer; comprobar los consumidores de tokens master,
incluidos scripts y backend, antes de cerrar el acceso publico.

Desde una ventana privada nueva, completar login y logout; confirmar en Network
que autorizacion, token y API administrativa permanecen en el hostname privado.
Si aparece `invalid_redirect_uri`, revisar Root URL, redirect URIs y web origins
de `security-admin-console`; permitir solo la URL privada precisa, sin comodines
globales. No cambiar clients a ciegas: conservar su configuracion para rollback.

Comprobar desde la PC:

```bash
curl --fail --silent --show-error \
  https://edutrack-production.tail6c4540.ts.net/realms/master/.well-known/openid-configuration \
  | python3 -m json.tool
```

Issuer, authorization_endpoint y token_endpoint deben apuntar a la URL privada.
Repetir la consulta publica para `edutrack`: su issuer debe permanecer publico.
Verificar acceso a ambos realms, listado de usuarios, login EduTrack y Moodle.
Comprobar una operacion del backend que use la API administrativa con una cuenta
de prueba autorizada; cargar una pantalla no prueba esa integracion.
Sin Tailscale (y sin otra VPN hacia esa red), la entrada privada no debe ser accesible.
Validar tambien denegacion desde un dispositivo sin permiso cuando este disponible.

## Persistencia en despliegues

Los jobs de produccion de `deploy.yml` y `deploy-recover.yml` incluyen el override
como ultimo archivo y levantan el proxy privado. Testing permanece igual.
`dc-cloud.sh` lo incorpora cuando `.env` (o el entorno) define
`KEYCLOAK_ADMIN_PRIVATE_HOST`. `dc-keycloak-admin.sh` lo incorpora siempre.
Usar los workflows de esta revision o posteriores. Un despliegue de codigo
anterior a esta migracion puede retirar `KC_HOSTNAME_ADMIN` o reabrir las rutas
administrativas. La configuracion Frontend URL persiste en la BD.
Serve con `--bg` persiste tras reiniciar Tailscale/servidor.

## Fase 3: cierre publico (aplicado tras confirmar el login privado)

Solo despues de las pruebas anteriores, agregar en el bloque server de
`auth.edutrack-uy.com` del proxy publico, antes de `location /`:

```nginx
location = /admin { return 404; }
location ^~ /admin/ { return 404; }
location = /realms/master { return 404; }
location ^~ /realms/master/ { return 404; }
```

No permitir excepciones por cabeceras del cliente. Revisar otros hostnames y
proxies que puedan dar acceso a Keycloak. No bloquear `/realms/edutrack/` ni
`/resources/`. Validar `nginx -t` antes de recargar; verificar desde Internet que
las cuatro rutas anteriores y sus variantes normalizadas esten bloqueadas,
que la API admin publica ya no llegue a Keycloak y que la entrada privada siga
funcionando. Repetir pruebas de login y operaciones de usuarios.

## Reversion

1. Si ya se aplico fase 3, retirar solo las cuatro reglas nuevas del proxy
   publico, validar su configuracion y recargarlo.
2. Manteniendo Serve activo, restaurar el Frontend URL anterior de master y los
   ajustes de clients que se hayan modificado. No restaurar una BD completa para
   revertir este campo. Si no se puede usar la consola, usar la Admin API/kcadm
   por la red Docker desde SSH con credenciales vigentes, sin poner passwords
   en argumentos, historial o logs.
3. Revertir la integracion CI si se hizo; recrear solo Keycloak con la lista
   Compose previa, SIN usar el wrapper mientras la variable privada exista:
   `docker compose -f docker-compose.cloud.yml -f docker-compose.proxy.yml -f docker-compose.close-ports.prod.yml up -d --no-deps keycloak`.
   Retirar `KEYCLOAK_ADMIN_PRIVATE_HOST` del `.env` tras detener el proxy en el paso 4.
4. Probar nuevamente la consola publica, login y backend. Despues detener el
   proxy privado con `bash scripts/dc-keycloak-admin.sh stop keycloak-admin-proxy`
   y retirar esta entrada Serve:
   `sudo tailscale serve --bg --https=443 off`.
   No usar `tailscale serve reset`: podria eliminar otros servicios.
   Despues restaurar los bindings originales de reverse-proxy con los tres
   archivos Compose anteriores y `up -d --no-deps reverse-proxy`; retirar tambien
   `KEYCLOAK_PUBLIC_BIND_IP` del `.env` si ya no se usa.
5. Conservar los respaldos y registrar el resultado. No ejecutar `compose down`
   ni borrar volumenes para esta migracion.

## Referencias

- https://www.keycloak.org/server/hostname
- https://www.keycloak.org/server/reverseproxy
- https://tailscale.com/docs/reference/tailscale-cli/serve
