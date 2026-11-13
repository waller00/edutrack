# Backup de EduTrack con restic y Cloudflare R2

Este es el backup operativo desde el 10/11/2026. Reemplaza al backup diario de solo PostgreSQL hacia testing.

## Alcance

Se respalda:

- base `asistencias` (PostgreSQL);
- base `keycloak` (PostgreSQL);
- base de Moodle (MariaDB);
- `moodledata`;
- `.env` y `.env.monitoring`;
- configuración de nginx, `monitoring/`, compose y certificados de origen de Cloudflare.

No se respaldan imágenes Docker, build cache, Prometheus, Grafana ni Loki.

## Destinos

### Principal: Cloudflare R2

- Repositorio restic cifrado.
- Bucket: `backup-edutrack`.
- Endpoint: `https://c1f5e0939e83a94618128b561cf8e102.us.r2.cloudflarestorage.com`.
- Retención: 15 snapshots diarios.
- Cifrado: restic.
- El repositorio no se publica y las credenciales S3 viven fuera del repositorio.

### Segunda copia: testing por SFTP

- Repositorio restic independiente.
- Ruta: `/var/backups/backups/restic-edutrack`.
- Acceso: usuario `backup` por SFTP; no se instala restic en testing.
- Contraseña restic propia: `/root/.restic-testing-password`.
- Retención: 15 snapshots diarios.
- Solo almacena blobs cifrados; no hay dumps planos.
- Si testing se cae, el backup principal en R2 sigue disponible.

## Programación

Cron de root:

```cron
0 3 * * * cd /root/edutrack && ./scripts/backup_all_restic.sh >> /var/log/edutrack-backup.log 2>&1
17 * * * * /root/edutrack/scripts/check_backup_status.sh >> /var/log/edutrack-backup.log 2>&1
30 4 * * 0 /root/edutrack/scripts/check_restic_integrity.sh >/dev/null 2>&1
```

El backup corre a las **03:00 locales** (06:00 UTC). Primero escribe en R2 y después replica el snapshot al repositorio SFTP de testing. Si testing falla, el backup de R2 no se considera fallido; se emite `TESTING_BACKUP_FAILED`. El chequeo de estado corre cada hora y avisa si el último éxito tiene más de 30 horas. La verificación de integridad corre los domingos a las 04:30 y lee el 5% de los data packs.

## Archivos y secretos

- Script: `scripts/backup_all_restic.sh`.
- Variables restic/R2: `/root/.restic-r2.env` (600 root).
- Contraseña restic: `/root/.restic-password` (600 root).
- Estado: `/var/lib/edutrack/backup-status.json`.
- Log: `/var/log/edutrack-backup.log`, rotado diariamente y comprimido, 30 días.

La contraseña de restic **debe guardarse fuera del servidor**. Sin ella no se puede restaurar el repositorio.

## Restauración

Listar snapshots:

```bash
set -a; . /root/.restic-r2.env; set +a
restic snapshots
```

Restaurar el último snapshot a un directorio temporal:

```bash
restic restore latest --target /tmp/restore-edutrack
```

Validar los dumps:

```bash
cd /tmp/restore-edutrack/var/backups/edutrack/restic-staging/<run_id>
sha256sum -c SHA256SUMS
```

Restaurar PostgreSQL a una base temporal:

```bash
docker exec -i edutrack-pg-1 pg_restore -U postgres -d <db_temporal> --no-owner --no-privileges < asistencias.dump
```

Restaurar Keycloak:

```bash
docker exec -i edutrack-keycloak-db-1 pg_restore -U keycloak -d <db_temporal> --no-owner --no-privileges < keycloak.dump
```

Restaurar Moodle:

```bash
zcat moodle.sql.gz | docker exec -i edutrack-moodle-db-1 sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb -uroot <db_temporal>'
```

No restaurar sobre las bases de producción sin ventana de mantenimiento y backup previo.

## Monitoreo

Wazuh lee `/var/log/edutrack-backup.log` mediante el agente de producción.

Reglas:

- `100700` — backup completado (nivel 3).
- `100701` — fallo general del backup (nivel 12).
- `100702` — `BACKUP_STALE` (nivel 12).
- `100703` — `R2_USAGE_HIGH` cuando el repositorio supera 8 GB (nivel 12).
- `100704` — `RESTIC_CHECK_OK` (nivel 3).
- `100705` — `RESTIC_CHECK_FAILED` (nivel 12).
- `100706` — `TESTING_BACKUP_OK` (nivel 3).
- `100707` — `TESTING_BACKUP_FAILED` (nivel 10).

El chequeo horario escribe `BACKUP_STALE` una vez por día si el último éxito supera las 30 horas. El backup escribe `R2_USAGE_HIGH` si `restic stats --mode raw-data` supera 8 GB.

## Pendientes

- Dead man's switch externo: **suspendido por decisión operativa**. El manager Wazuh no está 24/7.
- Alerta de uso de R2: implementada a nivel de Wazuh/restic (8 GB).
- Agente Wazuh en testing: **instalado y activo**. Testing está en Tailscale (`100.98.120.16`); el agente monitorea FIM de configuración y disco (chequeo cada 15 minutos). El backup de testing es un repositorio restic cifrado, no archivos planos.
- Verificación semanal `restic check --read-data-subset=5%`: implementada los domingos 04:30 sobre R2.
- Segunda copia restic en testing: implementada por SFTP. Falta su propia verificación periódica.
- Prueba de restore mensual documentada: pendiente.
- Rotar las credenciales S3 que se compartieron por chat y revocar el token de Cloudflare usado solo para la creación inicial.
- Backups viejos de PostgreSQL en testing y locales: eliminados.
