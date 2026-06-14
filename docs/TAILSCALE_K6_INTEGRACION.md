# Integracion segura de k6 con Tailscale

Esta integracion permite que el workflow manual de k6 envie metricas al
Prometheus del droplet sin publicar Prometheus, Grafana ni otros servicios en
Internet.

La carga HTTP continua llegando directamente a la URL publica de EduTrack. Solo
las metricas de k6 viajan por la tailnet.

## Arquitectura

```text
GitHub Actions runner efimero (tag:github-k6)
  |
  | Tailscale, solamente tcp/9201
  v
Droplet (tag:edutrack-monitoring)
  |
  | prometheus-remote-write-proxy:9201
  | acepta solamente POST /api/v1/write
  v
Prometheus:9090 -> Grafana
```

Grafana permanece ligado a `127.0.0.1:3001` y se sigue consultando mediante
tunel SSH. Loki, PostgreSQL, Redis y los exporters no cambian ni se publican.

## Requisitos

- Cuenta Tailscale con permisos administrativos.
- Acceso administrativo al repositorio GitHub.
- Tailscale instalado en el droplet.
- Environment de GitHub llamado `production`.
- Stack de monitoreo de EduTrack funcionando en el droplet.

## 1. Crear tags y politica de acceso

Crear los tags:

- `tag:github-k6`: identidad temporal de GitHub Actions.
- `tag:edutrack-monitoring`: identidad del droplet.

Agregar una regla equivalente a la siguiente en la politica de la tailnet,
reemplazando `<ADMIN_EMAIL>`:

```json
{
  "tagOwners": {
    "tag:github-k6": ["<ADMIN_EMAIL>"],
    "tag:edutrack-monitoring": ["<ADMIN_EMAIL>"]
  },
  "grants": [
    {
      "src": ["tag:github-k6"],
      "dst": ["tag:edutrack-monitoring"],
      "ip": ["tcp:9201"]
    }
  ]
}
```

No autorizar al tag `github-k6` a acceder a SSH, Grafana, Prometheus, bases de
datos ni redes completas.

## 2. Registrar el droplet

Instalar Tailscale siguiendo la documentacion oficial y registrar el servidor:

```bash
sudo tailscale up \
  --advertise-tags=tag:edutrack-monitoring \
  --hostname=edutrack-production
```

Obtener la IP privada:

```bash
tailscale ip -4
```

Debe pertenecer al rango Tailscale `100.64.0.0/10`. No utilizar la IP publica
del droplet ni `0.0.0.0`.

## 3. Levantar el receptor privado

Agregar a `.env.monitoring` del droplet:

```env
TAILSCALE_BIND_ADDRESS=100.x.y.z
PROMETHEUS_REMOTE_WRITE_PROXY_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine
```

Levantar el monitoreo con el override:

```bash
bash scripts/validate-tailscale-monitoring-bind.sh .env.monitoring

docker compose --env-file .env.monitoring \
  -f docker-compose.monitoring.yml \
  -f docker-compose.monitoring.tailscale.yml \
  up -d
```

Verificar que el puerto se publique solamente sobre la IP Tailscale:

```bash
docker compose --env-file .env.monitoring \
  -f docker-compose.monitoring.yml \
  -f docker-compose.monitoring.tailscale.yml \
  ps

ss -lnt | grep 9201
```

El resultado debe mostrar `100.x.y.z:9201`, nunca `0.0.0.0:9201` ni
`[::]:9201`.

El proxy acepta exclusivamente `POST /api/v1/write`. Cualquier otra ruta
responde `404`, evitando exponer las APIs de consulta y administracion de
Prometheus.

## 4. Configurar identidad federada

En Tailscale, crear una federated identity para GitHub Actions que pueda generar
nodos efimeros con `tag:github-k6`. Restringirla al repositorio EduTrack y al
environment `production`.

Crear en el environment `production` de GitHub:

Secrets:

- `TS_OAUTH_CLIENT_ID`
- `TS_AUDIENCE`

Variable:

- `PROMETHEUS_REMOTE_WRITE_TAILSCALE_HOST`: IP Tailscale o nombre MagicDNS del
  droplet.

La identidad federada evita almacenar un auth key permanente. El workflow usa
`id-token: write` exclusivamente para solicitar la identidad temporal.

## 5. Ejecutar la baseline

En GitHub Actions:

1. Abrir **Production Performance Baseline**.
2. Seleccionar **Run workflow** desde `main`.
3. Escribir `RUN_PRODUCTION_BASELINE`.
4. Indicar el motivo.
5. Activar `publish_metrics_to_grafana`.

El workflow:

- crea un nodo Tailscale efimero;
- comprueba acceso al proxy privado;
- envia metricas a Prometheus por remote write;
- etiqueta las series con `testid=gha-<run-id>`;
- conserva el resumen JSON y el informe Markdown como evidencia.

El envio se encuentra desactivado por defecto para no romper la baseline antes
de completar el aprovisionamiento externo. Si Tailscale no esta disponible, la
baseline seguira generando los artefactos JSON, pero no aparecera en Grafana.

## Validaciones de seguridad

Antes de considerar completa la implementacion:

- confirmar que `9090`, `9201` y `3001` no responden desde Internet;
- confirmar que `tag:github-k6` solo alcanza `tcp/9201`;
- probar que `GET /` sobre el proxy devuelve `404`;
- verificar que el nodo del runner desaparece al finalizar el workflow;
- revisar los logs de Tailscale y GitHub Actions;
- mantener la ejecucion manual, restringida a `main` y al environment
  `production`;
- configurar required reviewers y prevenir autoaprobacion cuando el plan de
  GitHub lo permita.

## Operacion y rollback

Para deshabilitar la recepcion por Tailscale sin afectar Grafana ni Prometheus:

```bash
docker compose --env-file .env.monitoring \
  -f docker-compose.monitoring.yml \
  -f docker-compose.monitoring.tailscale.yml \
  stop prometheus-remote-write-proxy
```

Tambien se puede retirar la regla `tag:github-k6 -> tcp/9201` de la politica de
Tailscale. Ninguna de estas acciones afecta los tuneles SSH existentes.
