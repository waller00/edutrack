# Pruebas de performance con k6

k6 se ejecuta bajo demanda desde esta maquina. No forma parte del despliegue del
droplet ni queda levantado permanentemente.

## Configuracion

Crear el archivo local:

```powershell
Copy-Item performance/.env.k6.example performance/.env.k6
```

Valores importantes:

- `K6_BASE_URL`: URL objetivo. Local: `http://host.docker.internal:4000`.
  Produccion: URL publica HTTPS del API.
- `K6_API_PATHS`: rutas `GET` no destructivas separadas por coma.
- `K6_SESSION_COOKIE`: valor opcional de la cookie BFF `sid` para rutas
  autenticadas. No commitear cookies reales.
- `K6_WEIGHTED_PATHS`: mezcla de lecturas con formato `ruta:peso`.
- `EDUTRACK_K6_RATE`: solicitudes por segundo de la prueba de carga.
- `EDUTRACK_K6_SPIKE_RATE`: pico de solicitudes por segundo.

## Ejecucion

Smoke seguro:

```powershell
docker compose --env-file performance/.env.k6 -f performance/docker-compose.k6.yml run --rm k6 run --summary-export=/results/smoke-summary.json /scripts/smoke.js
```

Carga sostenida:

```powershell
docker compose --env-file performance/.env.k6 -f performance/docker-compose.k6.yml run --rm k6 run --summary-export=/results/load-summary.json /scripts/load.js
```

Pico controlado:

```powershell
docker compose --env-file performance/.env.k6 -f performance/docker-compose.k6.yml run --rm k6 run --summary-export=/results/spike-summary.json /scripts/spike.js
```

Lecturas ponderadas:

```powershell
docker compose --env-file performance/.env.k6 -f performance/docker-compose.k6.yml run --rm k6 run --summary-export=/results/realistic-read-summary.json /scripts/realistic-read.js
```

Baseline conservadora de produccion:

```powershell
docker compose --env-file performance/.env.k6 -f performance/docker-compose.k6.yml run --rm k6 run --summary-export=/results/production-baseline-summary.json /scripts/production-baseline.js
```

El contenedor se elimina al terminar. Los resúmenes quedan en
`performance/results/`, directorio ignorado por Git.

## Baseline inicial de produccion

La definicion versionada se encuentra en
`performance/baselines/production-initial.json`. El perfil inicial dura
aproximadamente ocho minutos:

- calentamiento a `1 req/s`;
- operacion esperada a `3 req/s`;
- pico controlado a `5 req/s`;
- recuperacion a `1 req/s`.

La mezcla inicial utiliza `/health` y `/ready`. Es una baseline operativa:
valida disponibilidad publica, latencia de red y respuesta de las dependencias,
pero no reemplaza una prueba de flujos autenticados.

La ejecucion recomendada se realiza desde GitHub Actions mediante el workflow
manual **CI Performance - Production Baseline**. Al usar **Run workflow** se debe
seleccionar la rama `main`, indicar un motivo y escribir
`RUN_PRODUCTION_BASELINE`. El workflow utiliza el entorno protegido
`production`, genera un informe Markdown y conserva los resultados como
artefacto durante 90 dias.

La opcion `collect_droplet_snapshot` guarda CPU, memoria, disco y consumo de
contenedores antes y despues de la prueba. Requiere los secrets `SSH_HOST`,
`SSH_USER` y `SSH_PRIVATE_KEY`. Puede desactivarse para ejecutar solo la baseline
k6 cuando no se disponga de acceso SSH.

El artefacto incluye:

- definicion versionada de la baseline;
- contexto, commit, motivo y timestamps;
- validacion `k6 inspect`;
- respuestas `/health` y `/ready` antes y despues;
- consola y resumen JSON de k6;
- informe Markdown;
- hashes SHA-256 para verificar integridad;
- snapshots del droplet, cuando se habilitan.

Configurar la variable de repositorio `PRODUCTION_API_URL` con la URL HTTPS del
API. Si no existe, se utiliza `https://api.edutrack-uy.com`. Para que exista una
aprobacion humana real, configurar required reviewers en el environment
`production` de GitHub.

La primera ejecucion que cumpla thresholds y no coincida con incidentes reales
se considera la baseline oficial. Conservar su artefacto y registrar commit,
fecha, motivo, recursos del droplet, p95, p99, errores, solicitudes descartadas
y capturas de los dashboards. No aumentar las tasas hasta analizar al menos
tres ejecuciones comparables.

## Pruebas contra el droplet

Enviar la carga directamente a la URL publica HTTPS:

```env
K6_BASE_URL=https://api.edutrack-uy.com
```

No enviar las solicitudes bajo prueba por un tunel SSH: el tunel agrega latencia
y cifrado que distorsionan `http_req_duration` y el throughput. El tunel SSH se
puede usar para abrir Grafana o enviar resultados k6 a Prometheus.

Antes de ejecutar `load.js` o `spike.js` contra produccion:

1. Usar solo rutas `GET` conocidas y no destructivas.
2. Empezar con tasas bajas.
3. Observar CPU, memoria, PostgreSQL, errores HTTP y latencia p95.
4. Detener la prueba si aparecen errores o degradacion visible.

Los scripts bloquean objetivos remotos por defecto y aplican un tope de
solicitudes por segundo. Para autorizar conscientemente un objetivo remoto:

```env
K6_ALLOW_PRODUCTION=true
K6_PRODUCTION_CONFIRMATION=I_UNDERSTAND_THIS_GENERATES_LOAD
EDUTRACK_K6_MAX_ALLOWED_RATE=25
```

Mantener `K6_SESSION_COOKIE` fuera de Git. Las rutas se validan con estado HTTP
exacto `200`, respuesta JSON y ausencia de redireccion al login.

## Prometheus remote write opcional

No esta habilitado por defecto. La configuracion actual mantiene Prometheus sin
puertos publicados en el host del droplet.

Para usar remote write, primero se debe:

1. Arrancar Prometheus con `--web.enable-remote-write-receiver`.
2. Publicar su puerto exclusivamente en loopback, por ejemplo
   `127.0.0.1:9090:9090`.
3. Abrir un tunel local hacia ese puerto:

```powershell
ssh -N -L 9090:127.0.0.1:9090 usuario@IP_DROPLET
```

Configurar:

```env
K6_PROMETHEUS_RW_SERVER_URL=http://host.docker.internal:9090/api/v1/write
```

Ejecutar agregando el output:

```powershell
docker compose --env-file performance/.env.k6 -f performance/docker-compose.k6.yml run --rm k6 run -o experimental-prometheus-rw /scripts/load.js
```

El remote write de k6 es experimental. Los resúmenes JSON locales siguen siendo
la fuente de resultados por defecto y no requieren cambios en el droplet.

## Visualizacion integrada local en Grafana

Para observar simultaneamente las metricas generadas por k6 y el impacto sobre
EduTrack, iniciar primero la aplicacion y el monitoreo local. Prometheus acepta
remote write solamente dentro de la red Docker; su puerto no se publica.

Ejecutar un smoke integrado:

```powershell
docker compose --env-file performance/.env.k6 `
  -f performance/docker-compose.k6.yml `
  -f performance/docker-compose.k6.monitoring.yml `
  run --rm k6 run `
  -o experimental-prometheus-rw `
  --summary-export=/results/smoke-integrated-summary.json `
  /scripts/smoke.js
```

Se puede reemplazar `/scripts/smoke.js` por `load.js`, `realistic-read.js` o
`production-baseline.js`. Durante la prueba abrir Grafana en
`http://127.0.0.1:3001` y consultar:

- **k6 Performance**: carga generada, latencia externa, checks, VUs e
  iteraciones descartadas;
- **Backend RED**: solicitudes, errores y latencia observada por el backend;
- **PostgreSQL**: conexiones y actividad de base de datos;
- **Docker Containers** y **Node Host**: consumo de recursos.

El panel `k6 vs backend request rate` permite comparar la carga generada con las
solicitudes realmente observadas por la aplicacion. Puede existir una diferencia
pequena debido a probes de monitoreo y trafico local adicional.
