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
- `prom-client`: métricas RED y del proceso Node.js expuestas por el backend.

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

La integracion de k6 desde GitHub Actions utiliza Tailscale solamente para
enviar metricas a un proxy privado de remote write. No modifica el acceso a
Grafana mediante tunel SSH ni publica Prometheus. Ver
`docs/TAILSCALE_K6_INTEGRACION.md`.

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
Backend readiness: http://localhost:4000/ready
Grafana: http://127.0.0.1:3001
```

El backend expone `/metrics` en el puerto interno `9464`. Este puerto no se
publica en el host; Prometheus lo consulta dentro de la red Docker mediante
`auth:9464/metrics`. Puede cambiarse con `METRICS_PORT` o deshabilitarse usando
un valor no válido o menor/igual a cero.

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

6. Comprobá las métricas propias del backend:

```promql
up{job="edutrack-backend"}
sum by (method, route, status_code) (rate(edutrack_backend_http_requests_total[5m]))
histogram_quantile(0.95, sum by (le, route) (rate(edutrack_backend_http_request_duration_seconds_bucket[5m])))
sum(rate(edutrack_backend_http_errors_total[5m]))
```

El dashboard `Backend RED` resume disponibilidad real, solicitudes por segundo,
errores 5xx, solicitudes activas y latencias p50/p95/p99. `/health` comprueba
que el proceso HTTP esté vivo; `/ready` responde `200` solamente cuando
PostgreSQL y Redis, si está habilitado, están disponibles.

Las rutas desconocidas se agrupan como `/unmatched` y los segmentos que parecen
IDs se normalizan como `:id` para evitar cardinalidad no controlada.

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

### Alertas criticas por Telegram

Grafana tambien provisiona reglas Grafana-managed desde
`monitoring/grafana/provisioning/alerting/critical-alerts.yml`. Estas reglas
evalúan Prometheus desde Grafana y tienen el label:

```text
severity=critical
```

Con una notification policy `severity=critical -> telegram-critical`, Grafana
envia a Telegram solo alertas criticas. El contact point `telegram-critical` se
configura manualmente en Grafana para no versionar el token del bot ni el chat
ID del grupo.

Reglas criticas incluidas:

- Backend `/health` caido.
- Backend `/ready` caido.
- Frontend caido.
- Postgres exporter caido.
- Metricas del backend no scrapeables.
- Disco disponible del host por debajo de 8%.

Despues de actualizar el repo en el servidor, reiniciá Grafana para que lea el
provisioning:

```bash
docker compose --env-file .env.monitoring -f docker-compose.monitoring.yml up -d grafana
```

Para probar el ruteo con una alerta no destructiva:

```bash
docker compose --env-file .env.monitoring -f docker-compose.monitoring.yml stop postgres-exporter
```

Esperá al menos tres minutos. Deberia dispararse `EduTrack Postgres exporter
down` y llegar al grupo de Telegram. Luego restaurá el exporter:

```bash
docker compose --env-file .env.monitoring -f docker-compose.monitoring.yml up -d postgres-exporter
```

### Errores HTTP 5xx

El backend expone el contador `edutrack_backend_http_errors_total`, que permite
alertar sobre respuestas 5xx sin depender del formato de logs:

```promql
sum(rate(edutrack_backend_http_errors_total[5m])) > 0
```

Loki sigue siendo útil para investigar el detalle del error. El dashboard
`Logs Loki` incluye:

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

## Métricas propias del backend

La instrumentación actual incluye:

- Total de solicitudes por método, ruta normalizada y estado HTTP.
- Histograma de duración por método, ruta normalizada y estado HTTP.
- Solicitudes activas por método.
- Total de respuestas HTTP 5xx.
- Métricas predeterminadas del proceso Node.js, memoria, CPU, event loop y GC.

## Endurecimiento

- Grafana permanece ligado a `127.0.0.1`; no publicar en internet.
- Datasources y dashboards provisionados no son editables desde la UI.
- Prometheus no habilita recarga de configuración mediante HTTP.
- Alloy limita la recolección a proyectos Compose EduTrack y redacta patrones
  comunes de credenciales antes de enviarlos a Loki.
- Prometheus, Loki y exporters continúan sin puertos publicados.
- cAdvisor requiere acceso privilegiado al host para recolectar métricas; si
  ese nivel de acceso no es aceptable, deshabilitar el servicio y sus paneles.

## Baseline de rendimiento de produccion

El proyecto incluye una baseline inicial y conservadora para evaluar el droplet
de produccion sin ejecutar pruebas de estres. Su definicion se encuentra en
`performance/baselines/production-initial.json` y se ejecuta exclusivamente bajo
demanda mediante el workflow manual **Production Performance Baseline**.

La prueba incrementa gradualmente la carga entre `1`, `3` y `5` solicitudes por
segundo durante aproximadamente ocho minutos. Se aceptan inicialmente menos de
`1%` de solicitudes fallidas, mas de `99%` de checks aprobados, p95 inferior a
`750 ms`, p99 inferior a `1500 ms` y ninguna iteracion descartada.

El workflow registra el commit, el motivo, el entorno generador de carga y
snapshots del droplet antes y despues. Los resultados JSON y un informe Markdown
se conservan como artefactos de GitHub Actions durante 90 dias. La evaluacion se
complementa con Backend RED, PostgreSQL, Docker Containers y Node Host.

Opcionalmente, el workflow crea un nodo Tailscale efimero y envia las metricas
k6 al proxy privado de remote write. La ACL debe permitir exclusivamente
`tag:github-k6` hacia `tag:edutrack-monitoring` en `tcp/9201`.

Esta baseline mide endpoints publicos no destructivos y la latencia real desde
Internet. Todavia no representa sesiones autenticadas, escrituras ni capacidad
maxima. Los thresholds deben ajustarse solamente despues de acumular ejecuciones
comparables y documentar el comportamiento esperado del sistema.

## Integracion local de k6 con Grafana

En el entorno local, k6 puede enviar sus metricas directamente a Prometheus
mediante remote write sobre la red Docker interna. Prometheus habilita el
receptor, pero mantiene su puerto sin publicar. El archivo complementario
`performance/docker-compose.k6.monitoring.yml` conecta el contenedor temporal de
k6 con dicha red.

Grafana provisiona el dashboard **k6 Performance**, que presenta solicitudes por
segundo, errores, checks aprobados, iteraciones descartadas, usuarios virtuales,
latencias externas p50/p95/p99 y la comparacion entre solicitudes generadas por
k6 y solicitudes observadas por el backend.

Esta visualizacion debe analizarse junto con **Backend RED**, **PostgreSQL**,
**Docker Containers** y **Node Host**. De esta manera se puede relacionar una
variacion de carga con la latencia de la aplicacion y el consumo de recursos.
Los resumenes JSON continuan siendo la evidencia reproducible de cada ejecucion.
