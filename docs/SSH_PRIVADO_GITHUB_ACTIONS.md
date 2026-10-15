# Migracion gradual de SSH de produccion a Tailscale

## Estado y alcance

Los workflows de produccion pueden conectarse a Tailscale antes del SSH usando
la accion local `.github/actions/production-ssh`. Se conserva OpenSSH en TCP 22,
usuario `root` y `SSH_PRIVATE_KEY`. No se activa el producto Tailscale SSH, no se
cambian `authorized_keys`, `sshd_config` ni UFW. El puerto 22 publico permanece
abierto hasta completar pruebas con los tres administradores y los runners.

Por defecto `PRODUCTION_SSH_TAILSCALE` no esta definida: los despliegues conservan
el destino publico `SSH_HOST`. La prueba privada se puede ejecutar sin activar
la migracion. Con el interruptor en `true`, cualquier error de identidad, ACL,
conexion TCP o autenticacion SSH detiene el workflow, sin fallback publico.

Incluye deploy automatico/manual de produccion, recuperacion y los snapshots SSH
de `performance-production-baseline.yml`. Testing queda sin cambios: es otro
servidor y no se verifico su incorporacion a Tailscale.

## 1. Permisos de Tailscale (configuracion externa pendiente)

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
**production**. El subject OIDC esperado para estos jobs es:

```text
repo:waller00/edutrack:environment:production
```

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
- `PRODUCTION_SSH_TAILSCALE`: mantener `false` o sin definir hasta terminar la prueba.

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

Antes de cerrar SSH publico, completar:

- prueba privada del runner verde;
- despliegue por Tailscale correcto;
- recuperacion validada en una ventana acordada;
- snapshots del workflow de performance alcanzables por Tailscale (no lanzar
  carga solo para probar SSH);
- cada uno de los tres administradores conecta en una sesion nueva por la IP
  Tailscale y verifica los tuneles que use, por ejemplo Grafana;
- consola de recuperacion DigitalOcean disponible.

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
