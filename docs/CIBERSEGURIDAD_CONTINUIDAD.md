# Ciberseguridad y continuidad del negocio

## Objetivo

Este documento describe los controles de ciberseguridad y continuidad del negocio aplicables a EduTrack, una plataforma web para gestion institucional educativa. El objetivo es proteger la confidencialidad, integridad y disponibilidad de los datos, y definir como recuperar el servicio ante incidentes tecnicos, errores operativos o indisponibilidad de infraestructura.

EduTrack maneja informacion sensible: datos personales, cedula de identidad, asistencia, constancia administrativa de licencias medicas, roles institucionales, eventos academicos, auditoria y notificaciones. Por eso la estrategia combina controles preventivos, deteccion, respuesta y recuperacion. El modulo de licencias no debe almacenar certificados medicos, diagnosticos ni datos del profesional de salud.

## Alcance tecnico

La arquitectura actual incluye:

- Frontend web en Next.js.
- Backend API en Node.js/Express (patrón BFF para autenticación).
- Keycloak como proveedor de identidad (OIDC).
- Redis para sesiones server-side del BFF.
- Base de datos PostgreSQL administrada por Prisma.
- Contenedores Docker mediante `docker-compose.yml` y `docker-compose.cloud.yml`.
- Despliegue cloud en Droplet Ubuntu con Docker Compose.
- Integraciones externas: Google (vía Keycloak), SMTP/SendGrid, Didit, Web Push y APIs de IA opcionales.
- Scripts de exportación, importación y restauración de base de datos.
- Análisis de seguridad en CI con Trivy.

## Principios de seguridad aplicados

### Confidencialidad

Los datos deben ser accesibles solo por usuarios autorizados. Controles:

- Autenticación OIDC vía Keycloak (usuario/contraseña, Google, TOTP en el IdP).
- Patrón BFF: tokens OIDC en Redis; cookie HttpOnly `sid` en el navegador.
- Contraseñas gestionadas en Keycloak (no en Postgres).
- Variables de entorno para secretos (`KEYCLOAK_CLIENT_SECRET`, SMTP, Didit, VAPID, etc.).
- Permisos granulares por `orgRole` en Postgres.
- Verificación de identidad en registro mediante Didit (documento y prueba de vida).

### Integridad

La informacion debe mantenerse correcta y trazable. Controles relevantes:

- Modelo de datos centralizado en PostgreSQL.
- Validaciones de negocio en backend.
- Auditoria de acciones criticas mediante `AuditLog`.
- Restricciones de base de datos, indices y claves unicas.
- Verificacion de firma HMAC en webhooks de Didit.
- Procesamiento controlado de marcaciones biometricas para evitar duplicados.
- Tests automatizados en backend y frontend.

### Disponibilidad

El sistema debe mantenerse operativo y recuperable. Controles existentes:

- Contenedores independientes para frontend, backend y PostgreSQL.
- Healthcheck en PostgreSQL.
- Persistencia de datos mediante volumen Docker `pgdata`.
- Scripts de respaldo y restauracion.
- Infraestructura reproducible parcialmente mediante Terraform.
- CI/CD para automatizar validaciones y despliegues.

## Controles implementados en el proyecto

| Area | Control | Implementacion actual |
| --- | --- | --- |
| Autenticacion | OIDC Keycloak + BFF | `routes/auth-keycloak.ts`, tema `edutrack` |
| Sesiones | Cookie `sid` + Redis | `session-store.ts`, `middlewares/auth.ts` |
| Contrasenas | IdP Keycloak | Admin API + portal de cuenta |
| Autorizacion | Roles y permisos | `OrgRole`, `Permission`, `RolePermission` |
| Datos personales | Validacion de cedula e identidad | Didit |
| Auditoria | Registro de acciones criticas | Modelo `AuditLog` |
| Notificaciones | In-app, email y web push | PostgreSQL, SMTP/SendGrid, VAPID |
| Seguridad HTTP | Headers y CORS | Helmet, CORS configurable |
| Dependencias | Escaneo de vulnerabilidades | GitHub Actions + Trivy |
| Backups | Exportacion/importacion de DB | Scripts en `scripts/` |
| Recuperacion | Restore de dump PostgreSQL | `restore_pg_custom_dump_cloud.sh` |

## Riesgos principales

| Riesgo | Impacto | Mitigacion actual | Mejora recomendada |
| --- | --- | --- | --- |
| Perdida de base de datos | Muy alto | Volumen persistente y scripts de restore | Backups automaticos diarios y prueba mensual de restauracion |
| Exposicion de secretos | Alto | Variables de entorno | Rotacion periodica y gestor de secretos |
| Caida del Droplet | Alto | Infraestructura documentada con Terraform | Snapshots, backups externos y plan de redeploy |
| Vulnerabilidades en dependencias | Medio/alto | Trivy en CI | Dependabot/Renovate y politicas de actualizacion |
| Acceso indebido | Alto | Roles, permisos, sesion BFF | TOTP en Keycloak para administradores |
| Error humano en despliegue | Medio | Docker Compose y scripts | Runbook de despliegue y rollback |
| Webhook falso de identidad | Alto | Validacion HMAC Didit | Monitoreo de errores y alertas |
| Indisponibilidad de email/push | Medio | Canales separados | Cola de reintentos y fallback operativo |

## Continuidad del negocio

La continuidad del negocio busca que EduTrack pueda seguir operando o recuperarse en tiempos definidos. Para esto se definen dos indicadores:

- RTO (Recovery Time Objective): tiempo maximo tolerable para restaurar el servicio luego de una interrupcion.
- RPO (Recovery Point Objective): maxima perdida de datos tolerable medida en tiempo.

### Objetivos propuestos

| Componente | Criticidad | RTO propuesto | RPO propuesto | Justificacion |
| --- | --- | --- | --- | --- |
| Base de datos PostgreSQL | Critica | 2 horas | 24 horas | Contiene usuarios, asistencias, licencias, eventos y auditoria |
| Backend API | Critica | 1 hora | No aplica | Puede reconstruirse desde imagen/codigo; no almacena estado persistente propio |
| Frontend web | Alta | 1 hora | No aplica | Puede reconstruirse desde codigo o imagen Docker |
| Notificaciones email/push | Media | 4 horas | 24 horas | La perdida no impide operar, pero afecta avisos |
| Integraciones externas Didit/Google/IA | Media | 8 horas | Segun proveedor | Dependen de terceros; debe existir modo degradado |
| Reportes/exportaciones | Media | 8 horas | 24 horas | Son importantes para gestion, pero no bloquean el uso principal |

Para un proyecto academico o primera etapa productiva, un objetivo razonable es:

- RTO general: 2 horas.
- RPO general: 24 horas.

En una etapa de mayor madurez institucional se recomienda bajar el RPO a 1 hora para PostgreSQL mediante backups incrementales o WAL archiving.

## Estrategia de backup

### Estado actual

El proyecto ya incluye scripts utiles:

- `scripts/export_data_sql.sh`: exporta la base a `data.sql`.
- `scripts/import_data_sql_on_server.sh`: importa un SQL plano en servidor.
- `scripts/restore_pg_custom_dump_cloud.sh`: restaura un dump custom de PostgreSQL.
- `scripts/backup_pg_offsite.sh`: genera un dump custom y lo copia a una VPS externa por SSH.
- `docs/BACKUP_POSTGRES_OFFSITE.md`: documenta el backup off-site diario hacia la VPS `138.197.35.2`.
- `docs/TESTING_DB_RESTORE.md`: documenta restauracion en entorno de pruebas.

### Politica recomendada

| Tipo de backup | Frecuencia | Retencion | Medio |
| --- | --- | --- | --- |
| Dump completo PostgreSQL | Diario | 7 a 14 dias | Almacenamiento externo al Droplet |
| Snapshot del Droplet/volumen | Semanal | 4 semanas | Proveedor cloud |
| Backup previo a despliegue | Antes de cada release | Hasta validar release | Archivo `.dump` fechado |
| Prueba de restore | Mensual | Evidencia documentada | Entorno de testing |

### Backup off-site automatizable

El primer paso operativo de continuidad es ejecutar `scripts/backup_pg_offsite.sh` desde el Droplet de produccion. El destino inicial definido para el proyecto es la VPS de testing `138.197.35.2`, usando una ruta remota separada para backups productivos:

```bash
cd /root/edutrack
BACKUP_REMOTE_HOST=138.197.35.2 \
BACKUP_REMOTE_USER=backup \
BACKUP_SSH_KEY=/root/.ssh/edutrack_backup_vps \
BACKUP_REMOTE_DIR=/var/backups/backups/backup-prod \
BACKUP_REMOTE_RETENTION_DAYS=30 \
BACKUP_LOCAL_RETENTION_DAYS=3 \
./scripts/backup_pg_offsite.sh
```

El script genera un `.dump` en formato custom (`pg_dump -Fc`), crea un checksum `.sha256`, copia ambos archivos por SSH/scp y aplica retencion local/remota. No se recomienda guardar backups de produccion dentro del repositorio Git.

### Automatizacion con cron

Ejemplo de tarea diaria a las 02:00:

```cron
15 2 * * * cd /root/edutrack && BACKUP_REMOTE_HOST=138.197.35.2 BACKUP_REMOTE_USER=backup BACKUP_SSH_KEY=/root/.ssh/edutrack_backup_vps BACKUP_REMOTE_DIR=/var/backups/backups/backup-prod BACKUP_REMOTE_RETENTION_DAYS=30 BACKUP_LOCAL_RETENTION_DAYS=3 ./scripts/backup_pg_offsite.sh >> /var/log/edutrack-backup.log 2>&1
```

El detalle completo de instalacion, validacion y prueba mensual de restore esta en `docs/BACKUP_POSTGRES_OFFSITE.md`.

## Procedimiento de recuperacion

### Escenario 1: caida de frontend o backend

1. Ingresar al servidor.
2. Verificar estado de contenedores:

```bash
docker compose -f docker-compose.cloud.yml ps
```

3. Revisar logs:

```bash
docker compose -f docker-compose.cloud.yml logs --tail=200 auth web
```

4. Reiniciar servicios afectados:

```bash
docker compose -f docker-compose.cloud.yml up -d web auth
```

5. Validar disponibilidad:

```bash
curl -f http://localhost:4000/health
```

RTO esperado: menor a 1 hora.

### Escenario 2: corrupcion o perdida logica de datos

1. Identificar el ultimo backup valido.
2. Detener backend y frontend para evitar escrituras:

```bash
./scripts/dc-cloud.sh stop web auth
```

3. Restaurar dump:

```bash
./scripts/restore_pg_custom_dump_cloud.sh /ruta/al/backup.dump
```

4. Validar aplicacion y logs.
5. Registrar el incidente, causa probable, backup utilizado y datos potencialmente perdidos.

RTO esperado: hasta 2 horas.
RPO esperado: hasta 24 horas con backups diarios.

### Escenario 3: perdida total del servidor

1. Crear nuevo Droplet con Terraform o provisionamiento manual.
2. Instalar Docker y Docker Compose plugin.
3. Clonar el repositorio.
4. Configurar `.env` productivo con secretos vigentes.
5. Copiar el ultimo backup externo al servidor.
6. Levantar PostgreSQL.
7. Restaurar backup.
8. Levantar backend y frontend.
9. Actualizar DNS o proxy si cambio la IP.
10. Validar login, dashboard, asistencia, reportes y notificaciones.

RTO esperado: 2 a 4 horas si el backup externo y secretos estan disponibles.

## Modo degradado

Si una integracion externa falla, EduTrack deberia mantener el mayor nivel de operacion posible:

- Si Didit no esta disponible: permitir registro solo si la politica institucional lo autoriza, o dejar altas pendientes de aprobacion manual.
- Si SMTP/SendGrid falla: mantener notificaciones in-app y registrar error de envio.
- Si Web Push falla: no bloquear operaciones principales.
- Si IA externa falla: desactivar temporalmente el asistente de consultas y conservar reportes tradicionales.
- Si la terminal biometrica falla: permitir carga administrativa de asistencia con auditoria.

## Gestion de incidentes

### Clasificacion

| Severidad | Ejemplo | Tiempo de respuesta sugerido |
| --- | --- | --- |
| Critica | Base inaccesible, fuga de datos, login caido | Inmediato |
| Alta | Backend caido, perdida parcial de datos, error masivo de autenticacion | Menor a 1 hora |
| Media | Notificaciones caidas, reportes fallando | Menor a 4 horas |
| Baja | Error visual o consulta puntual | Menor a 24/48 horas |

### Pasos de respuesta

1. Detectar y confirmar el incidente.
2. Contener el impacto: detener servicios, revocar secretos o bloquear accesos si corresponde.
3. Preservar evidencia: logs, fecha/hora, usuario afectado, IP, accion.
4. Recuperar servicio segun runbook.
5. Verificar integridad de datos.
6. Documentar causa raiz y acciones correctivas.
7. Comunicar a responsables institucionales si hay datos personales afectados.

## Seguridad operativa recomendada

Para produccion se recomienda:

- Usar HTTPS mediante Cloudflare o reverse proxy.
- No exponer PostgreSQL publicamente.
- Restringir SSH por clave publica y deshabilitar login por contrasena.
- Mantener firewall con puertos minimos: 80/443 y SSH restringido.
- Rotar `KEYCLOAK_CLIENT_SECRET`, credenciales SMTP, Didit y VAPID ante sospecha de exposicion.
- Mantener `.env` fuera de Git.
- Activar backups automaticos del proveedor cloud.
- Monitorear uso de CPU, RAM, disco y disponibilidad HTTP.
- Configurar alertas ante disco bajo, caida de contenedores o error repetido en logs.
- Revisar resultados de Trivy en cada PR o despliegue.

## Evidencias utiles del proyecto

- `docker-compose.cloud.yml`: servicios `pg`, `redis`, `keycloak-db`, `keycloak`, `auth`, `web`.
- `.github/workflows/ci-security.yml`: ejecuta escaneos Trivy de filesystem e imagenes Docker.
- `backend/prisma/schema.prisma`: define usuarios, roles, auditoria, sesiones, asistencias, biometria y licencias.
- `backend/src/app.ts`: configura CORS, Helmet, rutas protegidas e integraciones.
- `scripts/export_data_sql.sh`: exportacion de datos.
- `scripts/backup_pg_offsite.sh`: backup off-site de PostgreSQL hacia VPS externa.
- `scripts/restore_pg_custom_dump_cloud.sh`: restauracion de dump PostgreSQL.
- `docs/BACKUP_POSTGRES_OFFSITE.md`: procedimiento de backup off-site.
- `docs/TESTING_DB_RESTORE.md`: procedimiento de restore para pruebas.

## Roadmap de mejora

| Prioridad | Mejora | Beneficio |
| --- | --- | --- |
| Alta | Ejecutar y monitorear `backup_pg_offsite.sh` diariamente | Reduce perdida de datos ante falla total |
| Alta | Probar restore mensualmente | Asegura que el RTO/RPO sean reales |
| Alta | Configurar monitoreo y alertas | Reduce tiempo de deteccion |
| Media | TOTP en Keycloak para administradores | Reduce riesgo de acceso indebido |
| Media | Implementar rotacion formal de secretos | Mejora respuesta ante filtraciones |
| Media | Agregar Dependabot/Renovate | Mejora gestion de vulnerabilidades |
| Media | Documentar rollback de despliegue | Reduce tiempo de recuperacion |
| Baja | Replicacion PostgreSQL o WAL archiving | Permite bajar RPO a 1 hora o menos |

## Conclusion

EduTrack cuenta con autenticación OIDC (Keycloak), sesiones BFF en Redis, autorización por roles, auditoría, validación de identidad, controles HTTP, escaneo de vulnerabilidades y scripts de respaldo/restauración. Para completar la continuidad del negocio, la accion mas importante es automatizar backups externos, probar restauraciones y definir responsables ante incidentes.

Con la politica propuesta de RTO 2 horas y RPO 24 horas, el proyecto queda alineado con una etapa inicial de produccion. Para un uso institucional mas exigente, se recomienda evolucionar hacia monitoreo con alertas, backups incrementales, pruebas periodicas de disaster recovery y MFA para cuentas administrativas.
