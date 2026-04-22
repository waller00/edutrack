# Restaurar la base en un entorno de pruebas (Docker)

## TL;DR (no es difícil: el fallo es el comando viejo)

1. **No escribas `docker-compose`** (con guión). Eso es Compose **v1** y con Docker nuevo te tira `KeyError: 'ContainerConfig'` al hacer `up`.
2. Instalá Compose **v2** una vez: `sudo apt-get update && sudo apt-get install -y docker-compose-plugin` (si no está el paquete, [instalación Docker en Ubuntu](https://docs.docker.com/engine/install/ubuntu/)).
3. En el repo, para **no equivocarte de comando**, usá el wrapper del proyecto:

```bash
cd ~/edutrack
chmod +x scripts/dc-cloud.sh scripts/restore_pg_custom_dump_cloud.sh
./scripts/restore_pg_custom_dump_cloud.sh /root/prod-asistencias.dump
```

Eso hace exactamente lo que venías haciendo (parar web/auth, restaurar dentro de `pg`, levantar web/auth) pero con **`docker compose`** por debajo.

Si querés los pasos a mano, cada `docker-compose -f docker-compose.cloud.yml …` lo reemplazás por `./scripts/dc-cloud.sh …` (mismos subcomandos: `stop`, `exec`, `up`, etc.).

## Error: `No such service: authcd`

Pegaste dos comandos en una sola línea, sin salto entre `auth` y `cd`:

```text
docker-compose ... up -d web authcd ~/edutrack
```

Compose interpretó el servicio `authcd`. **Solución:** cada comando en su línea, o usá el script del repo (más abajo).

## Error: `KeyError: 'ContainerConfig'` (docker-compose v1)

Ocurre con **`docker-compose` 1.29.x** (Python) y **Docker Engine** recientes: el formato de inspección de imágenes/contenedores cambió y Compose v1 no puede recrear el servicio `pg`.

**Solución recomendada (Ubuntu en el Droplet):** instalá el plugin **Compose v2** (convive con el paquete `docker.io` si ya lo tenés).

```bash
sudo apt-get update
sudo apt-get install -y docker-compose-plugin
docker compose version
```

Si `docker-compose-plugin` no aparece en los repositorios, seguí la guía oficial de Docker para Ubuntu (repositorio `download.docker.com`) o, en un servidor de prueba, `curl -fsSL https://get.docker.com | sudo sh` (instala engine + plugin).

A partir de ahí usá **`docker compose`** (con espacio), no `docker-compose`.

Si seguís en el mismo shell, podés definir un alias:

```bash
alias docker-compose='docker compose'
```

## Recuperación si quedó el proyecto a medias

En el directorio del repo (p. ej. `~/edutrack`):

```bash
docker compose -f docker-compose.cloud.yml down
docker compose -f docker-compose.cloud.yml up -d
```

Los datos de Postgres suelen estar en el volumen `pgdata`; `down` por defecto **no** lo borra. Si necesitás empezar de cero con el volumen, revisá antes qué implica perder datos.

## Restaurar un `.dump` (formato custom de `pg_dump -Fc`)

Desde la raíz del repo en el servidor:

```bash
chmod +x scripts/restore_pg_custom_dump_cloud.sh
./scripts/restore_pg_custom_dump_cloud.sh /root/prod-asistencias.dump
```

El script para solo `web` y `auth`, restaura dentro del contenedor `pg` y vuelve a levantar `web` y `auth`. Usa `docker compose` si está instalado.

## Importar `data.sql` (texto plano)

Seguí usando `./scripts/import_data_sql_on_server.sh`; ese flujo no recrea contenedores. Ese script también se actualizó para preferir `docker compose` cuando exista.
