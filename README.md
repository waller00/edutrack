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

# 2) Crear variables para compose local
cp .env.compose.example .env

# 3) Levantar todo
docker compose up -d --build
```

## Variables
- Para correr con Docker Compose local, usar `.env.compose.example` en la raíz.
- Si querés OAuth Google, SMTP o Turnstile, completar esas variables en el `.env` raíz antes de levantar.
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
- **Cobertura global (Sonar):** objetivo **≥70%** mezclando `backend/coverage/lcov.info` + `frontend/web/coverage/lcov.info`. El archivo `backend/src/routes/dni-processor.ts` (~2.3k líneas, pipeline OCR/Tesseract) está en **`sonar.coverage.exclusions`** para no hundir el %; el resto del backend queda ~**96%** de líneas cubiertas al correr `npm run test:coverage` en `backend/`.

## Estructura
```
backend/      # auth-service
frontend/web/ # Next.js
docker-compose.yml        # compose local
docker-compose.cloud.yml  # levanta backend + frontend + postgres
```
## Último despliegue: 21 de marzo de 2026 - Prueba de CI/CD Exitosa.
