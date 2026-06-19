# Backup off-site de PostgreSQL

Este runbook implementa el primer paso de recuperacion ante desastre para EduTrack: generar un backup diario de PostgreSQL en el Droplet principal y copiarlo a una VPS externa. En esta instalacion el destino inicial propuesto es la VPS de testing:

```text
138.197.35.2
```

La copia remota no reemplaza los snapshots del proveedor. Es una primera capa enfocada en proteger el dato critico: la base `asistencias`.

## Topologia

```text
Droplet produccion
  docker compose -> pg_dump -Fc -> /root/backups/edutrack/postgres
  scp/ssh      -> 138.197.35.2:/srv/edutrack-backups/production/postgres/daily
```

## 1. Preparar la VPS destino

En la VPS `138.197.35.2`, crear un usuario de backup y el directorio de destino:

```bash
sudo useradd --system --create-home --shell /bin/bash backup
sudo mkdir -p /srv/edutrack-backups/production/postgres/daily
sudo chown -R backup:backup /srv/edutrack-backups
sudo chmod -R 700 /srv/edutrack-backups
```

Si se prefiere operar inicialmente con `root`, el script tambien lo permite, pero para una practica mas prolija conviene usar el usuario `backup` sin permisos de sudo y con acceso limitado al directorio de backups.

## 2. Configurar acceso SSH desde produccion

En el Droplet de produccion, generar una llave dedicada si no existe una:

```bash
sudo mkdir -p /root/.ssh
sudo ssh-keygen -t ed25519 -f /root/.ssh/edutrack_backup_vps -C "edutrack-backup" -N ""
sudo cat /root/.ssh/edutrack_backup_vps.pub
```

Copiar la clave publica al usuario `backup` de la VPS destino. En la VPS `138.197.35.2`:

```bash
sudo install -d -m 700 -o backup -g backup /home/backup/.ssh
echo "PEGAR_AQUI_LA_CLAVE_PUBLICA_DEL_DROPLET" | sudo tee /home/backup/.ssh/authorized_keys >/dev/null
sudo chown backup:backup /home/backup/.ssh/authorized_keys
sudo chmod 600 /home/backup/.ssh/authorized_keys
```

Luego validar conectividad desde produccion:

```bash
ssh -i /root/.ssh/edutrack_backup_vps backup@138.197.35.2 "test -d /srv/edutrack-backups/production/postgres/daily && echo ok"
```

## 3. Ejecutar un backup manual

Desde la raiz del repo en el Droplet de produccion:

```bash
cd /root/edutrack
chmod +x scripts/dc-cloud.sh scripts/backup_pg_offsite.sh

BACKUP_REMOTE_HOST=138.197.35.2 \
BACKUP_REMOTE_USER=backup \
BACKUP_SSH_KEY=/root/.ssh/edutrack_backup_vps \
BACKUP_REMOTE_DIR=/srv/edutrack-backups/production/postgres/daily \
BACKUP_REMOTE_RETENTION_DAYS=30 \
BACKUP_LOCAL_RETENTION_DAYS=3 \
./scripts/backup_pg_offsite.sh
```

El script genera:

- Un `.dump` custom de PostgreSQL (`pg_dump -Fc`).
- Un archivo `.sha256` para verificar integridad.
- Una copia local temporal en `/root/backups/edutrack/postgres`.
- Una copia remota en la VPS destino.

## 4. Programar cron diario

Editar el cron de root en produccion:

```bash
sudo crontab -e
```

Agregar:

```cron
15 2 * * * cd /root/edutrack && BACKUP_REMOTE_HOST=138.197.35.2 BACKUP_REMOTE_USER=backup BACKUP_SSH_KEY=/root/.ssh/edutrack_backup_vps BACKUP_REMOTE_DIR=/srv/edutrack-backups/production/postgres/daily BACKUP_REMOTE_RETENTION_DAYS=30 BACKUP_LOCAL_RETENTION_DAYS=3 ./scripts/backup_pg_offsite.sh >> /var/log/edutrack-backup.log 2>&1
```

Con esta configuracion:

- El backup corre todos los dias a las 02:15 UTC del servidor.
- Se conservan 30 dias en la VPS destino.
- Se conservan 3 dias localmente en el Droplet de produccion.
- El resultado queda registrado en `/var/log/edutrack-backup.log`.

## 5. Verificar backups

En la VPS destino:

```bash
sudo ls -lh /srv/edutrack-backups/production/postgres/daily
```

Verificar checksum:

```bash
cd /srv/edutrack-backups/production/postgres/daily
sha256sum -c edutrack-postgres-asistencias-YYYYMMDD-HHMMSS.dump.sha256
```

## 6. Prueba mensual de restore

Una vez por mes, copiar un backup desde la VPS destino hacia el entorno de testing y ejecutar el restore existente:

```bash
scp backup@138.197.35.2:/srv/edutrack-backups/production/postgres/daily/edutrack-postgres-asistencias-YYYYMMDD-HHMMSS.dump /root/prod-asistencias.dump

cd /root/edutrack
./scripts/restore_pg_custom_dump_cloud.sh /root/prod-asistencias.dump
```

Despues de restaurar, validar:

```bash
./scripts/dc-cloud.sh ps
curl -f http://localhost:4000/health
```

Registrar fecha, backup usado, duracion aproximada del restore, errores encontrados y resultado final. Ese registro permite convertir los RTO/RPO teoricos en evidencia operativa real.

## 7. Consideraciones de seguridad

- No guardar backups en Git.
- No usar la misma llave SSH para deploy y backups.
- Restringir el usuario remoto a escritura en `/srv/edutrack-backups`.
- Mantener el puerto SSH de la VPS restringido por firewall si es posible.
- Los dumps pueden contener datos personales, asistencia, auditoria y otros datos sensibles.
- Si la VPS de testing tambien se usa para pruebas destructivas, separar bien las rutas de backups y evitar comandos `rm` globales.
