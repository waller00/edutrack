# CrowdSec: primera etapa de detección

## Estado y alcance

Instalación en producción verificada el 18/10/2026 en modo observación.
No se activa desde los workflows de producción.

En la primera comprobación, el filtro descartaba el usuario anónimo vacío de
Nginx (`escape=json`). Se corrigió `[^ ]+` por `[^ ]*` en la adquisición y se
reinició únicamente CrowdSec. Una petición normal a la web respondió HTTP 200
y produjo una línea leída y procesada desde Loki; simulación global habilitada
y lista de bouncers vacía. Backup previo en el servidor:
`/root/edutrack-deploy-backups/crowdsec-20261018T214254Z`.
La corrección también está en la rama local `feature/add-CrowdSec`; debe
publicarse e integrarse en `main` para conservarla en próximos despliegues.

Validación local completada el 18/10/2026: Compose válido y prueba real con Loki
3.3.2 + CrowdSec 1.8.1 aprobada. Se comprobaron adquisición, dos alertas simuladas
(IPv4/IPv6), exclusiones, ausencia de bouncers y LAPI inaccesible por la IP del
contenedor. Los recursos temporales de las pruebas se retiraron al finalizar.

Se agrega un proyecto Compose independiente que consume los logs del proxy público
ya saneados por Alloy y almacenados en Loki. No modifica aplicación, Nginx,
Cloudflare, SSH, UFW ni Tailscale. No instala bouncers ni AppSec y no bloquea tráfico.

- Motor fijado a CrowdSec v1.8.1 y digest de imagen.
- Simulación global sin excepciones; no existe componente que aplique bloqueos.
- Central API deshabilitada: no se comparten señales ni se reciben blocklists.
  El arranque sí accede al Hub para instalar/actualizar contenido oficial; esto
  no equivale a una instalación sin salida a Internet. Los parsers del Hub no
  están fijados por el digest del motor. Registrar sus versiones antes de pasar
  de observación a bloqueo y repetir las pruebas al actualizarlos.
- Único escenario de detección previsto: `crowdsecurity/http-probing`, que
  correlaciona rutas distintas con respuestas 400/403/404. No detecta todos los
  ataques ni sustituye autorización, rate limits o revisión de código.
- LAPI escucha en loopback del contenedor. Métricas en `6060` accesibles desde
  la red Docker de monitoring, sin publicar puertos en el host.
- Sin socket Docker, volúmenes del host de logs ni privilegios de firewall.
- Límites iniciales: 512 MiB, 0,5 CPU y 128 procesos. Son límites, no mediciones
  de consumo esperado. Logs propios rotados a 3 archivos de 10 MiB.

## Adquisición y límites

`monitoring/crowdsec/acquis.d/nginx-loki.yaml` selecciona exclusivamente
`compose_project="edutrack", compose_service="reverse-proxy"` y líneas de acceso
con formato `access_safe`. Descarta las líneas WAF y de error para no contar una
solicitud dos veces. Excluye `/iclock/`, `/cdata`, `/getrequest`, `/registry` y
`/devicecmd` del análisis inicial; no cambia su acceso ni el WAF existente.
El tráfico biométrico requiere escenarios específicos en una etapa posterior.

La fuente Loki comienza a leer desde el arranque; no es una auditoría histórica.
Su caída interrumpe detección, pero no afecta el acceso a EduTrack. Supervisar la
adquisición: que LAPI esté sana no demuestra que se estén leyendo logs.

La IP usada es la del access log de Nginx. No se interpretan cabeceras XFF de
usuarios. Antes de producción, comprobar atribución real del visitante y la
confianza de proxies; no iniciar bloqueos basados en IP sin esa verificación.
El formato actual no incluye el hostname: la correlación puede agrupar las rutas
de diferentes dominios de la misma IP. Esto y las IP compartidas de centros
educativos deben considerarse al evaluar falsos positivos.

Se conecta a la red de monitoring existente para leer Loki. La consulta acota lo
que consume, pero **no es un permiso de solo lectura**: Loki actualmente no tiene
autenticación propia y un contenedor comprometido con esa conectividad podría
consultar otras líneas o enviar datos. No se agrega exposición pública de Loki.

No se vuelven a registrar queries/tokens para mejorar la detección. Lo eliminado
por saneamiento no estará disponible para escenarios que requieran ese contenido.

## Prueba local aislada

Requisitos: Docker, Compose v2, Python 3 y conectividad para descargar imágenes y
contenido del Hub. No utiliza `.env` ni datos o servicios de producción.

```bash
python3 scripts/test-crowdsec.py
```

La prueba crea un proyecto y red únicos, un Loki temporal y CrowdSec con la misma
configuración. Genera una línea anónima con Nginx y el `log_format access_safe`
del repositorio, e inyecta datos sintéticos derivados de ella. También comprueba
el formato anterior con usuario `-`. El campo de usuario vacío que produce
`escape=json` debe admitirse en el filtro de adquisición. Espera
alertas simuladas para exploración IPv4/IPv6, sin alertas para navegación 200,
biometría ni líneas WAF o del proxy privado. Verifica que LAPI no sea alcanzable
por la IP del contenedor y que no haya bouncers ni puertos publicados. Elimina
solo sus contenedores/red/volúmenes temporales al finalizar.

## Activación de observación (cuando se decida desplegar)

1. Confirmar que Alloy sanea y Loki recibe los nuevos logs; revisar salud y espacio
   del servidor. No copiar credenciales ni registros reales al repositorio.
2. Confirmar la red existente `edutrack-monitoring_monitoring` y el DNS `loki`.
3. Validar Compose y levantar únicamente el nuevo proyecto:

```bash
docker compose -f docker-compose.crowdsec.yml config --quiet
docker compose -f docker-compose.crowdsec.yml up -d
```

4. Comprobar el modo efectivo, adquisición y ausencia de bouncers:

```bash
docker compose -f docker-compose.crowdsec.yml exec -T crowdsec cscli simulation status
docker compose -f docker-compose.crowdsec.yml exec -T crowdsec cscli lapi status
docker compose -f docker-compose.crowdsec.yml exec -T crowdsec cscli metrics
docker compose -f docker-compose.crowdsec.yml exec -T crowdsec cscli scenarios list
docker compose -f docker-compose.crowdsec.yml exec -T crowdsec cscli bouncers list
docker compose -f docker-compose.crowdsec.yml exec -T crowdsec cscli alerts list
```

Esperado: simulación global habilitada, solo `http-probing` como escenario,
ningún bouncer y contadores de lectura/parsing al recibir tráfico válido. Revisar
logs si LAPI responde pero la adquisición permanece en cero. No hacer escaneos
ni pruebas de carga contra producción para generar alertas.

5. Observar un período representativo (propuesta: 1–2 semanas), revisando recursos,
   falsos positivos, IPs compartidas, reinicios y recuperación de conexión a Loki.
   Grafana muestra métricas y logs; el detalle completo de alertas se consulta
   por `cscli`. No se agregan notificaciones externas. La retención local inicial del motor es la incluida
   en la imagen (7 días / 5.000 elementos); revisar antes de ampliar el alcance.

## Detener o revertir

```bash
docker compose -f docker-compose.crowdsec.yml stop crowdsec
```

Eso detiene únicamente la detección. Para retirar contenedor/red del proyecto
sin borrar alertas ni configuración persistida:

```bash
docker compose -f docker-compose.crowdsec.yml down
```

No usar `down -v` sobre la instancia de observación si se quieren conservar los
históricos. No hay reglas de bloqueo que retirar de UFW o Cloudflare.

## Segunda etapa: decisión independiente

Para bloquear habrá que seleccionar bouncer, verificar IP real, definir alcance,
excepciones acotadas, duración, cuotas y reversión. No activar bloqueo por el solo
hecho de ver alertas. La integración gratuita con Cloudflare Workers/KV requiere
su evaluación propia y no está incluida aquí.

## Referencias

- https://docs.crowdsec.net/docs/log_processor/data_sources/loki/
- https://docs.crowdsec.net/docs/log_processor/scenarios/simulation/
- https://github.com/crowdsecurity/crowdsec/blob/master/build/docker/README.md
- https://app.crowdsec.net/hub/author/crowdsecurity/scenarios/http-probing

## Visualización en Grafana

Dashboard provisionado: **EduTrack → CrowdSec — Observación**, UID
`crowdsec-observation`. Usa las fuentes existentes `prometheus` y `loki`.

- Disponibilidad del endpoint, líneas leídas/procesadas y errores del parser final.
- Alertas locales por escenario (`cs_alerts`, gauge sujeto a retención) y disparos
  de escenarios. Ninguna de estas métricas acredita bloqueos aplicados.
- Logs del proyecto `edutrack-crowdsec` recogidos por Alloy, pasando por las mismas
  etapas de saneamiento. No cambia la consulta de adquisición de CrowdSec, por
  lo que sus propios logs no vuelven a alimentar el escenario HTTP.
- Sin datos no equivale a cero. Algunas series aparecen recién con actividad.
  Los contadores se reinician con CrowdSec; las tasas usan `rate`/`increase`.
- No hay tabla completa de IPs/eventos desde la base LAPI ni avisos por correo.
  Para investigar una alerta: `cscli alerts list` y `cscli alerts inspect ID`.
- El texto de observación del dashboard no verifica dinámicamente el modo de
  simulación. Comprobar `cscli simulation status` al activar o modificar el motor.

El endpoint de métricas no requiere autenticación: es accesible a los contenedores
conectados a monitoring. LAPI permanece en `127.0.0.1:8080`; no se agregan puertos
publicados, bouncers, reglas de firewall ni cambios en Cloudflare.

### Aplicar después de integrar y actualizar el repositorio del servidor

Los workflows de aplicación no activan automáticamente estos cambios de monitoring.
Tras guardar las configuraciones anteriores como respaldo, desde `/root/edutrack`:

```bash
docker compose -f docker-compose.crowdsec.yml config --quiet
docker compose -f docker-compose.crowdsec.yml restart crowdsec
docker compose --env-file .env.monitoring -f docker-compose.monitoring.yml restart prometheus alloy
```

El reinicio permite volver a montar los archivos actualizados por Git. Grafana
lee el directorio de dashboards cada 30 segundos y no necesita reinicio.
Hay una interrupción breve en detección/scraping/captura durante esos reinicios;
la aplicación y su proxy no se reinician.

Comprobar en Grafana que `up{job="crowdsec"}` vale 1, que los contadores aumentan
con navegación normal y que aparecen logs de CrowdSec. Confirmar simulación y
lista de bouncers vacía con `cscli`. No generar ataques en producción para probar.
Para revertir, restaurar los tres archivos de configuración anteriores y retirar
el dashboard; reiniciar CrowdSec, Prometheus y Alloy. No borrar volúmenes.

Referencia de métricas: https://docs.crowdsec.net/docs/observability/prometheus/

### Verificación de activación — 18/10/2026

Integración aplicada en producción desde el commit
`167d949c0cd8a55679d5e17a5ba79b07e741b71b` de `feature/add-CrowdSec`.
El fetch HTTPS del servidor falló por falta de credenciales; se transfirieron por
SSH privado únicamente los cuatro archivos de monitoring de ese commit.
Los cambios quedan en el árbol de trabajo del servidor hasta integrar la rama
con `main`; no se cambió el HEAD ni se desplegó la aplicación.

Backup previo:
`/root/edutrack-deploy-backups/crowdsec-grafana-20261018T223324Z`.
Prometheus validó configuración y sus ocho reglas. Se reiniciaron exclusivamente
CrowdSec, Prometheus y Alloy. Grafana cargó los nueve paneles automáticamente.

Verificado: `up{job="crowdsec"}=1`, logs del proyecto CrowdSec en Loki,
dashboard consultable por API de Grafana, web HTTP 200, CrowdSec saludable,
simulación global habilitada, bouncers vacíos y ningún puerto publicado.
