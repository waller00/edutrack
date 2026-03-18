# Sistema de Gestión de Asistencias y anotaciones

Stack:
- Backend: Node 20, Express, Prisma (Postgres), JWT + Cookies HttpOnly, Argon2id, Passport Google OAuth.
- Frontend: Next.js (App Router, TS, Tailwind), pantalla de login y home protegida.
- Cloud-ready: Dockerfiles, compose, variables por entorno, sin dependencias locales fuera de Postgres.

## Roles y Autenticación
- Perfiles/Roles: ADMIN, DOCENTE, ESTUDIANTE, PADRE
- Autenticación y cuentas
  - Login: usuario/email+contraseña (Argon2), OAuth Google, refresh tokens.
  - Registro y verificación: alta con verificación por email.
  - Recupero de contraseña: enlace por email (con captcha).
  - Perfil básico: nombre, cédula, teléfono, fecha de nacimiento.
  - Control de acceso: guardas por rol, JWT en cookies httpOnly.

## Desarrollo rápido
```bash
# 1) Clonar y entrar al proyecto

# 2) Levantar todo con Docker Compose
docker compose -f docker-compose.cloud.yml up -d --build
```

## Variables
- Copiar `.env.example` a `.env` en backend, completar GOOGLE_*.
- Copiar `.env.local.example` a `.env.local` en frontend.

## Producción / Cloud
- Levantar servicios con `docker compose -f docker-compose.cloud.yml up -d --build`.
- Definir `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL` y Google OAuth callback según dominio HTTPS.
- Detrás de HTTPS habilitar `secure: true` en cookie (ver `src/routes/auth.ts`).

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
- El análisis toma como código fuente `backend/src` y `frontend/web/src`.
- Se excluyen artefactos generados como `dist`, `.next`, `node_modules` y definiciones `*.d.ts`.
- Si después agregás tests con cobertura, conviene completar `sonar.tests` y `sonar.javascript.lcov.reportPaths`.

## Estructura
```
backend/      # auth-service
frontend/web/ # Next.js
docker-compose.cloud.yml  # levanta backend + frontend + postgres
```
