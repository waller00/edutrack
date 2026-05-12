# Ciberseguridad y continuidad del negocio

## Objetivo

Este documento describe los controles de ciberseguridad y continuidad del negocio aplicables a EduTrack, una plataforma web para gestion institucional educativa. El objetivo es proteger la confidencialidad, integridad y disponibilidad de los datos, y definir como recuperar el servicio ante incidentes tecnicos, errores operativos o indisponibilidad de infraestructura.

EduTrack maneja informacion sensible: datos personales, cedula de identidad, asistencia, licencias medicas, roles institucionales, eventos academicos, auditoria y notificaciones. Por eso la estrategia combina controles preventivos, deteccion, respuesta y recuperacion.

## Alcance tecnico

La arquitectura actual del proyecto incluye:

- Frontend web en Next.js.
- Backend API en Node.js/Express.
- Base de datos PostgreSQL administrada por Prisma.
- Contenedores Docker mediante `docker-compose.yml` y `docker-compose.cloud.yml`.
- Despliegue cloud en un Droplet Ubuntu con Docker Compose.
- Integraciones externas: Google OAuth, SMTP/SendGrid, Didit, Web Push y APIs de IA opcionales.
- Scripts de exportacion, importacion y restauracion de base de datos.
- Analisis de seguridad en CI con Trivy.

## Principios de seguridad aplicados

### Confidencialidad

Los datos deben ser accesibles solo por usuarios autorizados. Para eso el sistema utiliza:

- Autenticacion con usuario/email y contrasena.
- Hash de contrasenas con Argon2id.
- Google OAuth como alternativa de autenticacion.
- Cookies HTTP-only para tokens, reduciendo exposicion ante XSS.
- Variables de entorno para secretos como `JWT_SECRET`, credenciales SMTP, Google OAuth, Didit, VAPID y claves de IA.
- Separacion de permisos por roles institucionales.
- Validacion de identidad durante el registro mediante Didit y/o OCR de cedula.

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
| Autenticacion | Login local y Google OAuth | Rutas `/auth`, Passport Google, JWT |
| Sesiones | Tokens en cookies HTTP-only | Backend Express |
| Contrasenas | Hash seguro | Argon2id |
| Autorizacion | Roles y permisos | `OrgRole`, `Permission`, `RolePermission` |
| Datos personales | Validacion de cedula e identidad | OCR/Tesseract y Didit |
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
| Acceso indebido | Alto | Roles, permisos, JWT, cookies | MFA para administradores |
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
- `docs/TESTING_DB_RESTORE.md`: documenta restauracion en entorno de pruebas.

### Politica recomendada

| Tipo de backup | Frecuencia | Retencion | Medio |
| --- | --- | --- | --- |
| Dump completo PostgreSQL | Diario | 7 a 14 dias | Almacenamiento externo al Droplet |
| Snapshot del Droplet/volumen | Semanal | 4 semanas | Proveedor cloud |
| Backup previo a despliegue | Antes de cada release | Hasta validar release | Archivo `.dump` fechado |
| Prueba de restore | Mensual | Evidencia documentada | Entorno de testing |

### Comando recomendado para backup en produccion

Desde el servidor, se recomienda generar dumps en formato custom:

```bash
mkdir -p /root/backups/edutrack
docker compose -f docker-compose.cloud.yml exec -T pg \
  pg_dump -U postgres -d asistencias -Fc --no-owner --no-privileges \
  > /root/backups/edutrack/asistencias-$(date +%Y%m%d-%H%M).dump
```

Luego el archivo debe copiarse fuera del servidor, por ejemplo a almacenamiento de objetos, otro servidor o repositorio de backups cifrado. No se recomienda guardar backups de produccion dentro del repositorio Git.

### Automatizacion con cron

Ejemplo de tarea diaria a las 02:00:

```cron
0 2 * * * cd /root/edutrack && docker compose -f docker-compose.cloud.yml exec -T pg pg_dump -U postgres -d asistencias -Fc --no-owner --no-privileges > /root/backups/edutrack/asistencias-$(date +\%Y\%m\%d-\%H\%M).dump
```

Recomendacion: agregar una segunda tarea que copie el dump a un destino externo y elimine backups locales antiguos.

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
- Rotar `JWT_SECRET`, credenciales SMTP, Didit, Google y VAPID ante sospecha de exposicion.
- Mantener `.env` fuera de Git.
- Activar backups automaticos del proveedor cloud.
- Monitorear uso de CPU, RAM, disco y disponibilidad HTTP.
- Configurar alertas ante disco bajo, caida de contenedores o error repetido en logs.
- Revisar resultados de Trivy en cada PR o despliegue.

## Evidencias utiles del proyecto

- `docker-compose.cloud.yml`: define servicios productivos `pg`, `auth` y `web`.
- `.github/workflows/ci-security.yml`: ejecuta escaneos Trivy de filesystem e imagenes Docker.
- `backend/prisma/schema.prisma`: define usuarios, roles, auditoria, sesiones, asistencias, biometria y licencias.
- `backend/src/app.ts`: configura CORS, Helmet, rutas protegidas e integraciones.
- `scripts/export_data_sql.sh`: exportacion de datos.
- `scripts/restore_pg_custom_dump_cloud.sh`: restauracion de dump PostgreSQL.
- `docs/TESTING_DB_RESTORE.md`: procedimiento de restore para pruebas.

## Roadmap de mejora

| Prioridad | Mejora | Beneficio |
| --- | --- | --- |
| Alta | Automatizar backups diarios fuera del Droplet | Reduce perdida de datos ante falla total |
| Alta | Probar restore mensualmente | Asegura que el RTO/RPO sean reales |
| Alta | Configurar monitoreo y alertas | Reduce tiempo de deteccion |
| Media | Agregar MFA para administradores | Reduce riesgo de acceso indebido |
| Media | Implementar rotacion formal de secretos | Mejora respuesta ante filtraciones |
| Media | Agregar Dependabot/Renovate | Mejora gestion de vulnerabilidades |
| Media | Documentar rollback de despliegue | Reduce tiempo de recuperacion |
| Baja | Replicacion PostgreSQL o WAL archiving | Permite bajar RPO a 1 hora o menos |

## Conclusion

EduTrack ya cuenta con una base solida de seguridad: autenticacion, autorizacion por roles, hashes seguros, cookies HTTP-only, auditoria, validacion de identidad, controles HTTP, escaneo de vulnerabilidades y scripts de respaldo/restauracion. Para completar la continuidad del negocio, la accion mas importante es automatizar backups externos, probar restauraciones y definir responsables ante incidentes.

Con la politica propuesta de RTO 2 horas y RPO 24 horas, el proyecto queda alineado con una etapa inicial de produccion. Para un uso institucional mas exigente, se recomienda evolucionar hacia monitoreo con alertas, backups incrementales, pruebas periodicas de disaster recovery y MFA para cuentas administrativas.
