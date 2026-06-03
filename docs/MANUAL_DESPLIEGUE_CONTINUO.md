# Manual de Integración de Despliegue Continuo — EduTrack

**Proyecto:** EduTrack — Plataforma de gestión administrativa integral para instituciones educativas  
**Versión del manual:** 1.1 (alineado al repositorio, mayo 2026)  
**Responsable:** Equipo EduTrack

---

## 1. Introducción

Este manual describe cómo se implementa y opera el **despliegue continuo** de EduTrack en **testing** y **producción**, utilizando la infraestructura y herramientas actuales del repositorio `joaquinwaller/edutrack`.

El objetivo es que el despliegue sea **reproducible**, **automatizado** y **fácil de mantener**, reduciendo errores manuales y tiempos de entrega.

---

## 2. Objetivo

Establecer un flujo de despliegue continuo que permita:

- Integrar cambios de código desde GitHub.
- Validar calidad mínima antes de desplegar.
- Desplegar automáticamente en el servidor de **testing** (`develop`) y **producción** (`main`).
- Ejecutar la aplicación mediante contenedores Docker.
- Mantener una operación estable y recuperable ante fallos.

---

## 3. Alcance

Este manual cubre:

| Área | Herramienta / artefacto |
|------|-------------------------|
| Infraestructura (IaC) | Terraform (`terraform/main.tf`) — Droplet de **producción** |
| DNS / SSL | Cloudflare (producción) |
| CI/CD | GitHub Actions (`.github/workflows/`) |
| Orquestación | `docker-compose.cloud.yml` (+ `docker-compose.override.yml` en testing, en el servidor) |
| Biométrico (opcional) | ZKTeco F22 por ADMS — ver `docs/BIOMETRICO_F22.md` |
| Operación | Smoke tests, backups, rollback, troubleshooting |

**Fuera de alcance:** desarrollo local detallado (`docker-compose.yml`), Moodle (`docker-compose.moodle.yml`), agentes externos en el colegio.

---

## 4. Arquitectura de despliegue actual

```
[Desarrollador] → push develop/main → [GitHub Actions]
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
              workflow ci.yml          workflow deploy.yml        (otros: e2e, security)
              tests + build            typecheck → SSH deploy
                    │                         │
                    │              ┌──────────┴──────────┐
                    │              ▼                     ▼
                    │      Droplet TESTING        Droplet PRODUCCIÓN
                    │      (develop)              (main / Terraform)
                    │      138.197.35.2*          IP en SSH_HOST
                    │              │                     │
                    └──────────────┴─────────────────────┘
                                   Docker Compose
                          pg + redis + keycloak + auth + web
```

\* IP de ejemplo usada en el proyecto; debe coincidir con el secret `SSH_HOST_TESTING`.

### Componentes

| Componente | Descripción |
|------------|-------------|
| **Terraform** | Define un Droplet Ubuntu 22.04 en DigitalOcean (`edutrack-production`, región `nyc3`). Output `ip_del_servidor`. |
| **Testing** | Segundo Droplet, **no** creado por Terraform. IP en `SSH_HOST_TESTING`. Rama `develop`. |
| **Producción** | Droplet de Terraform (o equivalente). IP en `SSH_HOST`. Rama `main`. Cloudflare recomendado. |
| **Pipeline deploy** | `deploy.yml`: job `validate` (typecheck frontend) → deploy por SSH. |
| **Pipeline CI** | `ci.yml`: en cada push/PR — frontend y backend (typecheck, lint, tests, build). **No bloquea** el deploy si falla en otra rama, pero debe estar en verde antes de merge. |
| **Servicios** | `pg`, `redis`, `keycloak-db`, `keycloak`, `auth` (API), `web` (Next.js) |
| **ADMS biométrico** | Integrado en `auth`, puerto **4000** (`ZKTECO_ICLOCK_PORT=0`). Sin proceso aparte en nube. |

---

## 5. Requisitos previos

### Repositorio y ramas

- Repositorio: `https://github.com/joaquinwaller/edutrack`
- Ramas del pipeline de deploy: **`main`** (producción), **`develop`** (testing)

### En cada Droplet

- Ubuntu 22.04 (o compatible)
- Docker y Docker Compose (plugin `docker compose`)
- Proyecto en **`/root/edutrack`**
- Archivo **`.env`** en `/root/edutrack/.env` (no commitear)
- Red Docker externa **`edutrack_moodle-net`** (el workflow la crea si no existe; Moodle opcional)

### Secrets en GitHub Actions

Settings → Secrets and variables → Actions:

| Secret | Uso |
|--------|-----|
| `SSH_HOST` | IP o hostname del Droplet de **producción** |
| `SSH_USER` | Usuario SSH (ej. `root`) |
| `SSH_PRIVATE_KEY` | Clave privada SSH producción |
| `SSH_HOST_TESTING` | IP o hostname del Droplet de **testing** |
| `SSH_PRIVATE_KEY_TESTING` | Clave privada SSH testing |

El workflow usa `github.token` para `git fetch` vía HTTPS (`x-access-token`), sin PAT adicional en el servidor.

### Variables críticas en `.env` del servidor

Ejemplos (ajustar por entorno):

```env
# Base
DATABASE_URL=postgresql://postgres:...@pg:5432/asistencias?schema=public
REDIS_URL=redis://redis:6379
FRONTEND_URL=http://138.197.35.2.nip.io:3000
NEXT_PUBLIC_API_URL=http://138.197.35.2.nip.io:4000

# Keycloak (ajustar URLs públicas por entorno)
KEYCLOAK_ISSUER_URL=http://138.197.35.2.nip.io:8089/realms/edutrack
KEYCLOAK_INTERNAL_URL=http://keycloak:8080
KEYCLOAK_CLIENT_SECRET=...
KEYCLOAK_REDIRECT_URI=http://138.197.35.2.nip.io:4000/auth/callback

# Prisma al arrancar auth: en produccion dejar vacio (no usar --force-reset ni
# --accept-data-loss salvo migraciones puntuales en testing).
# PRISMA_DB_PUSH_FLAGS=

# ADMS ZKTeco en el mismo puerto que la API
ZKTECO_ICLOCK_PORT=0

# Cookies en testing (HTTP)
COOKIE_SECURE=false
COOKIE_SAMESITE=lax

# SMTP, Didit, Sentry, etc. según entorno
```

**Importante:** solo las variables listadas en `environment:` de `docker-compose.cloud.yml` entran al contenedor. Tras editar `.env`, recrear servicios:

`FRONTEND_URL`, `NEXT_PUBLIC_API_URL`, `KEYCLOAK_ISSUER_URL` y `KEYCLOAK_REDIRECT_URI` deben apuntar a URLs publicas completas. `KEYCLOAK_INTERNAL_URL` debe quedar en `http://keycloak:8080` para llamadas internas entre contenedores. No usar interpolaciones compuestas tipo `${PUBLIC_SCHEME}://${PUBLIC_HOST}` en Compose: en algunas versiones dejan llaves renderizadas (`%7D`) dentro del bundle del frontend.

Antes de bajar/reconstruir produccion, validar rutas:

```bash
bash scripts/validate-production-routes.sh --env .env --production
docker compose -f docker-compose.cloud.yml config | grep -E 'FRONTEND_URL|NEXT_PUBLIC_API_URL|KEYCLOAK_ISSUER_URL|KEYCLOAK_REDIRECT_URI'
```

La validacion falla si detecta `localhost`, `keycloak:8080`, `{`, `}`, `%7D`, HTTP en produccion, o un callback que no use el origen publico de la API. El workflow de produccion la ejecuta antes de `compose down`.

```bash
docker compose -f docker-compose.cloud.yml -f docker-compose.override.yml up -d --force-recreate auth web
```

---

## 6. Aprovisionamiento de infraestructura (Terraform)

### 6.1 Componentes (`terraform/main.tf`)

- Proveedor `digitalocean`
- Recurso `digitalocean_droplet` (`edutrack_vm` / nombre `edutrack-production`)
- `user_data`: instala `docker.io` y `docker-compose`
- Output `ip_del_servidor`: IPv4 pública de **producción**

### 6.2 Beneficios

- Trazabilidad de cambios de infraestructura
- Reproducibilidad del entorno de producción
- Menor configuración manual repetitiva

### 6.3 Testing

El entorno de **testing** es un Droplet **aparte**, aprovisionado manualmente o por otro proceso; su IP se configura solo en `SSH_HOST_TESTING`.

---

## 7. Configuración de despliegue continuo (GitHub Actions)

### 7.1 Workflows relevantes

| Workflow | Disparador | Rol |
|----------|------------|-----|
| **`deploy.yml`** | Push a `main` / `develop`; `workflow_dispatch` | Validación + deploy SSH |
| **`ci.yml`** | Push y PR (todas las ramas) | Calidad: typecheck, lint, tests, build (frontend + backend) |
| `e2e.yml` | Programado / manual | Playwright |
| `docker-publish.yml` | Tags | Imágenes GHCR (opcional) |
| `ci-security.yml` | Push | Trivy |

El job de deploy **solo exige** que pase `validate` en `deploy.yml` (typecheck del frontend). En la práctica, el equipo debe mantener **`ci.yml` en verde** antes de merge a `develop` o `main`.

### 7.2 Flujo del pipeline `deploy.yml`

#### Job `validate`

- `working-directory: frontend/web`
- `npm install` + `npm run typecheck`
- Si falla → **no** se ejecutan `deploy-testing` ni `deploy-production`

#### Job `deploy-testing` (rama `develop`)

- Condición: `github.ref == refs/heads/develop`
- Acción: `appleboy/ssh-action@v1.2.0` (reintentos, timeout 40 min)
- Secretos: `SSH_HOST_TESTING`, `SSH_USER`, `SSH_PRIVATE_KEY_TESTING`

**En el servidor (comportamiento actual):**

1. `cd /root/edutrack` — clone o `git fetch` + `git reset --hard origin/develop`
2. Compose: `-f docker-compose.cloud.yml -f docker-compose.override.yml`
3. Crear red `edutrack_moodle-net` si no existe
4. **`compose build auth`** y **`compose build web`** (sin `down` ni `rmi` en el flujo automático)
5. **`compose up -d --no-build`**

> **Nota:** El manual v1.0 describía `compose down`, `docker rmi` y `build --no-cache` en testing; eso **ya no aplica** al deploy automático de `develop` (se optimizó para menos downtime). **Producción** (`main`) sí hace `down`, `rmi` y `build --no-cache web`.

#### Job `deploy-production` (rama `main`)

- Secretos: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`
- `git reset --hard origin/main`
- Solo `docker-compose.cloud.yml`
- Secuencia: `down` → `rmi edutrack-web edutrack-auth` → `build --no-cache web` → `build auth` → `up -d --no-build`

#### Despliegue manual (`workflow_dispatch`)

En GitHub → Actions → **Deploy EduTrack to DigitalOcean** → Run workflow:

| Campo | Valor |
|-------|--------|
| `target_env` | `testing` o `production` |
| `git_ref` | `develop`, `main`, tag o SHA |

Jobs: `deploy-testing-manual` / `deploy-production-manual` (misma lógica SSH que los jobs automáticos de cada entorno).

### 7.3 Comportamiento en el servidor (resumen)

| Paso | Testing (`develop`) | Producción (`main`) |
|------|---------------------|---------------------|
| Código | `/root/edutrack`, `origin/develop` | `origin/main` |
| Compose | `cloud.yml` + `override.yml` | solo `cloud.yml` |
| Parada total | No (automático) | Sí (`down`) |
| Rebuild front | `build web` | `build --no-cache web` |
| Arranque | `up -d --no-build` | `up -d --no-build` |

---

## 8. Orquestación de servicios (Docker Compose)

Archivo base: **`docker-compose.cloud.yml`**

### 8.1 Base de datos (`pg`)

- Imagen PostgreSQL 16
- Volumen persistente `pgdata`
- Healthcheck antes de levantar `auth`

### 8.2 Redis (`redis`)

- Imagen Redis 7 (persistencia AOF).
- Sesiones BFF del backend (`REDIS_URL` obligatorio para login).

### 8.3 Keycloak (`keycloak` + `keycloak-db`)

- Realm import: `keycloak/realm-edutrack.json`.
- Tema login: `keycloak/themes/edutrack/`.
- Google IdP y TOTP se configuran en Keycloak.
- En cloud, exponer URL pública alineada con `KEYCLOAK_ISSUER_URL`.

### 8.4 Backend (`auth`)

- Build: `./backend`
- Comando de arranque: `npx prisma db push ${PRISMA_DB_PUSH_FLAGS}` + `npm start`
- Puerto **4000** expuesto
- Incluye: API REST, OIDC BFF, webhooks, **protocolo ADMS ZKTeco** (`/iclock/*`, alias `/cdata`, `/getrequest`)
- Variables: DB, Redis, Keycloak, cookies, `ZKTECO_ICLOCK_PORT`, etc.

### 8.5 Frontend (`web`)

- Build: `./frontend/web` con `NEXT_PUBLIC_API_URL` en **build time**
- Puerto **3000**
- Tras cambiar `NEXT_PUBLIC_*` en `.env` → **rebuild** de `web`

### 8.6 Biométrico ZKTeco F22 (ADMS)

- **Sin** contenedor ni ngrok adicional en nube
- El reloj hace push HTTP al API público (puerto 4000)
- Registro del dispositivo: `backend/prisma/seed-biometric-adms.mjs`
- Vinculación docente: **Mi perfil** → **Vincular mi huella** (API `/biometric/link-requests`)
- Documentación operativa: **`docs/BIOMETRICO_F22.md`**

Configuración típica del F22 (testing HTTP):

| Campo | Valor ejemplo |
|--------|----------------|
| Server Mode | ADMS |
| Enable Domain Name | ON |
| Server Address | `138.197.35.2` (IP sola; puerto **4000** aparte si el menú lo tiene) |
| HTTPS | OFF |

---

## 9. Proceso operativo de despliegue

### 9.1 Procedimiento estándar

1. **Desarrollo local** — `docker compose up` y pruebas funcionales.
2. **Sincronización** — `git pull origin develop` antes de pushear.
3. **Pre-validación local**
   - `cd frontend/web && npm run typecheck`
   - `cd backend && npm run typecheck && npm test`
4. **Push a `develop`** — dispara `validate` + deploy testing.
5. **Verificación en testing** — smoke tests (sección 9.2).
6. **Merge a `main`** — tras validar; dispara deploy producción.

### 9.2 Smoke test (testing y producción)

| # | Comprobación | Comando / acción |
|---|--------------|------------------|
| 1 | Contenedores Up | `docker compose -f docker-compose.cloud.yml ps` (+ `-f docker-compose.override.yml` en testing) |
| 2 | API viva | `curl -s http://127.0.0.1:4000/health` → `{"ok":true}` |
| 3 | UI carga | Abrir URL del front; pantalla de login sin 500 |
| 4 | API desde navegador | F12 → Red: peticiones al API no fallan por CORS/red |
| 5 | Login | Redirige a Keycloak; tras login `/auth/me` → no 401 |
| 6 | (Opcional) ADMS | `curl "http://<API>:4000/iclock/getrequest?SN=<serial>"` → `OK` |
| 7 | (Opcional) Biométrico | Fichada en F22 → visible en Asistencias |

### 9.3 Aplicar cambios solo en `.env` (sin nuevo deploy)

```bash
cd /root/edutrack
docker compose -f docker-compose.cloud.yml -f docker-compose.override.yml up -d --force-recreate auth
# Si cambió NEXT_PUBLIC_*:
docker compose -f docker-compose.cloud.yml -f docker-compose.override.yml up -d --build web
```

---

## 10. Mantenimiento y monitoreo

### 10.1 Controles recomendados

- Logs: `docker compose ... logs -f auth web`
- Recursos del Droplet: CPU, RAM, disco (~80% alerta)
- GitHub Actions: jobs en rojo
- Cloudflare: DNS y SSL (producción)

### 10.2 Backups

- `pg_dump` programado del volumen `pgdata`
- Snapshot del Droplet antes de cambios críticos
- Probar restauración periódicamente (`docs/TESTING_DB_RESTORE.md`)

---

## 11. Recuperación y rollback

1. Identificar commit estable (`git log` en servidor o en GitHub).
2. **Manual:** Actions → Deploy → `workflow_dispatch` → `git_ref` = SHA o tag estable.
3. O en servidor: `git reset --hard <sha>` + `compose build` + `up -d`.
4. Validar smoke tests.
5. Corregir causa raíz en `develop` antes de volver a mergear a `main`.

---

## 12. Troubleshooting

| Síntoma | Causa probable | Acción |
|---------|----------------|--------|
| Pipeline SSH falla | Secrets, firewall 22, droplet caído | Revisar Actions; reiniciar droplet |
| `auth` Exited (1) al deploy | `prisma db push` pide flags por cambio de schema | Solo en **testing**: `PRISMA_DB_PUSH_FLAGS=--accept-data-loss` temporal + recreate `auth`. En produccion no usar flags destructivos. |
| Timeout deploy: Web ok, API ok=0 | `db push` bloqueado creando índices en tablas grandes | Rebuild `auth` (entrypoint: schema rápido + `db:optimize` en background). Ver `docker logs edutrack-auth-1`. |
| Login OK pero sin sesión (testing) | Redis caído, cookies HTTPS en HTTP | Verificar `redis` Up; `COOKIE_SECURE=false`, URLs alineadas |
| Front no ve API | `NEXT_PUBLIC_API_URL` viejo | Rebuild `web` |
| F22 no conecta ADMS | Puerto 80 vs 4000, URL mal parseada | IP `138.197.35.2`, puerto **4000**, HTTPS OFF |
| Vincular huella no aparece | Sin dispositivos en BD | Ejecutar `seed-biometric-adms.mjs` |
| Deploy testing muy lento | Normal tras muchos builds | Monitorear disco Docker (`docker system df`) |

---

## 13. Buenas prácticas de seguridad

- No commitear `.env`, `KEYCLOAK_CLIENT_SECRET` ni secretos de dispositivos biométricos.
- Usar GitHub Secrets para SSH.
- Rotar claves periódicamente.
- Mínimo privilegio en SSH y en Cloudflare.
- Auditar `AuditLog` en la aplicación para cambios sensibles.

---

## 14. Conclusión

EduTrack implementa un esquema de **despliegue continuo** con:

- Infraestructura reproducible (Terraform para producción),
- **Dos entornos** (testing / producción) ligados a ramas Git,
- Validación automática previa al deploy,
- Servicios contenerizados y **integración biométrica ADMS** en el mismo backend.

Con backups, smoke tests y el troubleshooting de este manual, la plataforma puede operarse de forma estable y recuperable.

---

## Anexo A — Diferencias respecto al manual v1.0 (PDF entregable)

| Tema | Manual v1.0 | Implementación actual (v1.1) |
|------|-------------|------------------------------|
| SSH action testing | `v0.1.10` | **`v1.2.0`** con reintentos |
| Deploy testing | `down`, `rmi`, `build --no-cache` | **`build` + `up`** sin `down`/`rmi` |
| Deploy producción | Igual que arriba | Sin cambios (`down`, `no-cache web`) |
| CI vs deploy | Solo citaba otros workflows | **`ci.yml`** obligatorio en práctica (tests backend + frontend) |
| Biométrico F22 | No documentado | **ADMS en puerto 4000**, vinculación en Mi perfil |
| `.env` / Prisma | Genérico | **`PRISMA_DB_PUSH_FLAGS`**, recreate contenedores |
| Deploy manual | Mención breve | **`workflow_dispatch`** documentado |

---

## Anexo B — Referencias en el repositorio

- `docs/README.md` — Índice de documentación
- `/.github/workflows/deploy.yml` — Deploy
- `/.github/workflows/ci.yml` — Integración continua
- `/docker-compose.cloud.yml` — Servicios nube
- `/docs/BIOMETRICO_F22.md` — Reloj biométrico
- `/docs/CIBERSEGURIDAD_CONTINUIDAD.md` — Seguridad y continuidad
- `/terraform/main.tf` — Infraestructura producción
