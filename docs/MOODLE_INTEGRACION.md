# Integración con Moodle

EduTrack sincroniza su dominio académico hacia Moodle de forma **idempotente y resiliente**.
La fuente de verdad siempre es la BD de EduTrack; Moodle es un espejo. La integración queda
**inactiva** (no-op) si no hay `MOODLE_BASE_URL` + `MOODLE_WS_TOKEN`.

Código: [`backend/src/integrations/moodle/`](../backend/src/integrations/moodle).

## Arquitectura

| Capa | Archivo | Rol |
|------|---------|-----|
| Cliente REST | `client.ts` | HTTP + protocolo REST de Moodle; lee la config de entorno. |
| Usuarios | `users.ts` | Crea/recupera el usuario espejo (`idnumber` = UUID EduTrack) y persiste `User.moodleUserId`. |
| Scope académico | `scope.ts` | Resuelve el curso Moodle por **asignatura/orientación** de un evento (`idnumber` idempotente). |
| Cursos | `courses.ts` | Categorías y cursos (legacy por oferta y por asignatura) con mapeo `MoodleObjectMap`. |
| Inscripciones | `enrolments.ts` | Matriculación manual: `enrol_manual_enrol_users` (con ventana) y `enrol_manual_unenrol_users`. |
| Tracking | `enrolment-map.ts` | Registra qué acceso otorgó la integración (`MoodleEnrolmentMap`) para revocar con seguridad. |
| Outbox | `outbox.ts` | Cola persistente con reintentos + backoff (reemplaza el *fire-and-forget*). |
| Reconciliación | `reconcile.ts` | Estado deseado EduTrack→Moodle: cursos + titulares + suplencias + revocación + *drift*. |
| Curso por asignatura | `subject-course.ts` | Resuelve el curso Moodle de una asignatura probando la orientación de más específica a más general. |
| Notas (tareas) | `grades.ts` | Capa WS de tareas (`mod_assign`): lista tareas y lee sus notas. |
| Libro de calificaciones | `gradebook.ts` | `gradereport_user_get_grade_items`: **todos** los ítems del curso y las notas de todos los alumnos, en una llamada. |

### Modelos de datos (Prisma)

- `User.moodleUserId` — id del usuario espejo (idempotencia y detección de *drift*).
- `MoodleSyncTask` — outbox: `type`, `dedupeKey`, `payload`, `status`, `attempts`, `runAfter`, `lastError`.
- `MoodleObjectMap` — mapeo `(objectType, localId) → moodleId` para categorías, cursos (legacy y por
  asignatura: `SUBJECT_COURSE`) y estudiantes.
- `MoodleEnrolmentMap` — tracking fino de las inscripciones otorgadas: `userId`, `moodleUserId`,
  `moodleCourseId`, `roleId`, `sourceType` (`TEACHER_EVENT` | `SUBSTITUTE` | `STUDENT_ENROLLMENT`),
  `sourceId`, `startsAt`, `endsAt`, `status` (`ACTIVE` | `REVOKED`). Clave lógica
  `(sourceType, userId, moodleCourseId)`. Permite saber qué acceso fue creado por titularidad,
  suplencia o matrícula y revocar sin depender sólo del estado remoto de Moodle.

### Mapeo de entidades

| EduTrack | Moodle | `idnumber` |
|----------|--------|------------|
| `SchoolYear` | Categoría | `et-year-<id>` |
| Asignatura en curso/año (general) | Curso `SUBJECT_COURSE` | `et-subject-offering-<offering>-<subject>` |
| Asignatura con `orientationId` | Curso `SUBJECT_COURSE` | `…-<subject>-orientation-<orientationId>` |
| Asignatura con `courseOrientationId` | Curso `SUBJECT_COURSE` | `…-<subject>-corientation-<courseOrientationId>` |
| `CourseOffering` (legacy / fallback) | Curso | `et-offering-<id>` |
| `User` (docente) | Usuario, rol *editingteacher* | UUID del User |
| `Student` con `username`+`email` | Usuario **manual** (puede entrar a Moodle), rol *student* | `et-student-<id>` |
| `Student` sin email | Usuario *nologin* (espejo histórico), rol *student* | `et-student-<id>` |

El `shortname` del curso por asignatura es el propio `idnumber` (estable y único); el `fullname` es
legible: `Asignatura - Curso [- Orientación] (Año)` (p. ej. `Biología - 4to EMS - Ciencias Biológicas (2026)`).

#### Cómo se derivan los accesos docentes

El acceso docente en Moodle se deriva de los **eventos académicos** de EduTrack; nunca se inscribe a
un docente al `CourseOffering` completo salvo el fallback legacy.

- **Curso por asignatura/orientación** (`scope.ts`): un evento con `courseOfferingId` + `subjectId`
  mapea a un curso Moodle por asignatura. Si tiene `courseOrientationId` (precedencia) u
  `orientationId`, mapea al curso específico de esa orientación; si no, al espacio **general** de la
  asignatura. Así no se mezclan permisos entre asignaturas ni entre orientaciones.
- **Docente titular** (`MoodleEnrolmentMap.sourceType = TEACHER_EVENT`): se inscribe (rol
  `MOODLE_ROLE_TEACHER_ID`) en el curso de cada clase asignada (`Event.assignedUserId` +
  `courseOfferingId` + `subjectId`). Dedupe por `(assignedUserId, curso)`.
- **Fallback legacy**: un evento **sin** `subjectId` no puede resolverse a un curso por asignatura;
  se usa el curso por `CourseOffering` (`et-offering-<id>`). Documentado y testeado para no perder
  cobertura de datos viejos.
- **Estudiantes → asignaturas**: de la matrícula activa (`StudentEnrollment` con estado `ACTIVE`), si
  `moodleSyncStudents` está activo. El alumno se inscribe en las asignaturas comunes de su
  `CourseOffering` y, si su matrícula tiene orientación, también en las asignaturas de esa orientación.
  Las asignaturas de otras orientaciones quedan fuera. La reconciliación registra estos accesos como
  `STUDENT_ENROLLMENT` y revoca los que ya no corresponden si el estudiante cambia de curso,
  orientación o estado.

#### Cuenta Moodle del estudiante (`student-users.ts`)

Los estudiantes no tienen cuenta de login en EduTrack, pero con `Student.username`
(formato `nombre.apellido`, autogenerado en la planilla) y `Student.email` se les crea una
**cuenta real en Moodle** (`auth=manual`):

- Al guardar un estudiante con email, la ruta encola una tarea `STUDENT_USER_UPSERT`
  (`dedupeKey: student:<id>`). El worker crea/actualiza el usuario en Moodle y, **una sola vez**
  (claim atómico sobre `Student.moodleWelcomeSentAt`), envía un mail de bienvenida con el username,
  el link a Moodle (`MOODLE_PUBLIC_URL`) y el link `…/login/forgot_password.php` para que el alumno
  establezca su contraseña. **Requiere SMTP configurado en el propio Moodle** para completar el reset.
- Un espejo `nologin` histórico que gana email se **actualiza** a `manual` con
  `core_user_update_users` (mismo `moodleId`, mapping intacto).
- Sin email se mantiene el espejo `nologin` con email sintético, para que la matriculación
  nunca dependa del dato de contacto.

#### Suplencias (acceso temporal del suplente)

- Por cada `Substitution` vigente (`endTime >= ahora`) el suplente se inscribe (rol
  `MOODLE_ROLE_SUBSTITUTE_TEACHER_ID`, o el de titular si no está configurado) en el **mismo** curso
  Moodle que corresponde a la clase cubierta (asignatura + orientación si aplica).
- La inscripción lleva **ventana temporal** (`timestart`/`timeend` de `enrol_manual_enrol_users`). Si
  la suplencia cubre varias clases, la ventana va del primer inicio al **fin del último** evento
  cubierto (`MoodleEnrolmentMap.sourceType = SUBSTITUTE`).
- **Revocación** (idempotente y segura): la reconciliación detecta filas `SUBSTITUTE` activas que ya
  no corresponden a ninguna suplencia vigente (vencida, cancelada o suplente cambiado) y llama a
  `enrol_manual_unenrol_users`. No revoca si el usuario:
  - es **titular** del mismo curso por un evento vigente (sólo marca la fila como `REVOKED`, conserva
    el acceso titular), o
  - tiene **otra suplencia vigente/futura** en el mismo curso.
  Sólo se revocan accesos que la integración otorgó como suplencia (los `timeend` de Moodle son la
  primera línea de expiración; la reconciliación es la red de seguridad).

## Fiabilidad (outbox)

Antes, las rutas hacían `void ensureMoodleUserById(id)`: si Moodle estaba caído, el fallo se
perdía y la desincronización era permanente. Ahora esa llamada **encola** un `MoodleSyncTask`
que el worker reintenta con backoff exponencial (1 min → … → 6 h) hasta `maxAttempts` (8).
La reconciliación periódica recupera cualquier divergencia que el outbox no cubra.

## Activación

1. Variables de entorno (ver `.env.compose.example`):
   `MOODLE_BASE_URL`, `MOODLE_WS_TOKEN`, opcionalmente `MOODLE_CANONICAL_HOST`,
   `MOODLE_ROLE_TEACHER_ID`, `MOODLE_ROLE_STUDENT_ID`, `MOODLE_ROLE_SUBSTITUTE_TEACHER_ID`
   (default: el rol de titular), `MOODLE_ROOT_CATEGORY_ID`, `MOODLE_USER_AUTH`.
2. Flags en `SystemSettings` (BD) **o** panel **Admin → Configuración → Moodle**:
   - `moodleSyncEnabled` — habilita el worker (outbox + reconciliación). Default `false`.
   - `moodleReconcileIntervalMs` — intervalo de reconciliación completa. Default 900000 (15 min).
   - `moodleSyncStudents` — sincroniza también estudiantes. Default `false`.
3. Opcional en `.env`: `MOODLE_SYNC_ENABLED=true` activa el worker aunque la BD aún tenga
   `moodleSyncEnabled=false` (útil en producción sin SQL manual). También define el default al
   crear la fila `SystemSettings` por primera vez.

El worker vive en [`backend/src/server.ts`](../backend/src/server.ts) (tick de 30 s, gateado por estos flags).

## Funciones de servicio web requeridas en Moodle

En el servicio externo (Administración > Servidor > Servicios web > Servicios externos), añadí:

```
core_user_get_users_by_field
core_user_create_users
core_user_update_users
core_course_get_categories
core_course_create_categories
core_course_get_courses_by_field
core_course_create_courses
enrol_manual_enrol_users
enrol_manual_unenrol_users
core_enrol_get_enrolled_users
```

> `enrol_manual_unenrol_users` es nueva: la usa la revocación de suplencias. Si falta, las
> inscripciones de suplente sólo expirarán por `timeend` y la red de seguridad no podrá quitarlas.

Activá el protocolo **REST** y generá el token (ver cabecera de `docker-compose.moodle.yml`).

## Despliegue en VPS (producción)

Moodle corre en un servidor aparte con `docker-compose.moodle.yml` (Bitnami). Si al abrir
`https://moodle.edutrack-uy.com` te redirige a `localhost:8080`, el `config.php` quedó con el
`wwwroot` de desarrollo.

1. Variables de Moodle en un archivo **aparte** (no pisar el `.env` de producción de EduTrack):
   [`docs/moodle.env.example`](moodle.env.example) → `.env.moodle` en el VPS.
2. El proxy (nginx/Caddy) debe enviar `Host`, `X-Forwarded-Proto: https` y `X-Forwarded-Host`.
3. **Instancia ya instalada** (caso habitual): desde la raíz del repo en el VPS:

   ```bash
   git pull
   # NUNCA: cp ... .env  (sobrescribe el .env principal de EduTrack)
   cp -n docs/moodle.env.example .env.moodle   # -n = no sobrescribir si ya existe
   docker compose -f docker-compose.moodle.yml --env-file .env.moodle up -d --force-recreate moodle
   MOODLE_PUBLIC_URL=https://moodle.edutrack-uy.com MOODLE_ENV_FILE=.env.moodle ./scripts/moodle-apply-edutrack-theme.sh
   ```

   Debe quedar **una sola** línea `wwwroot` (sin `localhost`).

4. En el VPS de EduTrack (`.env` del compose cloud):

   ```env
   MOODLE_BASE_URL=https://moodle.edutrack-uy.com
   MOODLE_CANONICAL_HOST=moodle.edutrack-uy.com
   ```

Desarrollo local sigue usando `MOODLE_HOST=localhost:8080` y, si hace falta, el parche dinámico
[`scripts/patch-moodle-wwwroot-dynamic.php`](../scripts/patch-moodle-wwwroot-dynamic.php).

## SSO con Keycloak (identidad unificada)

EduTrack ya usa Keycloak (OIDC) como IdP. Para que el login de Moodle use el mismo IdP y no
haya contraseñas divergentes:

1. **En Keycloak**: creá un client `moodle` (OIDC, confidential, Authorization Code) en el realm
   `edutrack`. Redirect URI: `https://TU-MOODLE/admin/oauth2callback.php`. Anotá client id/secret.
2. **En Moodle**: Administración del sitio > Servidor > Servicios OAuth 2 > "Crear nuevo servicio
   personalizado" con los endpoints del realm
   (`/.well-known/openid-configuration` de Keycloak) y el client id/secret.
3. Administración del sitio > Plugins > Autenticación > **OAuth 2**: habilitá y configurá el
   matcheo por email.
4. Poné `MOODLE_USER_AUTH=oauth2` para que los usuarios espejo se creen con ese método.

Tras instalar Moodle o si la API responde **403 vacío**, ejecutá:

```bash
./scripts/moodle-config-webservices.sh
./scripts/moodle-config-auth-email.sh
```

El primero activa REST, autoriza al usuario del token y agrega las funciones del servicio EduTrack.
El segundo alinea OAuth/SMTP (sin re-confirmar correo en login EduTrack).

El emparejamiento es por **email**, que EduTrack ya provisiona; así el docente entra a Moodle
con su cuenta de Keycloak sin gestionar credenciales aparte.

**Confirmación de correo:** si el emisor OAuth2 (Keycloak) tiene `requireconfirmation=1`, Moodle
crea cuentas con `confirmed=0` y exige un mail que Moodle mismo envía (requiere SMTP). Eso no
tiene sentido cuando el usuario ya verificó el correo en EduTrack/Keycloak. Ejecutá una vez:

```bash
./scripts/moodle-config-auth-email.sh
```

Ese script:
- desactiva la confirmación extra en el emisor OAuth2 (`requireconfirmation=0`);
- confirma usuarios `oauth2` que quedaron pendientes;
- configura el SMTP de Moodle con las mismas variables `SMTP_*` que usa EduTrack (para login
  `email` y otros avisos de Moodle).

Los usuarios espejo creados por la integración con `MOODLE_USER_AUTH=oauth2` se provisionan con
`confirmed=1`.

> Nota: el SSO es configuración de Moodle/Keycloak; EduTrack sólo provisiona el usuario y fija
> el método de auth. No hay forma de automatizarlo enteramente desde el backend.

## Notas: importación Moodle → libreta

EduTrack es la **fuente de verdad** de las calificaciones: viven en su libreta digital, con
períodos, cierres, juicios conceptuales, visado y auditoría. Moodle **aporta** las notas de sus
actividades; nunca al revés. No hay push de vuelta.

El puente offline por planilla `.xlsx` que existía antes (`/admin/grades`) fue dado de baja: no
persistía nada, era sólo admin y sólo veía tareas `mod_assign` de tipo punto.

### Circuito

1. `GET /gradebook/:id/moodle/preview` — resuelve el curso Moodle de la libreta con
   `subject-course.ts`, lee el libro de calificaciones y muestra qué traería: los ítems, cuántas
   notas mapean a la cohorte, cuántas no y cuáles ya se importaron antes. **No escribe nada.**
2. `POST /gradebook/:id/moodle/import` — el docente elige ítems, período y escala destino, y
   confirma.

### Reglas

- **Idempotente.** La clave `(gradeBookId, moodleGradeItemId)` garantiza que un ítem de Moodle
  produzca una sola evaluación. Reimportar actualiza y deja `GradeRevision` con origen
  `MOODLE_IMPORT`, así que se puede rastrear qué nota vino de dónde.
- **Nunca toca un período cerrado.** Responde `PERIOD_CLOSED` y no fuerza.
- **Conversión de escala.** Moodle suele puntuar sobre 100 y la libreta sobre 12 o 10: la nota se
  proyecta linealmente a la escala elegida y el docente la ve en la previsualización antes de
  confirmar. Copiar el crudo daría un "80" en una escala que llega a 12.
- **Un alumno sin calificar en Moodle no se importa**, ni como cero ni como ausente. `graderaw`
  nulo significa "todavía no rindió".
- **Se descartan los totales** de curso y categoría: son agregados que Moodle calcula y duplicarían
  lo que la libreta ya promedia. También los ítems ocultos y los que no puntúan.
- **Mapeo de alumnos:** por el `idnumber` `et-student-<uuid>`, que viaja en la misma respuesta;
  el mapeo persistente (`MoodleObjectMap`) queda de respaldo.
- **Sin Moodle configurado** la libreta funciona igual: el panel se oculta y el endpoint responde
  409.

### Funciones WS requeridas

El token WS debe tener habilitadas en su *external service*, además de las de sincronización:

- `gradereport_user_get_grade_items` — libro de calificaciones completo del curso. **Es la que usa
  la importación**; con `userid=0` devuelve todos los ítems y todos los alumnos en una llamada.
- `mod_assign_get_assignments` — listar tareas del curso.
- `mod_assign_get_grades` — notas de una tarea.

Si faltan, las llamadas fallan con `webservice_access_exception` (visible como `MOODLE_EXCEPTION`).

## Tema visual EduTrack

El repo incluye un tema Moodle versionado en [`moodle/theme/edutrack`](../moodle/theme/edutrack).
Es un tema hijo de Boost: mantiene compatibilidad con Moodle 5 y aplica la estética de EduTrack
(verde esmeralda, tarjetas blancas, bordes suaves, navegación sobria y controles consistentes).

Después de levantar o actualizar Moodle, copiá y activá el tema con:

```bash
./scripts/moodle-apply-edutrack-theme.sh
```

En producción, desde la raíz del repo en el VPS:

```bash
git pull
docker compose -f docker-compose.moodle.yml --env-file .env.moodle up -d moodle
MOODLE_ENV_FILE=.env.moodle ./scripts/moodle-apply-edutrack-theme.sh
```

Ese script copia `moodle/theme/edutrack` al volumen persistente de Moodle, ejecuta el upgrade de
plugins, fija `theme=edutrack` y limpia cachés. Si sólo tocás SCSS/visual, alcanza con correrlo de
nuevo o, como mínimo:

```bash
docker exec -u daemon <contenedor-moodle> php /opt/bitnami/moodle/admin/cli/purge_caches.php
```
