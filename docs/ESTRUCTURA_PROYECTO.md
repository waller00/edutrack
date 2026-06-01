# Estructura del proyecto

Mapa de dónde buscar cada tipo de código. Imports del frontend: `@/lib/api/client`, `@/components/auth/RoleGuard`, etc.

## Backend (`backend/src`)

| Carpeta / archivo | Contenido |
|-------------------|-----------|
| `app.ts`, `server.ts` | Entrada Express, montaje de rutas |
| `__tests__/` | Tests de integración (`/health`, etc.) |
| `routes/` | Endpoints HTTP por área |
| `middlewares/` | `authGuard`, rate limit, permisos |
| `services/` | Casos de uso e integraciones |
| `config/` | Zona horaria, ajustes de sistema |
| `db/` | Prisma, Redis |
| `auth/` | Keycloak OIDC, sesiones BFF, política de contraseña, validaciones de perfil |
| `identity/` | CI uruguaya, `orgRole`, permisos |
| `attendance/` | Reglas puras de asistencia |
| `events/` | Consultas y expansión de eventos |
| `medical-leaves/` | Validaciones de licencias |
| `notifications/` | Email y canales |
| `integrations/didit/` | Prueba de vida en registro |

### Auth (detalle)

| Archivo | Rol |
|---------|-----|
| `routes/auth-keycloak.ts` | Login, callback, logout, refresh, cuenta Keycloak |
| `routes/auth.ts` | Registro, verificación email, `/auth/me`, perfil |
| `auth/keycloak.ts` | Cliente OIDC + Admin API Keycloak |
| `auth/keycloak-provisioning.ts` | Alta/sync usuario Postgres ↔ Keycloak |
| `auth/session-store.ts` | Sesiones BFF en Redis (cookie `sid`) |
| `middlewares/auth.ts` | `authGuard` lee cookie `sid` → sesión Redis |

Tests unitarios junto al dominio (`auth/password-policy.test.ts`, `attendance/attendance-logic.test.ts`, …).

## Frontend (`frontend/web/src`)

| Carpeta | Contenido |
|---------|-----------|
| `app/` | Rutas Next.js (App Router) |
| `components/admin/` | Paneles de administración |
| `components/auth/` | `RoleGuard`, permisos |
| `components/common/` | Controles reutilizables |
| `components/forms/` | Campos de formulario |
| `components/home/` | Dashboard inicial |
| `components/navigation/` | Menú global (`UserNav`) |
| `components/notifications/` | UI de notificaciones |
| `components/personal/` | Mis asistencias, eventos, licencias |
| `components/observability/` | Sentry, LogRocket |
| `contexts/` | Providers React |
| `test/` | Setup de tests |
| `lib/api/` | Cliente HTTP |
| `lib/auth/` | URLs de login/logout, registro, onboarding |
| `lib/admin/`, `lib/attendance/`, … | Helpers por módulo |

## Keycloak (`keycloak/`)

| Archivo | Rol |
|---------|-----|
| `realm-edutrack.json` | Realm importado (client `edutrack-web`, roles, Google IdP) |
| `themes/edutrack/` | Tema de login personalizado |

## Infra y scripts

| Ruta | Rol |
|------|-----|
| `docker-compose.yml` | Local: pg, redis, keycloak, auth, web |
| `docker-compose.cloud.yml` | Cloud/testing/producción |
| `scripts/` | Backup, restore, helpers compose |
| `.github/workflows/` | CI, deploy, Sonar, E2E, Trivy |
