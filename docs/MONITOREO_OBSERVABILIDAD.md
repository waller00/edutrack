# Monitoreo y observabilidad EduTrack

Stack de observabilidad para EduTrack con Grafana, Prometheus, Loki, Grafana
Alloy, Node Exporter, cAdvisor, Postgres Exporter y Blackbox Exporter.

La integración vive en archivos nuevos y no modifica el comportamiento de
`auth`, `web`, `pg` ni el flujo de despliegue actual.

## Componentes

- Grafana: dashboards y exploración de métricas/logs.
- Prometheus: recolección de métricas y reglas de alerta.
- Loki: almacenamiento y consulta de logs.
- Alloy: recolección de logs de contenedores Docker hacia Loki.
- Node Exporter: métricas del host.
- cAdvisor: métricas de contenedores.
- Postgres Exporter: métricas de PostgreSQL.
- Blackbox Exporter: disponibilidad HTTP de backend y frontend.

## Seguridad

Por defecto solo Grafana se publica en el host:

```text
127.0.0.1:3001 -> grafana:3000
```

Prometheus, Loki y exporters no exponen puertos al host. No publiques estos
servicios directamente en internet. Para acceso remoto a Grafana en un servidor,
usá túnel SSH:

```bash
ssh -L 3001:127.0.0.1:3001 usuario@IP_DEL_SERVIDOR
```

Luego abrí:

```text
http://127.0.0.1:3001
```

La contraseña de Grafana es obligatoria mediante `GRAFANA_ADMIN_PASSWORD`.
No la guardes en Git.

## Variables

Copiá el ejemplo dedicado:

```bash
cp .env.monitoring.example .env.monitoring
```

Completá:

```env
GRAFANA_ADMIN_PASSWORD=
POSTGRES_EXPORTER_DATA_SOURCE_NAME=
```

`POSTGRES_EXPORTER_DATA_SOURCE_NAME` debe ser una URI PostgreSQL local con el
usuario, la password URL-encoded, el host Docker `pg`, el puerto `5432`, la base
`asistencias` y `sslmode=disable`. Usá los mismos valores de tu `.env`, pero no
commitees esa URI.

No commitees `.env.monitoring`.

## Redes

El compose de monitoreo se conecta a la red Docker de EduTrack mediante una red
externa llamada `edutrack-app` dentro del archivo de monitoring.

Valores esperados:

```text
Local docker-compose.yml:        EDUTRACK_APP_NETWORK=edutrack_appnet
Cloud docker-compose.cloud.yml:  EDUTRACK_APP_NETWORK=edutrack_net
```

En local, si la red Moodle externa no existe, creala antes de levantar EduTrack:

```bash
docker network inspect edutrack_moodle-net >/dev/null 2>&1 || docker network create edutrack_moodle-net
```

## Arranque local

Primero levantá EduTrack:

```bash
docker compose up -d --build
```

Después levantá observabilidad:

```bash
docker compose --env-file .env.monitoring -f docker-compose.monitoring.yml up -d
```

URLs:

```text
Frontend: http://localhost:3000
Backend health: http://localhost:4000/health
Grafana: http://127.0.0.1:3001
```

## Arranque cloud

El deploy actual no se modifica. En el servidor, después de levantar EduTrack
con el flujo existente, creá `.env.monitoring` y usá la red cloud:

```env
EDUTRACK_APP_NETWORK=edutrack_net
GRAFANA_BIND_ADDRESS=127.0.0.1
GRAFANA_PORT=3001
```

Luego:

```bash
docker compose --env-file .env.monitoring -f docker-compose.monitoring.yml up -d
```

Para bajarlo:

```bash
docker compose --env-file .env.monitoring -f docker-compose.monitoring.yml down
```

Para borrar también datos de Grafana, Prometheus y Loki:

```bash
docker compose --env-file .env.monitoring -f docker-compose.monitoring.yml down -v
```

## Validación

Estado de contenedores:

```bash
docker compose --env-file .env.monitoring -f docker-compose.monitoring.yml ps
```

Logs:

```bash
docker compose --env-file .env.monitoring -f docker-compose.monitoring.yml logs -f grafana prometheus loki alloy
```

En Grafana:

1. Abrí `http://127.0.0.1:3001`.
2. Entrá con `GRAFANA_ADMIN_USER` y `GRAFANA_ADMIN_PASSWORD`.
3. Revisá dashboards en la carpeta `EduTrack`.
4. En Explore, probá datasource Loki:

```logql
{compose_service="auth"}
```

Si no aparecen líneas, ampliá el rango temporal arriba a la derecha (por
ejemplo `Last 6 hours`) y generá tráfico:

```bash
curl http://localhost:4000/health
```

5. En Explore, probá Prometheus:

```promql
probe_success{job="blackbox-http"}
```

## Alertas

Prometheus carga reglas desde `monitoring/prometheus/alerts.yml`.

Incluye:

- Backend o frontend caído por Blackbox.
- Postgres exporter no scrapeable.
- Disco del host por debajo de 15%.
- Memoria del host por encima de 90%.
- CPU alta sostenida en contenedores.

Para notificaciones reales, agregá Alertmanager o configurá alerting en Grafana
con contact points de email, Slack, Telegram o webhook. No se incluyen secretos
de notificación en el repositorio.

### Errores HTTP 5xx

Como esta rama no instrumenta Express con métricas propias, el monitoreo de 5xx
se hace desde logs en Loki. El dashboard `Logs Loki` incluye:

- `Auth 5xx log rate`
- `Auth recent 5xx logs`

Query recomendada para una alerta en Grafana Alerting:

```logql
sum(count_over_time({compose_service="auth"} |~ "5[0-9][0-9]" [5m])) > 0
```

Para producción, una política más tolerante suele ser:

```logql
sum(count_over_time({compose_service="auth"} |~ "5[0-9][0-9]" [5m])) >= 5
```

Esto evita ruido por errores aislados, pero alerta cuando hay una racha de 5xx.

## Limitación actual

El backend actual no expone métricas Prometheus propias en `/metrics` en esta
rama. Para respetar la restricción de no introducir dependencias invasivas, esta
integración monitorea la aplicación con Blackbox HTTP y con métricas de Docker,
host y PostgreSQL.

Si más adelante se decide instrumentar Express, hacerlo en una rama separada
con una dependencia como `prom-client`, pruebas y revisión de seguridad.
