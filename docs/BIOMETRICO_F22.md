# ZKTeco F22 — ADMS en EduTrack (nube / producción)

## Cómo funciona (sin agentes ni programas extra)

1. El **reloj F22** (en el colegio, con Internet) hace **push** HTTP al servidor EduTrack.
2. El servidor es el **mismo backend** que ya desplegás en la nube (`auth`, puerto **4000**).
3. Rutas ADMS: `/iclock/*` y también `/cdata`, `/getrequest` (F22 con *Domain Name* ON).
4. EduTrack guarda la fichada y actualiza **Asistencias**.

No hay ngrok, ni agente en la PC del colegio, ni proceso aparte en producción.

```
[F22 colegio] --Internet HTTPS--> [API EduTrack en la nube] --> PostgreSQL
```

---

## Configuración en producción (DigitalOcean / cloud)

### 1. Desplegar backend con el código actual

```bash
docker compose -f docker-compose.cloud.yml up -d --build
```

En cloud, `ZKTECO_ICLOCK_PORT=0`: ADMS va en el **mismo puerto 4000** que la API.

### 2. URL pública del API

Usá el dominio HTTPS real del backend, por ejemplo:

- `https://api.edutrack-uy.com`  
- o `https://165.22.34.95:4000` (si el TLS termina en el droplet)

Comprobación:

```bash
curl -s "https://TU-API/iclock/getrequest?SN=SRN5260500102"
# Debe responder: OK
```

### 3. Proxy / Cloudflare

El proxy (Cloudflare, nginx, etc.) debe **reenviar** al backend:

- `/iclock/*`
- `/cdata`, `/getrequest`, `/registry`, `/devicecmd` (si el reloj no usa prefijo `/iclock`)

Sin cachear esas rutas. Cuerpo **text/plain** en POST de fichadas.

### 4. Registrar el dispositivo en la BD de producción

En el servidor (o contra la BD de prod):

```bash
cd backend
BIOMETRIC_DEVICE_CODE=F22-COLEGIO-01 \
BIOMETRIC_ADMS_SERIAL=SRN5260500102 \
BIOMETRIC_DEVICE_SECRET=secreto-largo-produccion \
npm run seed:biometric
```

Cada PIN del reloj = `deviceUserId` en el mapeo.

### 5. Configuración en el reloj F22

**Comm → Cloud Server Setting:**

| Campo | Producción (nube) |
|--------|-------------------|
| Server Mode | ADMS |
| Enable Domain Name | **ON** |
| Server Address | `https://TU-API` (sin `/iclock` al final) |
| HTTPS | **ON** |
| Puerto | vacío o **443** (si el menú lo pide) |

**M/OK**, **ESC**, reinicio. Icono nube sin cruz = conectado.

### 6. Logs en el servidor

```bash
docker compose -f docker-compose.cloud.yml logs -f auth | grep zkteco-iclock
```

Debe aparecer `[zkteco-iclock] request` con la IP del reloj y luego `options=all` / ATTLOG.

---

## Desarrollo local (opcional)

Solo para probar en casa: IP de la PC (`192.168.1.2`), puerto **8081** en `docker-compose.yml`, HTTPS **OFF**.

Si el reloj no aparece en `netstat` hacia la PC, **no implica** que falle en nube: en local el problema suele ser red WiFi/router; en producción el reloj habla por Internet a tu dominio público.

Prueba manual local:

```powershell
curl.exe "http://192.168.1.2:8081/iclock/getrequest?SN=SRN5260500102"
curl.exe -X POST "http://192.168.1.2:8081/iclock/cdata?SN=SRN5260500102&table=ATTLOG" -H "Content-Type: text/plain" -d "1001`t2026-05-20 18:00:00`t0`t1"
```

---

## Asistencias en la web

**Asistencias** → **Ver todos los ciclos** → fecha del día.

## API alternativa

`POST /biometric/adms-ingest` con `x-biometric-secret` (integraciones custom).
