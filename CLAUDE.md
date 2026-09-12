# EduTrack — Guía para Claude

Plataforma web de gestión integral de instituciones educativas (asistencia, eventos, licencias, estructura académica, Moodle, biometría, reportes).

**Producción:** https://edutrack-uy.com/
**Local:** http://localhost:3000 (frontend) / http://localhost:4000 (API)

---

## Stack

| Capa | Tecnología |
|------|------------|
| Frontend | Next.js 14 App Router, TypeScript, Tailwind |
| Backend | Node 20, Express, Prisma ORM, PostgreSQL |
| Identidad | Keycloak (OIDC) + patrón BFF (sesiones en Redis) |
| Tests | Vitest (backend + frontend unit), Playwright (e2e) |
| CI | GitHub Actions (ci.yml, sonar.yml, deploy.yml) |
| Infra local | `docker-compose.yml` |
| Infra cloud | `docker-compose.cloud.yml` |

---

## Arranque local

```bash
cp .env.compose.example .env
docker compose up -d --build
```

El backend corre `prisma db push --skip-generate` automáticamente al arrancar (ver `backend/docker-entrypoint.sh`). **No hay `migrate deploy`**; el proyecto usa `db push` (sin tabla `_prisma_migrations`).

URLs locales:

| Servicio | URL |
|----------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:4000 |
| Keycloak | http://localhost:8089 |

---

## Estructura del repo

```
backend/                       # API Express + Prisma
  src/
    routes/                    # Endpoints Express (un archivo por dominio)
    services/                  # Lógica de negocio
    integrations/
      moodle/                  # Sincronización EduTrack→Moodle
      didit/                   # Prueba de vida (liveness)
      zkteco/                  # Biometría ZKTeco iclock
    auth/                      # Keycloak BFF, sesiones Redis
    db/                        # Prisma client singleton
  prisma/
    schema.prisma              # Fuente de verdad del esquema
    migrations/                # Solo documentación (no se ejecutan con migrate deploy)
frontend/web/                  # Next.js App Router
  src/app/                     # Pages y layouts (admin, staff, teacher, student, auth)
keycloak/                      # Realm JSON + tema login
docs/                          # Documentación técnica
scripts/                       # Backup, restore, seed, deploy helpers
```

---

## Comandos frecuentes

```bash
# Backend
cd backend
npm run dev              # servidor local con hot-reload
npm run test             # vitest (unit)
npm run test:coverage    # genera coverage/lcov.info
npm run typecheck        # tsc --noEmit (usa ./node_modules/.bin/tsc, no npx tsc)
npm run prisma:studio    # Prisma Studio en :5555

# Frontend
cd frontend/web
npm run dev
npm run test
npm run typecheck
npm run test:e2e         # Playwright

# Compose
docker compose logs -f auth web
docker compose down
docker compose up -d --build auth  # rebuild solo el backend
```

> **Importante:** usar `./node_modules/.bin/tsc --noEmit` en el backend, no `npx tsc` (npm puede resolver el paquete `tsc@2.0.4` obsoleto).

---

## Base de datos

- Motor: PostgreSQL 16
- ORM: Prisma con `db push` (no migrate)
- Esquema: `backend/prisma/schema.prisma`
- Modelos principales: `User`, `SchoolYear`, `Course`, `CourseOffering`, `CourseOrientation`, `Subject`, `SubjectCourseAssignment`, `Student`, `StudentEnrollment`, `Event`, `Substitution`, `Attendance`, `MedicalLeave`, `MoodleObjectMap`, `MoodleEnrolmentMap`, `MoodleSyncTask`, `BiometricDevice`, `BiometricPunch`, `SystemSettings`

> **Dos sistemas de asistencia distintos.** `Attendance` es del **personal** (`userId → User`, marcas biométricas). El pase de lista estudiantil vive en `StudentAttendanceSession` / `StudentAttendanceEntry` / `StudentAttendanceJustification`, con su propio enum `StudentAttendanceStatus`. No mezclarlos: una consulta sobre `Attendance.status` nunca debe contar alumnos.

> **Las notas viven en `GradeBook*`, no en Moodle.** EduTrack es la fuente de verdad de las calificaciones; Moodle se **importa** y nunca se pisa. Los valores se guardan en centésimos como `Int` (un 8 es `800`), igual que `amountCents` — nunca `Float` ni `Decimal`.

---

## Integración Moodle

Sincronización idempotente EduTrack→Moodle. Inactiva si faltan `MOODLE_BASE_URL` o `MOODLE_WS_TOKEN`.

Módulo: `backend/src/integrations/moodle/`

- `scope.ts` — resuelve curso Moodle por asignatura/orientación de un evento (idnumber estable)
- `courses.ts` — categorías y cursos (legacy por oferta y SUBJECT_COURSE por asignatura)
- `enrolments.ts` — matriculación manual con ventana temporal (`timestart`/`timeend`)
- `enrolment-map.ts` — tracking en `MoodleEnrolmentMap` para revocar con seguridad
- `reconcile.ts` — reconciliación completa: titulares + suplentes + revocación + estudiantes
- `client.ts` — HTTP + variables de entorno Moodle

Detalle completo: [docs/MOODLE_INTEGRACION.md](docs/MOODLE_INTEGRACION.md)

---

## Pase de lista estudiantil

El docente marca la asistencia de sus estudiantes por **ocurrencia de clase**, identificada por
`(eventId, día civil YYYY-MM-DD)` — nunca por el id compuesto `uuid_ymd` que produce la expansión
de recurrencia.

Módulo: `backend/src/services/student-attendance/`

- `roster.ts` — cohorte del evento; misma precedencia que `moodle/scope.ts` (`courseOrientationId` > `orientationId` > tronco común)
- `occurrence.ts` — valida que el día sea clase real; distingue *suspendida* de *inexistente*
- `edit-window.ts` — ventana de edición del docente (`SystemSettings.studentRollCallEditWindowHours`, default 48 h)
- `copy-previous.ts` — sugerencia de copiar la hora anterior del mismo grupo
- `pending.ts` — listas sin pasar (se calculan; no hay filas PENDING pre-creadas)
- `consolidation.ts` — faltas por día/asignatura, derivadas al leer
- `roll-call.ts` / `justify.ts` — escritura y transición ABSENT → ABSENT_JUSTIFIED

Rutas: `backend/src/routes/student-attendance.ts` (docente) y `admin-student-attendance.ts` (control).
Frontend: `/me/roll-call` y `/admin/student-attendance`.

> `occurrenceDate` **debe** calcularse con `uruguayWallToUtc(ymd, 0, 0)`, idéntico a lo que escribe
> `resolveSubstitutionOccurrence` en `Substitution.date`. Si difieren, el suplente recibe un 403
> silencioso. Nunca `new Date(ymd)`.

Detalle funcional: [docs/FUNCIONALIDADES.md](docs/FUNCIONALIDADES.md) §11 bis

---

## Libreta digital

Módulo propio bajo `/libreta` (no cuelga de Académico). Una libreta es
`(ciclo, oferta de curso, orientación opcional, asignatura)` — la misma clave que la integración
Moodle deriva de un evento, así que `GradeBook.scopeKey` y el curso Moodle `SUBJECT_COURSE` son la
misma cosa vista desde dos lados. Se generan solas a partir de los eventos de clase del horario: no
hay tabla de asignación docente.

Backend: `backend/src/services/gradebook/` (provisión, acceso, ventana de edición, calificación,
cierre de período, importación Moodle, visado, notificaciones, analítica, exportaciones) y las rutas
`gradebook.ts`, `admin-gradebook.ts`, `admin-academic-config.ts`, `admin-academic-analytics.ts`.

Frontend: `src/app/libreta/` con `LibretaShell` (marco tipo Libro del Profesor) y
`src/lib/libreta/` (menú de secciones y catálogo de distintivos).

> El semáforo académico **nunca** puede ser sólo color (RNF 7.2): siempre lleva texto o icono
> además. Los distintivos del alumno y el contador de faltas ya siguen esa regla.

> **`gradebook.grade` y `gradebook.plan` son permisos distintos a propósito.** El primero cubre
> evaluaciones, notas y juicios conceptuales; el segundo, planificación y desarrollo del curso.
> Dirección tiene `plan` con alcance `all` y **no** tiene `grade`: así puede corregir la libreta de
> un docente sin poder tocar una calificación. Con una sola llave esa mitad no se puede expresar.

> **La libreta del docente no promedia.** Es una decisión del liceo, no una omisión: la
> calificación general del período la decide el docente. El promedio vive en la matriz
> institucional (`transversalAverage`) y en la planilla de reunión, que es donde se usa para
> escolaridad y abanderados.

> **Las faltas se cuentan en centésimos y son globales.** `100` es una falta entera, `50` media.
> El peso lo fija adscripción al justificar, no se deriva del estado. Y el conteo es del ciclo en
> todo el liceo, no de la asignatura: filtrar por `subjectId` ahí es un bug, no una optimización.

> **Las adecuaciones guardan un enlace, nunca el informe.** Un informe psicológico de un menor es un
> documento clínico, y la política de privacidad lo prohíbe (§4 bis).

Detalle funcional: [docs/FUNCIONALIDADES.md](docs/FUNCIONALIDADES.md) §11 ter

---

## Tests

- Framework: **Vitest** (backend y frontend)
- Mocks: `vi.hoisted()` para mocks de módulos al tope del archivo
- Cobertura: `npm run test:coverage` → genera `coverage/lcov.info`
- E2E: Playwright en `frontend/web`

SonarCloud analiza `backend/src` + `frontend/web/src`. Quality Gate: cobertura nueva ≥ 80%, 0 issues Blocker/Critical en código nuevo. La complejidad cognitiva máxima por función es 15 (regla `typescript:S3776`).

---

## CI / CD

| Workflow | Cuándo corre | Qué hace |
|----------|-------------|----------|
| `ci.yml` | push/PR a main y develop | typecheck + tests backend y frontend |
| `sonar.yml` | push/PR a main y develop | análisis SonarCloud (requiere secret `SONAR_TOKEN`) |
| `deploy.yml` | push a main | deploy automático al VPS (SSH + docker compose pull + up) |
| `e2e.yml` | push/PR | tests Playwright |

El deploy de producción es **completamente automático**: al hacer push a `main`, el workflow levanta la imagen nueva y el entrypoint corre `prisma db push` al arrancar el contenedor.

---

## Variables de entorno

Plantilla: `.env.compose.example` en la raíz.

Variables Moodle relevantes:
- `MOODLE_BASE_URL`, `MOODLE_WS_TOKEN`, `MOODLE_CANONICAL_HOST`
- `MOODLE_ROLE_TEACHER_ID` (default 3), `MOODLE_ROLE_STUDENT_ID` (default 5)
- `MOODLE_ROLE_SUBSTITUTE_TEACHER_ID` (default = valor de TEACHER_ID)
- `MOODLE_ROOT_CATEGORY_ID` (default 0), `MOODLE_USER_AUTH` (default `manual`)

---

## Producción

- Dominio: https://edutrack-uy.com/
- Compose cloud: `docker-compose.cloud.yml`
- Moodle en servidor aparte: https://moodle.edutrack-uy.com (Bitnami, `docker-compose.moodle.yml`)
- Observabilidad: Sentry (backend + frontend), Grafana + Loki (`docker-compose.monitoring.yml`)
- Proxy: Cloudflare (SSL termination)
