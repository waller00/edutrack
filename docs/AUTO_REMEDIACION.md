# Auto-remediación de contenedores

Este documento describe el watchdog que reinicia contenedores **stateless**
cuando quedan `unhealthy`, y por qué PostgreSQL y Keycloak quedan fuera.

## Qué se automatiza y qué no

| Servicio | Reinicio si el proceso muere | Reinicio si está unhealthy | Aviso |
|---|---|---|---|
| `web` | `restart: unless-stopped` | Watchdog | Sí |
| `auth` | `restart: unless-stopped` | Watchdog | Sí |
| `reverse-proxy` | `restart: unless-stopped` | Watchdog | Sí |
| `pg` | `restart: unless-stopped` | **No** | Sí (`pg_up`) |
| `keycloak` | `restart: unless-stopped` | **No** | Sí (`health/ready`) |
| `redis` | `restart: unless-stopped` | **No** | Pendiente (sin exporter) |

La diferencia importa:

- **Proceso muerto:** Docker lo levanta solo con `restart: unless-stopped`.
  Cubre crashes y reinicios del host.
- **Unhealthy:** el contenedor sigue corriendo pero no responde. Docker **no**
  lo reinicia. Ahí actúa el watchdog.

PostgreSQL y Keycloak no se reinician por healthcheck a propósito:

- `pg_isready` puede fallar de forma transitoria bajo carga. Reiniciar Postgres
  por un falso positivo es peor que esperar a una persona.
- Reiniciar Keycloak en horario de clases corta sesiones y logins en curso.
- Si el problema es disco lleno, corrupción o locks, reiniciar no lo arregla y
  puede agregar carga.

Para esos dos, el sistema **avisa** y la persona decide.

## Cómo funciona

```
systemd timer (30 s)
  └─ container-watchdog.sh
       ├─ docker inspect (health de web, auth, reverse-proxy)
       ├─ si unhealthy 3 veces seguidas: docker restart
       ├─ tope: 3 reinicios por servicio por hora
       ├─ cooldown: 5 minutos entre reinicios
       └─ escribe métricas en /var/lib/edutrack-watchdog/textfile
             └─ node-exporter (textfile collector)
                   └─ Prometheus → Grafana → Telegram
```

El watchdog corre en el host, no en un contenedor: no expone el socket de Docker
a ningún servicio nuevo.

## Instalación

Desde `/root/edutrack` en el servidor:

```bash
sudo ./deploy/systemd/install.sh
```

El instalador:

1. Copia `scripts/container-watchdog.sh` a `/usr/local/bin/`.
2. Instala `edutrack-container-watchdog.service` y `.timer`.
3. Crea `/etc/edutrack/watchdog.env` con **`WATCHDOG_DRY_RUN=1`**.
4. Crea `/var/lib/edutrack-watchdog/{state,textfile}`.
5. Habilita el timer y corre una vez.

Después hay que reiniciar el stack de monitoring para que node-exporter monte
el directorio de métricas:

```bash
docker compose --env-file .env.monitoring -f docker-compose.monitoring.yml up -d node-exporter prometheus grafana
```

## Puesta en marcha: primero en dry-run

El archivo `/etc/edutrack/watchdog.env` queda con:

```bash
WATCHDOG_DRY_RUN=1
```

En ese modo el watchdog **no reinicia nada**: solo registra lo que haría.

```bash
journalctl -u edutrack-container-watchdog -n 100 --no-pager
```

Buscar líneas `UNHEALTHY`, `DRY_RUN would_restart`, `NO_HEALTHCHECK` o
`COMPOSE_ERROR`. Cuando el comportamiento sea el esperado:

```bash
sudo sed -i 's/^WATCHDOG_DRY_RUN=1/WATCHDOG_DRY_RUN=0/' /etc/edutrack/watchdog.env
sudo systemctl restart edutrack-container-watchdog.timer
```

Verificar que las métricas llegan:

```promql
edutrack_container_restarts_total
edutrack_container_watchdog_cap_reached
edutrack_container_watchdog_last_run_timestamp_seconds
```

## Configuración

Todo se ajusta en `/etc/edutrack/watchdog.env`:

| Variable | Default | Para qué |
|---|---|---|
| `EDUTRACK_DIR` | `/root/edutrack` | Directorio del repo |
| `EDUTRACK_COMPOSE_FILES` | chain cloud | Archivos compose, en orden |
| `WATCHDOG_SERVICES` | `web auth reverse-proxy` | Allowlist; **no agregar `pg` ni `keycloak`** |
| `WATCHDOG_CONSECUTIVE` | `3` | Chequeos unhealthy seguidos antes de actuar |
| `WATCHDOG_MAX_RESTARTS` | `3` | Tope por ventana |
| `WATCHDOG_WINDOW_SECONDS` | `3600` | Ventana del tope |
| `WATCHDOG_COOLDOWN_SECONDS` | `300` | Espera entre reinicios |
| `WATCHDOG_DRY_RUN` | `1` en el ejemplo | `0` para actuar |

## Alertas

Grupo `edutrack-container-watchdog` en Grafana:

| Alerta | Cuándo | Severidad |
|---|---|---|
| `EduTrack container restarted repeatedly` | más de 3 reinicios del mismo servicio en 1 h | critical |
| `EduTrack watchdog gave up` | se alcanzó el tope y el servicio sigue unhealthy | critical |
| `EduTrack watchdog not reporting` | no hay corrida nueva hace más de 5 min | critical |

La tercera es la más importante para la operativa: si el watchdog muere, la
auto-remediación se apaga en silencio. Con `severity=critical` llega por la
política de Telegram ya existente.

También se agregaron:

- `EduTrack PostgreSQL down` (`pg_up == 0`).
- `EduTrack Keycloak not ready` (`http://keycloak:9000/health/ready`).

## Runbook

### Reinicios repetidos

1. No seguir reiniciando: poner `WATCHDOG_DRY_RUN=1` o quitar el servicio de
   `WATCHDOG_SERVICES`.
2. `journalctl -u edutrack-container-watchdog -n 100 --no-pager`
3. `docker compose -f docker-compose.cloud.yml logs --tail=200 <servicio>`
4. Corregir la causa y volver a habilitar.

### Tope alcanzado

El servicio lleva más de 3 reinicios en una hora y sigue unhealthy. La causa no
es transitoria. Revisar logs, disco (`df -h`), memoria (`free -m`) y
dependencias (`pg`, `redis`, `keycloak`) antes de reiniciar a mano.

### PostgreSQL o Keycloak unhealthy

No los reinicia el watchdog. Revisar:

```bash
docker compose -f docker-compose.cloud.yml logs --tail=100 pg
docker compose -f docker-compose.cloud.yml exec -T pg pg_isready -U postgres -d asistencias
docker compose -f docker-compose.cloud.yml logs --tail=100 keycloak
```

Si el disco está lleno, liberar espacio antes de reiniciar.

### Apagar la auto-remediación

```bash
sudo systemctl disable --now edutrack-container-watchdog.timer
```

El `restart: unless-stopped` de Docker sigue funcionando para procesos muertos.

## Por qué no se reinicia desde Telegram

Un bot que ejecute `docker restart` necesita acceso al socket de Docker, que es
equivalente a root en el host. Además:

- El token del bot y el chat serían una credencial de administración.
- Un falso positivo reiniciaría un servicio sano.
- Si el servidor está caído, el bot también: no sirve en el escenario que más
  importa.
- No hay aprobación, idempotencia ni auditoría confiable.

Para una acción manual remota se prefiere el workflow
[`deploy-recover.yml`](../.github/workflows/deploy-recover.yml), que queda
autenticado, con el environment `production` y registro en Actions.

## Limitaciones conocidas

- cAdvisor no entrega nombres de contenedores en este host: no se alerta por
  consumo por contenedor, solo por servicio mediante healthchecks y blackbox.
- Redis no tiene exporter: si cae, el login falla sin aviso específico.
- El watchdog solo mira healthchecks. Un servicio que responde 200 pero funciona
  mal no lo detecta; para eso están las métricas de negocio y los logs.
