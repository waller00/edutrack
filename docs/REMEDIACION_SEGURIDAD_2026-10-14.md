# Correcciones de la auditoría: avance por etapas

Referencia: [auditoría original](AUDITORIA_SEGURIDAD_2026-10-14.md). El informe
original y sus reproducciones se conservan como evidencia del estado anterior.
No se desplegaron estas correcciones ni se modificó SSH, UFW, Keycloak o Moodle.

## Etapa 1: callback OIDC (AUD-01)

Implementado localmente en `backend/src/routes/auth-keycloak.ts`:

- Cada login crea una cookie aleatoria de 256 bits, HttpOnly, host-only,
  SameSite=Lax y con duración de 10 minutos. Con HTTPS usa Secure y el prefijo
  `__Host-`, sin heredar el dominio de la cookie de sesión.
- Cada transacción tiene su propia cookie para permitir varias pestañas. Redis
  guarda el hash del secreto del navegador junto al verificador PKCE.
- El callback exige esa cookie antes de canjear el código. Un script Lua compara
  la vinculación y consume la transacción en una única operación Redis. Una
  petición sin cookie o con un secreto distinto no consume el login legítimo.
- Tras consumir el estado se elimina la cookie. Ni repeticiones ni callbacks
  concurrentes pueden volver a intercambiar el código.
- Se mantiene PKCE y el comportamiento de registro SSO y acciones requeridas
  de Keycloak. Las respuestas de inicio/callback no se almacenan en caché y el
  callback evita enviar la URL como Referer.

La cookie sigue `COOKIE_SECURE` para admitir testing HTTP. En producción HTTPS
debe estar en `true` (o sin definir con `NODE_ENV=production`). Se usa Lax para
que viaje en el callback GET desde el proveedor, aunque la sesión use Strict.

### Validación local

- 115/115 pruebas aprobadas en siete archivos de autenticación, registro,
  permisos y sesiones; incluyen 13 casos nuevos para AUD-01.
- `npm run typecheck` aprobado.
- Script Lua real probado en Redis 7 en un contenedor temporal sin red externa,
  puertos publicados ni volúmenes: un secreto incorrecto no consume estado;
  de 32 consumos concurrentes, exactamente uno obtiene el verificador; replay
  y transacciones anteriores sin vinculación se rechazan. Contenedor eliminado.
- `git diff --check` aprobado.

Las pruebas de rutas usan Keycloak simulado. La instalación y la ejecución se
hicieron en `/tmp/edutrack-security-fixes/backend`, copia sin archivos `.env`.
El primer intento de Supertest falló por la prohibición de sockets del sandbox;
se repitió con sockets locales habilitados, sin llamadas a producción.

Para repetir las pruebas desde `backend` con dependencias instaladas:

```bash
npm test -- src/auth/keycloak-provisioning.test.ts src/auth/keycloak.otp-verify.test.ts src/routes/auth-keycloak.routes.test.ts src/routes/auth.routes.test.ts src/middlewares/auth-session.test.ts src/middlewares/auth.test.ts src/middlewares/auth-permissions.test.ts
npm run typecheck
```

### Cierre pendiente en testing

Probar en navegadores reales login normal y Google, registro Google nuevo,
dos pestañas, contraseña, TOTP y generación de códigos de recuperación.
Confirmar los atributos de la cookie en la URL real del callback y comprobar
que copiar el callback a otro navegador sin la cookie no crea una sesión.
No registrar códigos OIDC, cookies ni tokens en las evidencias.

Los logins iniciados antes del despliegue no tienen la nueva cookie y serán
rechazados: se debe iniciar nuevamente el login. No se modifican las cuentas
ni las sesiones ya emitidas. El hallazgo queda **corregido localmente, pendiente
de validación integral y despliegue**, no cerrado en producción.

## Etapa 2: escritura de suplentes (AUD-03)

Implementado localmente, sin migración de datos, en las rutas de libretas y su
servicio de autorización. Se conserva la lectura histórica de toda la libreta.
La capacidad general `canGrade` no basta para escribir: cada operación comprueba
la cobertura concreta del suplente o un permiso explícito `gradebook.grade=all`.

- Crear, editar, eliminar evaluaciones y guardar/eliminar notas requiere una
  suplencia del mismo usuario, día, ciclo, grupo, asignatura y orientación.
- Se compara el día civil de la evaluación con el inicio del día institucional
  guardado en la suplencia; no se compara directamente mediodía UTC con medianoche
  local ni se desplaza una evaluación antigua guardada a medianoche UTC al día anterior.
- Cambiar la fecha de una evaluación exige cobertura tanto de la fecha original
  como de la nueva: no se puede mover una evaluación ajena al día suplido.
- Las ventanas de edición siguen vigentes. La creación por suplentes también
  las verifica. No se permite crear ni mover evaluaciones a períodos cerrados.
- Una suplencia por día no concede autorización global para notas/juicios de
  período, cierres ni importaciones masivas Moodle. Esas operaciones quedan para
  el titular o un permiso global explícito. No se incorporó una delegación nueva
  de cierre de períodos; de necesitarse debe definirse por separado.
- Las respuestas de lectura de períodos y cierres indican que no son editables
  por el suplente. Las evaluaciones conservan la lectura, con `canEdit=false`
  cuando la fecha no está cubierta.
- Las escrituras de período se autorizan antes de crear su estado auxiliar en
  base de datos. No se modifica la planificación ni el pase de lista, que tienen
  sus controles específicos.

### Validación local

- 458/458 pruebas aprobadas en los 23 archivos de la suite de libretas, incluidas
  35 pruebas nuevas (servicio y rutas). Se simulan datos y permisos explícitos;
  las pruebas de rutas ejecutan el nuevo helper real de cobertura por fecha.
- Casos negativos: antes/después del día suplido, otro usuario y otro scope,
  suplencia eliminada, cambio de fecha en ambos sentidos, escrituras globales,
  ventana vencida, período cerrado y ciclo archivado. Se comprueba que las
  escrituras protegidas no se invocan al rechazar la petición.
- Casos positivos: creación/calificación/edición en el día cubierto, lectura
  histórica, titular y permisos globales explícitos. Las regresiones existentes
  cubren administración, supervisión, importación y cierres.
- TypeScript y `git diff --check` aprobados. Ejecución en la copia temporal sin
  `.env`, con sockets locales para Supertest. Sin conexiones a producción.

```bash
cd backend
npm test -- src/services/gradebook src/routes/gradebook.routes.test.ts
npm run typecheck
```

Pendiente para cierre: probar en testing con datos sintéticos y cuentas reales
de titular, suplente y supervisión; verificar la fecha de una suplencia real y
los permisos/grants efectivos. Esta suite no sustituye las pruebas autenticadas
contra Postgres y Keycloak reales. AUD-03 queda **corregido localmente, pendiente
de validación integral y despliegue**.

## Identidad permanente (AUD-02): postergada por el usuario

Pendiente de implementación y migración. No activar un cambio de identificación
sin reconciliar antes las cuentas locales con el realm real.

1. Agregar almacenamiento explícito de `(issuer, subject)` con unicidad y sin
   convertir automáticamente `googleId`: ese campo tiene usos históricos.
2. Preparar un inventario de IDs locales y sujetos de Keycloak. La coincidencia
   de email/username sólo propone candidatos; no autoriza el enlace. Revisar
   cuentas privilegiadas, huérfanas, duplicadas y con correos sin verificar.
3. Aplicar en testing un manifiesto de enlaces revisado, sin sobrescribir
   enlaces existentes. Verificar que todas las cuentas que deben acceder tengan
   su correspondencia antes de activar la resolución estricta.
4. Resolver el login exclusivamente por issuer/subject; los atributos mutables
   no deben conceder acceso a una cuenta existente. Capturar el sujeto en las
   altas normales, administrativas, Google y herramientas de preparación.
5. Revisar también `createKeycloakUser`: actualmente ante un conflicto 409
   busca por email, reutiliza la cuenta y puede cambiar su contraseña. Esa
   adopción debe eliminarse o exigir un procedimiento explícito de enlace;
   cambiar únicamente `provisionUserFromClaims` no cubre esa ruta.
6. Probar sujetos diferentes con iguales atributos, issuer distinto, cambios
   de correo, altas concurrentes, roles existentes, recuperación, Google y MFA.

El punto 5 es una observación de código adicional; no se ensayó la toma de una
cuenta real. No ejecutar los scripts de sincronización de usuarios demo contra
producción: contienen actualización de contraseñas y no son una migración de
identidades apropiada.

## Etapas siguientes

1. AUD-05 y AUD-04: IP resuelta exclusivamente por proxies de confianza y TTL
   efectivo de sesiones de performance. Validar cadena real y hardware en testing.
2. AUD-06/07/08: versiones corregidas compatibles, configuración que rechace
   secretos de ejemplo y cuenta técnica Moodle con capacidades mínimas.
   La rotación requiere coordinar clientes y probar sincronización.

La migración SSH/Tailscale sigue siendo independiente. Se conserva público el
puerto 22 por instrucción del usuario hasta completar las pruebas acordadas.
