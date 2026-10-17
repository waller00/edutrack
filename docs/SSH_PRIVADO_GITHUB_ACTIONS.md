# Migracion gradual de SSH de produccion a Tailscale

## Estado y alcance

### Avance confirmado al 17/10/2026

- La ejecucion de **Verify production SSH through Tailscale** desde `main`
  (`4ac360d`) conecto el runner, alcanzo `100.92.202.72:22` y completo la
  autenticacion SSH. Mostro `Private SSH authentication OK` y finalizo sin
  despliegue ni cambios de firewall. El servidor tambien reporto `4ac360d`.
- El administrador confirmo `PRODUCTION_SSH_TAILSCALE=true` en el environment
  `production`. El proximo despliegue usara el transporte privado.
- Sigue pendiente comprobar un despliegue completo por Tailscale, la
  recuperacion y el acceso privado de los tres administradores. El puerto
  publico 22 debe permanecer abierto hasta completar esas verificaciones.

Los workflows de produccion pueden conectarse a Tailscale antes del SSH usando
la accion local `.github/actions/production-ssh`. Se conserva OpenSSH en TCP 22,
usuario `root` y `SSH_PRIVATE_KEY`. No se activa el producto Tailscale SSH, no se
cambian `authorized_keys`, `sshd_config` ni UFW. El puerto 22 publico permanece
abierto hasta completar pruebas con los tres administradores y los runners.

Si `PRODUCTION_SSH_TAILSCALE` no esta definida o vale `false`, los despliegues usan
el destino publico `SSH_HOST`. La prueba privada se puede ejecutar sin activar
la migracion. Con el interruptor en `true`, cualquier error de identidad, ACL,
conexion TCP o autenticacion SSH detiene el workflow, sin fallback publico.

Incluye deploy automatico/manual de produccion, recuperacion y los snapshots SSH
de `performance-production-baseline.yml`. Testing queda sin cambios: es otro
servidor y no se verifico su incorporacion a Tailscale.

## 1. Permisos de Tailscale

Agregar a la politica existente, sin reemplazar sus reglas:

```json
{
  "tagOwners": {
    "tag:github-deploy": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["tag:github-deploy"],
      "dst": ["100.92.202.72"],
      "ip": ["tcp:22"]
    }
  ]
}
```

Es un fragmento para combinar con `tagOwners` y `grants` actuales. No autorizar
SSH a `tag:github-k6`, que sigue destinado solamente a metricas.

Si se quiere ejecutar el baseline de produccion con SSH privado Y publicacion
de metricas en el mismo runner, agregar un segundo grant de `tag:github-deploy`
a `100.92.202.72`, `tcp:9201`. El runner utiliza una sola conexion Tailscale con
identidad de despliegue. El workflow de metricas autenticadas independiente
conserva su identidad limitada `tag:github-k6` y no obtiene acceso SSH.

Para los humanos, invitar a los otros dos administradores y crear un grupo con
los tres identificadores reales de Tailscale. Permitir a ese grupo TCP 22 hacia
`100.92.202.72`. Cada uno conserva su propia clave SSH autorizada. No compartir
la clave privada del runner ni ampliar permisos de la consola Keycloak por esto.

## 2. Identidad federada para el runner

Crear una identidad federada de GitHub Actions en Tailscale, separada de la de
metricas, autorizada a emitir nodos efimeros con `tag:github-deploy`.
Restringirla al repositorio actual **waller00/edutrack** y al environment
**production**. El subject recibido por Tailscale en la ejecucion revisada es:

```text
repo:waller00@242244337/edutrack@1183698688:environment:production
```

El valor anterior sin identificadores numericos no coincidia con el recibido y
provocaba un 403 durante el intercambio del JWT. Tras corregir el subject, la
prueba completo la conexion. Para esta identidad, conservar la coincidencia
exacta con el subject recibido; no ampliar la confianza con comodines para
resolver un rechazo. No publicar el JWT ni las credenciales en los logs.

Todos los jobs SSH de produccion ahora usan ese environment (incluida la prueba).
Configurar en GitHub las protecciones/ramas permitidas de `production`; revisar
los permisos de los tres compañeros para que puedan ejecutar/aprobar los jobs.
El ref de un rollback no requiere cambiar el ref del workflow: se puede ejecutar
el workflow desde main y elegir el commit objetivo en `git_ref`.

En GitHub -> Settings -> Environments -> production -> Environment secrets:

- `TS_DEPLOY_CLIENT_ID`: Client ID de la nueva identidad federada.
- `TS_DEPLOY_AUDIENCE`: audience indicada por Tailscale para esa identidad.

Se conservan `SSH_USER`, `SSH_PRIVATE_KEY` y `SSH_HOST` existentes. Verificar que
no existan secretos de environment con esos nombres y valores distintos que
oculten accidentalmente los del repositorio. No copiar credenciales en el YAML.

En variables del environment `production`:

- `PRODUCTION_SSH_TAILSCALE_HOST`: `100.92.202.72` (valor predeterminado del codigo).
- `PRODUCTION_SSH_TAILSCALE`: `true` tras la prueba privada exitosa. Para una
  instalacion nueva, mantener `false` o sin definir hasta completar esa prueba.

La huella ECDSA de produccion se verifico por una conexion SSH previamente
confiable y con drone-ssh 1.8.0 (el cliente de la accion). Se fija en los workflows
porque es el algoritmo que negocia ese cliente:

```text
SHA256:dJ8zFDAOeippOmWV1Ll2fdx+7rLm7nFtFHWV5iv5mmY
```

Si se reconstruye el droplet o se rotan sus host keys, verificar la nueva huella
por un canal confiable y actualizarla. No desactivar la verificacion para evitar
el error. Esto es la clave publica DEL SERVIDOR, no la clave privada de acceso.

## 3. Prueba sin despliegue

Una vez publicado el workflow en main y configurada la identidad y ACL:

1. Actions -> **Verify production SSH through Tailscale** -> Run workflow (main).
2. Debe conectar el runner efimero, alcanzar TCP 22, comprobar la host key y
   autenticar con la clave existente. Solo ejecuta lecturas (`id`, `hostname`,
   revision Git, `docker ps`, existencia del archivo Compose).
3. No ejecutar pruebas de carga para probar conectividad. Este workflow no
   cambia contenedores, codigo, reglas ni configuraciones del servidor.
4. Si falla antes de conectar Tailscale, revisar identidad, audience y claims.
   Si falla TCP, revisar grant TCP 22 y direccion. Un ping Tailscale exitoso no
   demuestra permiso TCP 22. Si falla host key o autenticacion, revisar huella,
   `SSH_USER`, `SSH_PRIVATE_KEY` y `authorized_keys` sin mostrar sus secretos.

## 4. Activar los workflows existentes

Con la prueba verde, definir `PRODUCTION_SSH_TAILSCALE=true` en `production`.
Los siguientes deploys y recuperaciones usaran el destino privado. El flag no
cierra el puerto publico ni cambia las claves. Validar un despliegue controlado
y programar una prueba de recuperacion en una ventana apropiada: recuperacion
SI recrea servicios, a diferencia del smoke test.

Cambiar el transporte no cambia los comandos de despliegue: se sigue usando
OpenSSH, ahora sobre la red privada. Un push a `main`, incluso de documentacion,
dispara el despliegue completo salvo que se omita CI. Puede recrear servicios y
ejecutar configuracion de base de datos y Keycloak; no equivale a la prueba de
conexion de solo lectura. El workflow Recover recrea servicios con los archivos
e imagenes disponibles: no restaura automaticamente una version o base anterior.

Antes de cerrar SSH publico, completar:

- prueba privada del runner verde;
- despliegue por Tailscale correcto;
- recuperacion validada en una ventana acordada;
- snapshots del workflow de performance alcanzables por Tailscale (no lanzar
  carga solo para probar SSH);
- cada uno de los tres administradores conecta en una sesion nueva por la IP
  Tailscale y verifica los tuneles que use, por ejemplo Grafana;
- consola de recuperacion DigitalOcean disponible.

## Operativa diaria del equipo

Los commits, pulls, pushes y la ejecucion o aprobacion de Actions no requieren
que el equipo personal este conectado a Tailscale. El runner establece su propia
conexion mediante la identidad federada y utiliza `SSH_PRIVATE_KEY` para SSH.

Para entrar directamente al servidor por su IP privada, cada administrador
necesita Tailscale conectado, permiso TCP 22 y su propia clave SSH autorizada.
Aunque se conserve el usuario `root`, las claves personales deben ser distintas;
la clave del runner debe ser exclusiva de automatizacion y no compartirse entre
personas. Verificar cada acceso desde una sesion nueva antes de cerrar el puerto
publico:

```bash
ssh root@100.92.202.72
```

## Reversion durante las pruebas

Cambiar `PRODUCTION_SSH_TAILSCALE=false`: los workflows vuelven a `SSH_HOST`
publico. No borrar sus secretos durante la migracion. Desactivar el flag es una
decision explicita; un fallo privado nunca cambia automaticamente de ruta.
El puerto publico permanece abierto por instruccion del usuario; ningun archivo
de este cambio ejecuta modificaciones de firewall o del servicio SSH.

## Referencias

- https://tailscale.com/docs/integrations/github/github-action
- https://github.com/tailscale/github-action
- https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect
