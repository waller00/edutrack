# SSH de testing: Tailscale para personas/CI y LAN para el backup

Objetivo: que `edutrack-testing` deje de aceptar SSH desde la WAN. Las personas
y GitHub Actions entran **solo por Tailscale**; el backup de producción entra
**por la LAN/VPC**. Se conserva OpenSSH en TCP 22, usuario `root` y
autenticación por clave; no se activa Tailscale SSH.

- IP Tailscale de testing: `100.98.120.16`
- IP LAN/VPC de testing: `10.108.0.3` (producción: `10.108.0.2`, misma VPC
  `10.108.0.0/20`)
- Huella ECDSA del host (la que negocia `appleboy/ssh-action`):
  `SHA256:IvkEvZ3+GQwB3iZBCcvkenlSz4TD1ubMZda0TPm/nqo`
- `RunSSH` sigue en `false` (se usa `sshd`, no Tailscale SSH).

## Qué se hizo ya

- Se agregaron a `/root/.ssh/authorized_keys` de testing las claves de los
  administradores que ya estaban en producción (Jorge y Robert). Testing quedó
  con 4 claves: las 2 que tenía más las 2 de producción.
- Se dejaron **cargadas pero inactivas** las reglas UFW de testing:
  `default deny incoming`, `allow outgoing`, `allow routed`,
  `allow 80,443,3000,4000,8089/tcp`, `allow in on tailscale0` y
  `allow from 10.108.0.2 to any port 22` (backup por LAN). Se quitaron las
  reglas públicas viejas `22/tcp` y `11434/tcp` y las reglas de Ollama.
  **UFW quedó activo** el 13/11/2026; el 22 público está cerrado.
- En producción se cambió el alias `edutrack-testing-backup` a `10.108.0.3`
  (LAN), con la host key en `/root/.ssh/known_hosts` y
  `StrictHostKeyChecking yes`. Se probó el backup por LAN: `restic snapshots`
  y `restic check`, sin errores. El alias `edutrack-testing-backup-ts` se
  retiró.
- En la notebook, `edutrack-testing` y `edutrack-testing-ts` apuntan a
  `100.98.120.16` (Tailscale); el acceso público al 22 ya no se usa.

## 1. ACL de Tailscale (bloqueante)

En **Access Controls** de la tailnet, sumar a `grants` (sin borrar las reglas
existentes):

```json
{
  "src": [
    "rtaff18@github",
    "100.65.213.80",
    "100.95.207.117",
    "joaquinwaller2003@gmail.com",
    "jorgemarrero88@gmail.com"
  ],
  "dst": ["100.98.120.16"],
  "ip": ["tcp:22"]
},
{
  "src": ["tag:github-deploy"],
  "dst": ["100.98.120.16"],
  "ip": ["tcp:22"]
}
```

- Si ya existe el grupo de administradores que tiene `tcp:22` hacia
  `100.92.202.72` en producción, usar ese grupo como `src` en lugar de la lista
  de usuarios.
- `rtaff18@github` ya tiene acceso propio a testing (es el dueño del nodo); los
  otros dos son los compañeros y las dos IPs son sus dispositivos compartidos.
  Cada uno conserva su clave SSH autorizada.
- `tag:github-deploy`: lo usa el runner efímero de GitHub Actions.

Esto es lo único que no se puede aplicar desde los servidores: se hace en la
consola de Tailscale. El backup de producción **no** necesita un grant de
Tailscale: va por la LAN (`10.108.0.3`), y UFW permite solo `10.108.0.2:22`.

Verificación (desde testing, después de aplicar la ACL):

```bash
tailscale debug netmap | python3 -c 'import json,sys; d=json.load(sys.stdin); [print(r["Srcs"], r["Dsts"]) for r in d["PacketFilter"]]'
```

Debe aparecer `100.98.120.16` como destino con puerto 22 para las IPs de los
compañeros y del runner. El backup de producción no aparece ahí porque va por
la LAN, no por Tailscale.

## 2. GitHub Actions: environment `testing`

Los workflows de testing ahora usan la acción local
`.github/actions/production-ssh` (la misma de producción) y luego
`appleboy/ssh-action` contra `100.98.120.16`, con la huella ECDSA de testing.

Para que el runner efímero entre a la tailnet:

1. Crear en Tailscale una identidad federada para GitHub Actions autorizada a
   emitir nodos con `tag:github-deploy`, con subject exacto:

   ```text
   repo:waller00@242244337/edutrack@1183698688:environment:testing
   ```

   (Es el mismo subject de producción cambiando `production` por `testing`.)

2. En GitHub → Settings → Environments → **testing** → Environment secrets:

   - `TS_DEPLOY_CLIENT_ID`
   - `TS_DEPLOY_AUDIENCE`

3. Mantener `SSH_USER` y `SSH_PRIVATE_KEY_TESTING` como están. Opcional:
   variable `TESTING_SSH_TAILSCALE_HOST=100.98.120.16` (el código ya usa ese
   valor por defecto).

Workflows modificados:

- `.github/workflows/deploy.yml`: `deploy-testing` y `deploy-testing-manual`.
- `.github/workflows/deploy-recover.yml`: `recover-testing`.
- `.github/workflows/verify-testing-private-ssh.yml`: prueba de solo lectura,
  corre desde `develop`.

Antes de cerrar el 22, ejecutar una vez **Verify testing SSH through Tailscale**
y después un deploy manual a testing. Si el runner no obtiene el subject o el
grant, el workflow falla sin fallback público (a propósito).

## 3. Backup de producción hacia testing (LAN/VPC)

El backup restic usa el alias `edutrack-testing-backup`, que ya apunta a
`10.108.0.3` (testing en la VPC, origen `10.108.0.2`). En `/root/.ssh/config`
de producción quedó:

```sshconfig
Host edutrack-testing-backup
  HostName 10.108.0.3
  User backup
  IdentityFile /root/.ssh/edutrack_backup_vps
  IdentitiesOnly yes
  StrictHostKeyChecking yes
```

La host key de `10.108.0.3` está en `/root/.ssh/known_hosts`. Ya verificado:

```bash
set -a; . /root/.restic-testing.env; set +a
restic snapshots --compact   # 3 snapshots
restic check                 # no errors
```

La UFW de testing permite solo `10.108.0.2` al puerto 22 para este backup. El
backup off-site (`scripts/backup_pg_offsite.sh`) usa el mismo destino
`10.108.0.3` por defecto. La `10.17.0.6` no rutea entre los droplets; no usarla.

## 4. UFW (activo)

Se encendió el 13/11/2026 después de verificar la ACL y el backup; el 22
público está cerrado. Los comandos quedan como referencia para reencender:

```bash
# rollback automático a 10 minutos si algo sale mal
systemd-run --on-active=10min --unit=ufw-rollback /usr/sbin/ufw --force disable
ufw --force enable
ufw status verbose
```

Verificar desde la notebook:

```bash
nc -zv 138.197.35.2 22          # debe fallar/timeout
ssh edutrack-testing-ts 'hostname'   # debe funcionar
curl -fsS http://100.98.120.16:4000/ready
curl -fsS -o /dev/null http://100.98.120.16:3000/
curl -fsS -o /dev/null http://100.98.120.16:8089/
```

Y desde producción:

```bash
ssh edutrack-testing-backup true
```

Si todo está bien, cancelar el rollback:

```bash
systemctl stop ufw-rollback.timer 2>/dev/null || true
systemctl reset-failed ufw-rollback.service 2>/dev/null || true
```

Si algo falla, el timer apaga UFW solo; también se puede correr
`ufw --force disable` a mano.

## 5. App por Tailscale (D)

La app de testing quedó accesible **solo por Tailscale**, no por WAN:

- `.env`: `FRONTEND_URL`/`CORS_ORIGINS` = `http://100.98.120.16:3000`;
  `NEXT_PUBLIC_API_URL` = `http://100.98.120.16:4000`; `KEYCLOAK_ISSUER_URL` =
  `http://100.98.120.16:8089/realms/edutrack`; `KEYCLOAK_REDIRECT_URI` =
  `http://100.98.120.16:4000/auth/callback`; `KEYCLOAK_HOSTNAME` =
  `http://100.98.120.16:8089`; `BIND_IP=100.98.120.16`.
- `docker-compose.override.yml`: `web`/`auth`/`keycloak` publican en
  `${BIND_IP:-0.0.0.0}`; en testing `BIND_IP=100.98.120.16`, en local queda
  `0.0.0.0`.
- UFW: sin `3000/4000/8089` públicos; solo `tailscale0` y `10.108.0.2:22`
  (backup).
- ACL: grant `tcp:3000`, `tcp:4000`, `tcp:8089` hacia `100.98.120.16` para los
  tres admins/dispositivos. Sin eso, los compañeros ven el HTML pero no la
  app/Keycloak.
- URL: `http://100.98.120.16:3000`; API `:4000`; Keycloak `:8089`; admin
  `http://100.98.120.16:8089/admin`.
- `keycloak-apply-realm-settings.sh` deja `edutrack-web` con redirect
  `http://100.98.120.16:4000/auth/callback`, post-logout y web-origin
  `http://100.98.120.16:3000`.
- HTTPS opcional: `tailscale serve` en 443 y `.env`/rebuild al MagicDNS; hoy no
  está activado.
- Google: el `.env` de testing no tiene `GOOGLE_CLIENT_ID`/`SECRET`; el login
  por Google no está configurado. El login por Keycloak (usuario/contraseña) sí.
- Prod no cambia: sigue con nginx 80/443 + Cloudflare; el backup sigue por LAN.

## Notas

- Los puertos `3000`, `4000` y `8089` ahora se publican **solo en
  `100.98.120.16`** (`BIND_IP`); no en `0.0.0.0`. La app responde por Tailscale
  y por localhost; la WAN no los ve. No hace falta abrir nada en el cloud
  firewall.
- `11434` (Ollama) y `22` (sshd) son procesos del host: UFW sí los filtra. Se
  quitaron las reglas de Ollama y el servicio quedó deshabilitado
  (`systemctl disable --now ollama`); ya no escucha en 11434.
- `PasswordAuthentication` sigue en `yes`, igual que producción, pero solo es
  alcanzable por Tailscale (ACL) o por la LAN desde `10.108.0.2` (UFW). Si se
  quiere, el paso siguiente es desactivarla y dejar solo claves.
- El `Include` de sshd está en la línea 12 de `/etc/ssh/sshd_config`; el
  `PasswordAuthentication yes` efectivo viene de
  `/etc/ssh/sshd_config.d/50-cloud-init.conf`. Si se desactiva, hay que tocar
  ese archivo (un drop-in `99-...` no alcanza por el orden de lectura).
