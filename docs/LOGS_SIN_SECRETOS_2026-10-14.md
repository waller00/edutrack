# Protección de logs y revisión de históricos — 14/10/2026

## Estado

**Aplicación completada y verificada en producción el 17/10/2026** sobre el
repositorio del servidor en `008d5fc`. La revisión original del 14/10 fue de
lectura; el 17/10 se reiniciaron únicamente Alloy y el proxy privado de Keycloak
para completar la carga de las configuraciones publicadas. La API y el proxy
público ya tenían la corrección. No se eliminaron históricos ni se cambiaron
permisos o retención. SSH público permanece abierto.

### Verificación en producción del 17/10

- Configuraciones anteriores respaldadas en el servidor en
  `/root/edutrack-deploy-backups/logs-20261017T180537Z`, con directorio `0700` y
  archivos `0600`. Son configuraciones, no copias de logs ni de bases de datos.
- Nginx validado y Alloy cargado en un contenedor aislado antes de la activación.
- Reinicio de los contenedores existentes, conservando sus históricos Docker.
  Se comprobó que ambos montaron los archivos actuales y que el proxy regeneró
  su configuración con `access_safe`.
- API y ambos proxies: parámetros sintéticos ausentes en los access logs.
- Logout con JWT ficticio: Keycloak devolvió 400, sin falso positivo del WAF.
  Otro parámetro sospechoso produjo el evento WAF esperado; una prueba de
  inyección fue bloqueada con 403. No se usaron tokens reales ni sesiones de usuario.
- Loki recibió los eventos de los proxies y cuatro líneas de una fuente Docker
  temporal con query, Bearer, Cookie y access_token ficticios: valores sustituidos
  por `[REDACTED]`. El contenedor de prueba se eliminó al finalizar.
  Marcador de la comprobación: `log-check-1792260404`.
- Alloy ready, frontend público y discovery OIDC respondieron HTTP 200.

Pendiente: automatizar la aplicación de cambios de configuración de Alloy y del
proxy privado en futuros despliegues; revisar acceso/retención e históricos como
tareas separadas. Esta prueba no sustituye un login/logout autenticado de usuario.

## Corrección

- Nginx público, local y proxy privado Keycloak: los access logs registran método,
  ruta original sin query, estado, tamaño y user-agent. No incluyen Referer ni
  la línea `$request` completa. Se conservan los nombres de eventos WAF para los
  dashboards. Se aplica escape JSON a las variables del formato.
- El proxy privado declara su access log en el servidor para sobrescribir el
  formato heredado de la imagen Nginx: agregarlo sólo al bloque HTTP mantendría
  además el log inseguro predeterminado.
- El backend usa la misma política para su access log Morgan, sin modificar
  `req.url`, `req.originalUrl` ni los parámetros que necesita el callback.
- La detección amplia WAF reemplaza sólo un `id_token_hint` con formato JWT
  compacto en la ruta OIDC de logout antes de buscar firmas sospechosas. No
  deshabilita el WAF para esa ruta: los otros argumentos, tokens malformados y
  duplicados continúan siendo inspeccionados. La firma `--` sigue detectándose
  fuera de ese valor. **Todas las reglas de bloqueo conservan los argumentos
  originales**. Esta excepción de observación no valida JWT; eso corresponde a
  Keycloak.
- La prueba real detectó un escape preexistente incorrecto en la alternativa de
  traversal con backslash, que afectaba las siguientes alternativas codificadas.
  Se corrigió el escape y se verificó el bloqueo de `%2e%2e%2f`.
- Alloy redacta queries de URLs, Authorization, cookies y valores de tokens,
  contraseñas y secretos antes de enviar nuevas líneas a Loki. Se captura sólo
  el valor sensible: `stage.replace` reemplaza cada grupo, no admite `$1` como
  una sustitución de regex convencional en este uso.

No se registran tokens reales en las pruebas ni en este documento.

### Límites

La corrección cubre los formatos de acceso/WAF y una defensa adicional de ingesta.
El `error_log` interno de Nginx tiene formato propio y puede incluir la petición
original en errores de upstream. Alloy sanea las queries de esas líneas antes de
Loki, pero **esa capa no reescribe la copia original de Docker**. Tampoco puede
garantizar la eliminación de secretos arbitrarios impresos por cualquier servicio
en formatos no reconocidos. Se conservó la observabilidad de errores, sin
silenciarla para ocultar este límite.

## Pruebas

- Configuraciones Nginx completas de producción/local aceptadas por Nginx 1.27.
- Proxy privado probado con un formato inseguro heredado: sólo emite la ruta.
- 11 consultas sintéticas y un path bloqueado en Nginx real: logout normal,
  parámetros antes/después del JWT, SQLi/XSS/traversal, JWT malformado/duplicado,
  callback y Referer con secretos. WAF_SUSPICIOUS/BLOCKED/DROPPED y access logs no
  incluyen los valores sensibles.
- 7 líneas procesadas por Alloy 1.6.1 real: consultas, ID token, refresh token,
  Bearer, cookies, JSON, contraseñas y claves. Se verifica la salida, no sólo la
  sintaxis de las expresiones.
- 33 pruebas backend aprobadas (integración de app, callback y logging). El caso
  de logging comprueba que el handler aún recibe code/state, aunque el log no.
- TypeScript y `git diff --check` aprobados.

Repetición aislada, sin red de los contenedores ni puertos publicados:

```bash
python3 scripts/test-log-security.py
cd backend
npm test -- src/middlewares/access-log.test.ts src/__tests__/app.integration.test.ts src/routes/auth-keycloak.routes.test.ts
npm run typecheck
```

## Acceso y retención comprobados en producción

| Componente | Evidencia de lectura |
|---|---|
| Grafana | Un usuario activo `admin`, administrador de servidor y organización; cero API keys en su base SQLite. |
| Anónimos | `GF_AUTH_ANONYMOUS_ENABLED=false`, signup deshabilitado y `/api/search` sin sesión devuelve 401. |
| Dashboards públicos | Cero dashboards públicos habilitados en la base de Grafana. |
| Publicación Grafana | `127.0.0.1:3001`, no escucha directamente en interfaces públicas. |
| Loki | Sin puertos publicados, en la red Docker de monitoring. Instancia de un tenant; su acceso se apoya en aislamiento de red/Grafana, no en autenticación propia. |
| Retención Loki | Configuración efectiva de 1 semana (168 h), compactor habilitado, intervalo 10 min y retraso de eliminación 2 h. Métricas registran ejecuciones exitosas de retención. |
| Docker de proxy/auth/proxy privado | `json-file`, `max-size=10m`, `max-file=3`: aproximadamente 30 MB por contenedor, **sin plazo por edad**. |
| Docker de Grafana/Loki/Alloy | `json-file` sin límites explícitos en su LogConfig; no se modificó esa configuración en esta revisión. |
| Grupo Docker del host | Sin miembros listados; `root` conserva acceso administrativo. |

Quien use la cuenta compartida de Grafana puede consultar el datasource Loki.
Quien tenga root/privilegios Docker puede acceder a los logs y volúmenes sin
pasar por Grafana. Los contenedores con conectividad a Loki también pueden
consultarlo directamente. El inventario de usuarios no permite atribuir a una
persona cada uso de una contraseña o clave SSH compartida.

La retención se elimina de forma asíncrona; las métricas exitosas no certifican
que una línea concreta ya haya desaparecido. No se inspeccionaron backups,
snapshots, exportaciones ni copias fuera del servidor.

## Históricos y futuros despliegues

Cambiar el formato sólo protege nuevas emisiones tras aplicar el cambio. No
redacta lo ya guardado en Loki, Docker, backups o exportaciones. No se borraron
datos ni se redujo la retención como parte de esta tarea.

Para cambios futuros, validar los archivos del servidor antes de aplicarlos.
Actualizar un archivo en Git no garantiza que un contenedor existente recargue
su bind mount ni que el proxy regenere el template. Comprobar la configuración
montada y efectiva después de cada actualización, y validar con datos sintéticos
la salida tanto en Docker como en Loki. Verificar además un logout legítimo sin
copiar el token al informe.

Antes de una eventual eliminación histórica, acordar el alcance (servicio,
período, Loki/Docker/backups), conservar la evidencia necesaria y usar el
procedimiento soportado por cada almacén. No borrar chunks o volúmenes a mano.
Si se detectan credenciales reutilizables expuestas, evaluar su revocación según
el tipo; un ID token de logout no equivale automáticamente a una contraseña.

Referencias:

- [Alloy: stage.replace](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.process/#stagereplace)
- [Loki: retención y borrado asíncrono](https://grafana.com/docs/loki/latest/operations/storage/retention/)
