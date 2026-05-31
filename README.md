# Sistema de Gestión integral de instituciones educativas

Stack:
- Backend: Node 20, Express, Prisma (Postgres), JWT + Cookies HttpOnly, Argon2id, Passport Google OAuth.
- Frontend: Next.js (App Router, TS, Tailwind), pantalla de login y home protegida.
- Cloud-ready: Dockerfiles, compose, variables por entorno, sin dependencias locales fuera de Postgres.

## Roles y Autenticación
- Perfiles/Roles: ADMIN, DOCENTE, ESTUDIANTE, PADRE
- Autenticación y cuentas (Keycloak + BFF)
  - Login/logout OIDC vía Keycloak (Google y OTP en el IdP).
  - Registro en la app (Didit) + verificación de email; contraseña en Keycloak.
  - Recupero de contraseña: flujo de Keycloak (o email desde admin).
  - Perfil básico en Postgres; permisos por `orgRole`.

## Desarrollo rápido
```bash
# 1) Clonar y entrar al proyecto

# 2) Crear variables para compose local
cp .env.compose.example .env

# 3) Levantar todo
docker compose up -d --build
```

## Variables
- Para correr con Docker Compose local, usar `.env.compose.example` en la raíz.
- Si querés OAuth Google, SMTP o Turnstile, completar esas variables en el `.env` raíz antes de levantar.
- Para 2FA/TOTP opcional, definir `TWO_FACTOR_ENCRYPTION_KEY` con un secreto largo y estable; si no se define, el backend usa `JWT_SECRET` como respaldo para cifrar los secretos de autenticador.
- Los archivos `backend/.env` y `frontend/web/.env.local` ya no son necesarios para el arranque con Compose.

## Docker Compose local
- Archivo principal: `docker-compose.yml`
- Servicios: `pg`, `auth`, `web`
- URLs locales:
  - Frontend: `http://localhost:3000`
  - Backend: `http://localhost:4000`
- El backend ejecuta `prisma db push` al arrancar, así que crea/actualiza el esquema automáticamente contra Postgres.
- En Compose local se usa `PRISMA_DB_PUSH_FLAGS=--accept-data-loss` para absorber cambios destructivos de esquema en bases de desarrollo ya creadas.

Comandos útiles:
```bash
docker compose up -d --build
docker compose logs -f auth web
docker compose down
```

## Producción / Cloud
- Levantar servicios con `docker compose -f docker-compose.cloud.yml up -d --build`.
- Definir `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL` y Google OAuth callback según dominio HTTPS.
- Detrás de HTTPS habilitar `secure: true` en cookie (ver `src/routes/auth.ts`).

## Ciberseguridad y continuidad
- Ver **[docs/CIBERSEGURIDAD_CONTINUIDAD.md](docs/CIBERSEGURIDAD_CONTINUIDAD.md)** para controles de seguridad, riesgos, RTO/RPO, backups, restore y procedimientos de continuidad del negocio.

## Mover datos local -> producción
- `data.sql` queda ignorado por Git a propósito. No debe viajar en commits ni quedar en el historial.
- Para exportar tu base local:
```bash
./scripts/export_data_sql.sh
```
- Eso genera `data.sql` en la raíz del proyecto.
- Para copiarlo al servidor:
```bash
REMOTE_HOST=TU_IP ./scripts/push_data_sql_to_server.sh
```
- Para importarlo ya en el servidor:
```bash
cd /root/edutrack
./scripts/import_data_sql_on_server.sh
```
- Después de importar, levantá o reiniciá backend/frontend según necesites.

### Copia de prod a testing (dump `.dump` + Docker)

Si en el Droplet ves `KeyError: 'ContainerConfig'` con `docker-compose` o `No such service: authcd`, leé **[docs/TESTING_DB_RESTORE.md](docs/TESTING_DB_RESTORE.md)**. Resumen: instalá `docker-compose-plugin`, no uses `docker-compose` (guión); en el servidor `./scripts/restore_pg_custom_dump_cloud.sh /ruta/al.dump` o `./scripts/dc-cloud.sh up -d` en lugar de `docker-compose -f docker-compose.cloud.yml …`.

## SonarQube
Este repo quedó preparado para análisis estático con SonarQube sobre:
- `backend/src`
- `frontend/web/src`

Archivos agregados:
- `sonar-project.properties`
- `docker-compose.sonarqube.yml`

Levantar SonarQube local:
```bash
docker compose -f docker-compose.sonarqube.yml up -d
```

Entrar a la UI:
```bash
http://localhost:9000
```

Credenciales iniciales por defecto:
```bash
admin / admin
```

Luego genera un token en SonarQube y ejecuta el análisis desde la raíz del proyecto:
```bash
docker run --rm \
  --network host \
  -e SONAR_HOST_URL=http://localhost:9000 \
  -e SONAR_TOKEN=TU_TOKEN \
  -v "$(pwd):/usr/src" \
  sonarsource/sonar-scanner-cli
```

Notas:
- El análisis toma como código fuente `backend/src` y `frontend/web/src`; tests y LCOV ya están enlazados en `sonar-project.properties`.
- Se excluyen artefactos generados como `dist`, `.next`, `node_modules` y definiciones `*.d.ts`.
- **Cobertura global (Sonar):** objetivo **≥70%** mezclando `backend/coverage/lcov.info` + `frontend/web/coverage/lcov.info` (ver umbrales en `backend/vitest.config.ts` y el workflow de CI).

### Sonar en GitHub Actions
El workflow `.github/workflows/sonar.yml` genera la cobertura de backend y frontend y ejecuta el scanner, fallando el pipeline si el Quality Gate no pasa.

Secrets a cargar en GitHub (Settings → Secrets and variables → Actions):
- `SONAR_TOKEN`: token de proyecto (SonarCloud o tu SonarQube).
- `SONAR_HOST_URL`: URL del servidor (ej. `https://sonarcloud.io` o tu instancia).

Si `SONAR_TOKEN` no está cargado, el job se omite (no rompe el resto del CI). Para SonarCloud, agregá también `sonar.organization` en `sonar-project.properties`.

## Observabilidad (Sentry / LogRocket)
- **Sentry** (errores + performance) en backend (`@sentry/node`, ver `backend/src/instrument.ts`) y frontend (`@sentry/nextjs`). Se activa solo si hay DSN.
  - Recomendado en **testing y producción** (se distinguen por `SENTRY_ENVIRONMENT`; `tracesSampleRate` más bajo en prod).
  - Variables: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_SENTRY_DSN`. Opcional source maps: `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`.
- **LogRocket** (session replay del frontend, `src/components/observability/Observability.tsx`).
  - Recomendado **solo en producción** (en testing son sesiones sintéticas y gastan cuota). Enmascara inputs por privacidad (datos de menores).
  - Variable: `NEXT_PUBLIC_LOGROCKET_APP_ID` (forzar fuera de prod con `NEXT_PUBLIC_LOGROCKET_FORCE=true`).

## Redis
- Servicio `redis` en ambos compose. Cliente en `backend/src/db/redis.ts` (`REDIS_URL`).
- Usos: rate limiting de login (`backend/src/middlewares/rate-limit.ts`) y **sesiones server-side del BFF** (`backend/src/auth/session-store.ts`).
- Degrada con elegancia: si `REDIS_URL` no está, el rate limit es no-op (pero el modo Keycloak requiere Redis).

## Keycloak (autenticación, patrón BFF)
Keycloak es el único IdP. Patrón **BFF**: el backend hace OIDC (Authorization Code + PKCE), guarda los tokens en una **sesión server-side en Redis** (`REDIS_URL` obligatorio) y entrega al navegador solo una cookie opaca `sid`. La autorización (permisos por `orgRole`) sigue en Postgres.

Componentes:
- `keycloak` + `keycloak-db` en los compose; realm import en `keycloak/realm-edutrack.json` (roles `ADMIN/STAFF/TEACHER`, client `edutrack-web`, Google IdP, OTP).
- Backend: `backend/src/auth/keycloak.ts`, `backend/src/routes/auth-keycloak.ts` (`/auth/login`, `/auth/callback`, `/auth/logout`, `/auth/refresh`), provisioning en `backend/src/auth/keycloak-provisioning.ts`.

Puesta en marcha (testing primero):
1. Droplet ≥ 4GB (`terraform/main.tf` o panel DigitalOcean).
2. Rotar `KEYCLOAK_CLIENT_SECRET` y cargar Google en el IdP (`REEMPLAZAR_GOOGLE_*` en el realm); redirect URI de Keycloak en Google Cloud Console.
3. URLs públicas: `KEYCLOAK_ISSUER_URL`, `KEYCLOAK_REDIRECT_URI` (alcanzables por navegador y contenedor `auth`).
4. `docker compose up -d --build` y validar login/logout/registro.

## Estructura
Ver el mapa completo en **[docs/ESTRUCTURA_PROYECTO.md](docs/ESTRUCTURA_PROYECTO.md)**.

```
backend/      # auth-service
frontend/web/ # Next.js
docker-compose.yml        # compose local
docker-compose.cloud.yml  # levanta backend + frontend + postgres
```
## Último despliegue: 21 de marzo de 2026 - Prueba de CI/CD Exitosa.
