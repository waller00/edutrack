# EduTrack — Gestión integral de instituciones educativas

Plataforma web para administración de personal educativo: asistencia, eventos, licencias, estructura académica, reportes y analítica.

**Documentación completa:** [docs/README.md](docs/README.md)

## Stack

| Capa | Tecnología |
|------|------------|
| Frontend | Next.js (App Router), TypeScript, Tailwind |
| Backend | Node 20, Express, Prisma, PostgreSQL |
| Identidad | Keycloak (OIDC) + patrón **BFF** (sesiones en Redis) |
| Infra | Docker Compose (local y cloud) |

## Roles

Roles organizacionales en Postgres (`orgRole`): **ADMIN**, **TEACHER**, **STAFF**, **STUDENT** (sin panel operativo por defecto). Los permisos finos son `módulo.acción` con alcance `own` o `all`.

Los estudiantes del liceo se gestionan en matrícula administrativa; no requieren cuenta de login.

Las cuotas se gestionan en **Académico → Mensualidades** (`/admin/tuition`), con el
permiso `students.manage` de alcance `all`. El módulo tiene su propio selector de año
y mes, resumen de cobros, filtros por curso/estudiante/estado y una cuenta anual por
estudiante. Cada cuota se guarda por separado, conservando el historial existente;
editar la ficha de Estudiantes ya no modifica mensualidades. Los importes se muestran
en UYU y los meses sin registrar se distinguen de las cuotas pendientes.

## Autenticación (Keycloak + BFF)

1. El frontend redirige a `GET /auth/login` (backend).
2. El backend inicia OIDC (Authorization Code + PKCE) contra Keycloak.
3. Tras el callback, los tokens OIDC quedan en **Redis**; el navegador recibe solo la cookie HttpOnly `sid`.
4. Google OAuth y 2FA (TOTP) se configuran en **Keycloak**, no en la app.
5. Registro, verificación de email y perfil siguen en rutas `/auth/*` del backend; las contraseñas viven en Keycloak.

Componentes: `keycloak/`, `backend/src/auth/keycloak.ts`, `backend/src/routes/auth-keycloak.ts`, `backend/src/auth/session-store.ts`.

## Desarrollo local

```bash
cp .env.compose.example .env
docker compose up -d --build
```

URLs:

| Servicio | URL |
|----------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:4000 |
| Keycloak | http://localhost:8089 |

### Servicios Docker (`docker-compose.yml`)

`pg`, `redis`, `keycloak-db`, `keycloak`, `auth`, `web`

El backend ejecuta `prisma db push` al arrancar. En local se usa `PRISMA_DB_PUSH_FLAGS=--accept-data-loss` para absorber cambios destructivos de esquema en bases de desarrollo.

```bash
docker compose logs -f auth web keycloak
docker compose down
```

## Variables de entorno

Plantilla: `.env.compose.example` en la raíz. Con Compose **no** hacen falta `backend/.env` ni `frontend/web/.env.local`.

Críticas para auth:

- `REDIS_URL` — obligatorio para sesiones BFF
- `KEYCLOAK_ISSUER_URL`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_REDIRECT_URI`
- `FRONTEND_URL`, `NEXT_PUBLIC_API_URL`

Opcionales: SMTP, Turnstile, Didit, Sentry, LogRocket, Moodle. Ver `.env.compose.example`.

## Producción / cloud

```bash
./scripts/dc-cloud.sh up -d --build
```

Detalle operativo: [docs/MANUAL_DESPLIEGUE_CONTINUO.md](docs/MANUAL_DESPLIEGUE_CONTINUO.md)

Al arrancar en Docker, el backend ejecuta `db:optimize`. La migración
`20260907120000_retire_query_assistant` elimina los permisos del módulo retirado
y su rol de base de datos, conservando la auditoría histórica. Si el rol tiene
dependencias ajenas al módulo, queda deshabilitado para evitar borrar esos objetos.

El wrapper cloud levanta el reverse proxy publico en `80/443` y mantiene privados
`web`, `auth` y `keycloak`; evita exponer directo `3000`, `4000` y `8089`.
Tras HTTPS: `COOKIE_SECURE=true` y URLs alineadas entre frontend, backend y Keycloak.

## Datos entre entornos

- `data.sql` está en `.gitignore`; no commitear dumps.
- Export local: `./scripts/export_data_sql.sh`
- Copiar al servidor: `REMOTE_HOST=TU_IP ./scripts/push_data_sql_to_server.sh`
- Restaurar dump custom: [docs/TESTING_DB_RESTORE.md](docs/TESTING_DB_RESTORE.md)

## SonarQube

```bash
docker compose -f docker-compose.sonarqube.yml up -d
# UI: http://localhost:9000 (admin / admin)
```

Analiza `backend/src` y `frontend/web/src`. CI: `.github/workflows/sonar.yml` (objetivo cobertura global ≥ 70%).

## Moodle

Sincronización idempotente y resiliente del dominio académico hacia Moodle (usuarios, cursos,
inscripciones) vía servicios web REST. Outbox con reintentos + reconciliación periódica; se
activa con `MOODLE_BASE_URL` + `MOODLE_WS_TOKEN` y los flags `moodle*` de `SystemSettings`.

Detalle: [docs/MOODLE_INTEGRACION.md](docs/MOODLE_INTEGRACION.md)

## Observabilidad

- **Sentry:** backend (`backend/src/instrument.ts`) y frontend — activo si hay DSN.
- **LogRocket:** replay del frontend — recomendado solo en producción.

## Estructura del repo

```
backend/                  # API Express
frontend/web/             # Next.js
keycloak/                 # Realm + tema login
docker-compose.yml        # local
docker-compose.cloud.yml  # cloud
docs/                     # documentación
scripts/                  # backup, restore, deploy helpers
```

Mapa de código: [docs/ESTRUCTURA_PROYECTO.md](docs/ESTRUCTURA_PROYECTO.md)
