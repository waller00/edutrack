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
| Cursos | `courses.ts` | Categorías y cursos con mapeo persistente `MoodleObjectMap`; usuario espejo de estudiantes. |
| Inscripciones | `enrolments.ts` | Matriculación manual (`enrol_manual_enrol_users`). |
| Outbox | `outbox.ts` | Cola persistente con reintentos + backoff (reemplaza el *fire-and-forget*). |
| Reconciliación | `reconcile.ts` | Estado deseado EduTrack→Moodle: cursos + inscripciones + reparación de *drift*. |

### Modelos de datos (Prisma)

- `User.moodleUserId` — id del usuario espejo (idempotencia y detección de *drift*).
- `MoodleSyncTask` — outbox: `type`, `dedupeKey`, `payload`, `status`, `attempts`, `runAfter`, `lastError`.
- `MoodleObjectMap` — mapeo `(objectType, localId) → moodleId` para categorías, cursos y estudiantes.

### Mapeo de entidades

| EduTrack | Moodle | `idnumber` |
|----------|--------|------------|
| `SchoolYear` | Categoría | `et-year-<id>` |
| `CourseOffering` | Curso | `et-offering-<id>` |
| `User` (docente) | Usuario, rol *editingteacher* | UUID del User |
| `Student` | Usuario *nologin*, rol *student* | `et-student-<id>` |

- **Profesores → curso**: se derivan de las clases asignadas (`Event.assignedUserId` + `courseOfferingId`).
- **Estudiantes → curso**: de la matrícula activa (`StudentEnrollment` con estado `ACTIVE`). Sólo si `moodleSyncStudents` está activo, porque los estudiantes no tienen cuenta de login en EduTrack y se crean usuarios espejo `nologin`.

## Fiabilidad (outbox)

Antes, las rutas hacían `void ensureMoodleUserById(id)`: si Moodle estaba caído, el fallo se
perdía y la desincronización era permanente. Ahora esa llamada **encola** un `MoodleSyncTask`
que el worker reintenta con backoff exponencial (1 min → … → 6 h) hasta `maxAttempts` (8).
La reconciliación periódica recupera cualquier divergencia que el outbox no cubra.

## Activación

1. Variables de entorno (ver `.env.compose.example`):
   `MOODLE_BASE_URL`, `MOODLE_WS_TOKEN`, opcionalmente `MOODLE_CANONICAL_HOST`,
   `MOODLE_ROLE_TEACHER_ID`, `MOODLE_ROLE_STUDENT_ID`, `MOODLE_ROOT_CATEGORY_ID`, `MOODLE_USER_AUTH`.
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
core_enrol_get_enrolled_users
```

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
