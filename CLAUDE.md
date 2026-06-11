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
