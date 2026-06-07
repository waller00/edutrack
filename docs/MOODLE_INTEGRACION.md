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
| `Student` | Usuario *nologin*, rol *student* | `et-student-<id>` |

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
- **Estudiantes → curso**: de la matrícula activa (`StudentEnrollment` con estado `ACTIVE`), sobre el
  curso **legacy** por `CourseOffering`. Sólo si `moodleSyncStudents` está activo (los estudiantes no
  tienen cuenta de login en EduTrack y se crean usuarios espejo `nologin`). El modelo por
  asignatura/orientación para estudiantes queda como **fase posterior** (no resoluble de forma segura
  en esta iteración); la prioridad fue permisos docentes y suplencias.

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
2. Flags en `SystemSettings` (BD):
   - `moodleSyncEnabled` — habilita el worker (outbox + reconciliación). Default `false`.
   - `moodleReconcileIntervalMs` — intervalo de reconciliación completa. Default 900000 (15 min).
   - `moodleSyncStudents` — sincroniza también estudiantes. Default `false`.

El worker vive en [`backend/src/server.ts`](../backend/src/server.ts) (tick de 30 s, gateado por estos flags).

## Funciones de servicio web requeridas en Moodle

En el servicio externo (Administración > Servidor > Servicios web > Servicios externos), añadí:

```
core_user_get_users_by_field
core_user_create_users
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

El emparejamiento es por **email**, que EduTrack ya provisiona; así el docente entra a Moodle
con su cuenta de Keycloak sin gestionar credenciales aparte.

> Nota: el SSO es configuración de Moodle/Keycloak; EduTrack sólo provisiona el usuario y fija
> el método de auth. No hay forma de automatizarlo enteramente desde el backend.

## Tema visual EduTrack

El repo incluye un tema Moodle versionado en [`moodle/theme/edutrack`](../moodle/theme/edutrack).
Es un tema hijo de Boost: mantiene compatibilidad con Moodle 5 y aplica la estética de EduTrack
(verde esmeralda, tarjetas blancas, bordes suaves, navegación sobria y controles consistentes).

El `docker-compose.moodle.yml` monta el tema en el contenedor:

```yaml
./moodle/theme/edutrack:/bitnami/moodle/theme/edutrack
```

Después de levantar o actualizar Moodle, activalo con:

```bash
./scripts/moodle-apply-edutrack-theme.sh
```

En producción, desde la raíz del repo en el VPS:

```bash
git pull
docker compose -f docker-compose.moodle.yml --env-file .env.moodle up -d moodle
MOODLE_ENV_FILE=.env.moodle ./scripts/moodle-apply-edutrack-theme.sh
```

Ese script ejecuta el upgrade de plugins, fija `theme=edutrack` y limpia cachés. Si sólo tocás
SCSS/visual, alcanza con correrlo de nuevo o, como mínimo:

```bash
docker exec -u daemon <contenedor-moodle> php /opt/bitnami/moodle/admin/cli/purge_caches.php
```
