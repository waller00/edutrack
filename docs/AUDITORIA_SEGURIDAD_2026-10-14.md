# Auditoría de seguridad de EduTrack — 14 de octubre de 2026

Se identificaron ocho hallazgos o riesgos que requieren seguimiento. Cinco comportamientos se reprodujeron localmente con servicios simulados; los restantes se sustentan en configuración o avisos de dependencias. No se demostró compromiso del servidor ni se ejecutaron ataques contra producción.

## Alcance y evidencia

Revisión del código de autenticación BFF/OIDC, middleware de permisos, acceso a libretas y licencias, ingesta biométrica, cliente y scripts Moodle, archivos de despliegue, dependencias de producción y candidatos a secretos en archivos versionados. Es una revisión focalizada, no una certificación ni una revisión exhaustiva de todas las rutas.

Base: commit `c4e574ab40fd603eb4acc06869da1a4379e3b727` más el árbol de trabajo. Se conservaron los cambios preexistentes del usuario en workflows y documentación. No se modificó código operativo ni se desplegaron cambios.

Las pruebas se ejecutaron en una copia temporal, sin archivos `.env` locales y con Redis, Prisma, correo y Keycloak simulados. Node 22.23.3 y npm 10.9.9. La primera ejecución de Supertest quedó bloqueada por los sockets del sandbox; la repetición con sockets locales habilitados terminó correctamente.

- **109/109 pruebas existentes** relevantes aprobadas en diez archivos.
- **9/9 pruebas de auditoría** aprobadas en cuatro archivos. Estas pruebas documentan el comportamiento vulnerable actual y controles comparativos; que pasen **no significa que los fallos estén corregidos**.
- **Cuatro GET anónimos** en producción devolvieron 401: `/auth/me`, `/admin/users`, `/gradebook/mine`, `/medical-leaves/my-leaves`.
- Web pública: 200. Moodle: redirección al login y 200. Respuestas a través de Cloudflare.
- `npm audit --omit=dev --json` consultado durante esta auditoría. El resultado es por árbol de dependencias, no por número de exploits independientes.

[Evidencia, pruebas y manifiesto](security-audit/2026-10-14/README.md).

## Prioridades

| ID | Prioridad | Hallazgo | Evidencia y límite |
|---|---|---|---|
| AUD-01 | Media | Callback OIDC sin vinculación al navegador iniciador | Reproducido con intercambio de código simulado; pendiente prueba integral con IdP de testing |
| AUD-02 | Alta, condicionada | Identidades vinculadas por email/username sin fijar el sujeto OIDC | Comportamiento reproducido; suplantación real depende de qué atributos pueda emitir o cambiar Keycloak |
| AUD-03 | Alta | Suplencia histórica permite calificar fuera de la fecha suplida | Reproducido en el control de acceso y ventana de edición |
| AUD-04 | Media | Las sesiones de performance no respetan su caducidad declarada | Reproducido en authGuard y confirmado en persistencia; requiere que esa función esté habilitada |
| AUD-05 | Alta, condicionada | IP manipulable en allowlist ADMS y rate limiting | Reproducido en rutas locales; depende de acceso a ADMS y normalización de cabeceras en la cadena real |
| AUD-06 | Alta para actualización | Dependencias con avisos, incluidos dos paquetes clasificados como críticos | Confirmado por lockfiles y registro; no implica explotación de los dos avisos en esta app |
| AUD-07 | Media | Secretos predeterminados admitidos en configuración productiva | Confirmado en archivos; no se consultaron valores secretos del servidor |
| AUD-08 | Media | Script Moodle crea token administrativo permanente y lo imprime | Confirmado en script; no se consultó el token activo |

## AUD-01 — Vincular el login al navegador

**Ubicación:** `backend/src/routes/auth-keycloak.ts:128`, `:168`; `backend/src/auth/keycloak.ts:125`.

`beginLoginFlow` guarda `{codeVerifier, returnTo}` bajo una clave Redis derivada de `state`. No establece una cookie de transacción. El callback acepta cualquier navegador que presente un `state` existente y recupera de Redis el verificador PKCE correspondiente. Por tanto, el servidor puede completar para un navegador diferente un flujo iniciado por otra persona.

**Prueba:** un cliente inicia login; otro cliente sin cookies presenta el callback de ese flujo y recibe `sid` de la identidad simulada del iniciador. El IdP y el canje se simulan como válidos: no se pretende haber falsificado un código Keycloak.

**Impacto:** login CSRF o intercambio de sesión. Un atacante con una cuenta admitida puede hacer que una víctima termine usando la cuenta del atacante, con riesgo de que introduzca información en ella. Esto no demuestra robo directo de la cuenta de la víctima.

**Corrección:** vincular la transacción a una cookie aleatoria HttpOnly/Secure/SameSite=Lax del navegador, verificarla antes del canje y consumir estado/verificador de forma atómica. Conservar PKCE. Probar callbacks sin cookie, con cookie de otro flujo, repetidos y concurrentes.

La vinculación del flujo al agente de usuario forma parte de la protección CSRF descrita en [RFC 9700, sección 4.7](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.7).

## AUD-02 — Vinculación de identidad por atributos mutables

**Ubicación:** `backend/src/auth/keycloak-provisioning.ts:44`; `keycloak/realm-edutrack.json:7`.

`provisionUserFromClaims` busca primero por email y luego por username. Si encuentra una cuenta, conserva sus privilegios y puede actualizar su email. No exige email verificado ni comprueba una vinculación persistente `(issuer, subject)` con esa cuenta. La plantilla permite editar username y tiene `verifyEmail: false`.

**Pruebas:** claims de otro sujeto con email no verificado coincidente devuelven el ID/rol ADMIN existente; el fallback por username permite resolver la cuenta y cambiar su email.

**Condición importante:** los mocks prueban la debilidad del enlace en EduTrack, no que Keycloak permita hoy crear esa colisión. El realm desactiva el registro directo y no admite emails duplicados. Para demostrar toma de cuenta hace falta comprobar divergencias entre bases, cuentas huérfanas, edición de atributos e identidad federada en testing. No se afirma una toma de cuenta reproducida en producción.

**Corrección:** persistir la identidad por `iss` y `sub`; permitir migraciones o enlaces iniciales sólo con correo verificado y un procedimiento explícito. Eliminar el enlace automático por username. Requerir nueva verificación para cambios de email y probar cambios de sujeto con atributos idénticos. [OWASP: vinculación de identidades y autenticación](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

## AUD-03 — Escritura de suplentes fuera de la suplencia

**Ubicación:** `backend/src/services/gradebook/access.ts:40`, `:115`; `backend/src/routes/gradebook.ts:1257`, `:1307`, `:1965`; `backend/src/services/gradebook/edit-window.ts:26`.

La existencia de cualquier suplencia del mismo ciclo/grupo/asignatura concede nivel `SUBSTITUTE` y escritura de notas. La consulta no filtra la fecha de la suplencia. La edición posterior valida la antigüedad de la evaluación, pero no su coincidencia con la suplencia.

**Prueba:** una suplencia histórica concede acceso de escritura y permite editar una evaluación actual dentro de su ventana, aunque no corresponda al día suplido. El comentario del propio servicio distingue acceso de lectura a toda la libreta de la necesidad de acotar la escritura por fecha.

**Impacto:** un suplente de una clase podría crear evaluaciones o modificar notas de otro tramo del mismo curso activo. Los ciclos archivados y los períodos cerrados sí tienen controles propios; el hallazgo no los elude.

**Corrección:** separar lectura histórica de autorización para escribir. Vincular cada operación de calificación a las fechas o intervalo de cobertura autorizado. Definir expresamente quién puede registrar notas de período/cierre, que no equivalen a una evaluación de un día. Añadir pruebas antes, durante y después de una suplencia.

## AUD-04 — Caducidad de sesiones de performance

**Ubicación:** `backend/src/routes/auth.ts:231`, `:281`; `backend/src/auth/session-store.ts:28`, `:45`; `backend/src/middlewares/auth.ts:16`.

La ruta de performance calcula una duración de 5 a 120 minutos (30 por defecto) y la guarda en `accessTokenExpiresAt`. `saveSession` aplica en cambio el TTL global, siete días por defecto. `authGuard` no consulta ese campo: la sesión existe en Redis y la cuenta está habilitada, por lo que admite la petición. La prueba permite una sesión de performance cuyo plazo declarado venció un día antes.

**Condición:** la función debe haberse habilitado y debe existir una sesión emitida. El compose la desactiva por defecto; no se comprobó el valor de producción.

**Corrección:** añadir `sessionExpiresAt` independiente de la caducidad del access token; persistir Redis con el mínimo entre el TTL general y el límite de esa sesión, y verificarlo en cada petición. Deshabilitar el emisor de performance no revoca por sí solo los SIDs emitidos: revocarlos explícitamente.

**Relacionado, pendiente:** para sesiones OIDC ordinarias, que el access token caduque antes que la sesión BFF puede ser deliberado. Lo que requiere comprobarse es la propagación de revocación/cambio de contraseña desde Keycloak: no se encontró una ruta de backchannel logout en los archivos revisados. No se considera la mera diferencia de TTL una vulnerabilidad por sí sola.

## AUD-05 — Cabeceras de IP no confiables

**Ubicación:** `backend/src/routes/zkteco-iclock.ts:21`, `:64`, `:94`; `backend/src/middlewares/rate-limit.ts:24`; `backend/src/routes/biometric-adms.ts`; `nginx/reverse-proxy/nginx.conf:214`, `:218`, `:314`, `:318`, `:400`.

El código usa la primera IP de `X-Forwarded-For`, ignorando la resolución de confianza de Express. Nginx agrega su IP resuelta a la cadena recibida mediante `$proxy_add_x_forwarded_for`, en lugar de reemplazar la cadena. La ruta ADMS de texto acepta el serial del dispositivo sin secreto y depende de la allowlist; una lista vacía permite cualquier IP.

**Pruebas:** una IP no permitida obtiene 403; anteponer a la cabecera una IP autorizada produce 200 y llama a la ingesta simulada, sin secreto del dispositivo. Cambiar la primera IP también cambia la clave Redis del rate limiter, manteniendo el mismo origen final.

**Condiciones:** para abusar de ADMS se necesita conocer un serial válido y, si existe allowlist, una IP permitida, además de llegar a esa ruta conservando la cabecera. El escaneo previo observó 80/443 filtrados por IP directa. No se enviaron fichadas ni cabeceras de ataque a producción. Cloudflare/firewalls podrían impedir una ruta concreta; hace falta verificar la cadena efectiva en testing. El límite Nginx por `$remote_addr` es una defensa adicional y no queda demostrado que pueda eludirse con esta prueba.

**Corrección:** normalizar la IP en el proxy de confianza y reenviar un valor único; usar `req.ip` con una configuración de proxies coherente. Aislar ADMS mediante red privada/VPN y exigir allowlist no vacía para dispositivos productivos, o un gateway autenticado para hardware que no soporte credenciales. Auditar todos los lectores manuales de cabeceras, incluidos los logs.

## AUD-06 — Dependencias de producción

| Árbol | Moderadas | Altas | Críticas | Total de paquetes señalados |
|---|---:|---:|---:|---:|
| Backend | 8 | 6 | 1 | 15 |
| Frontend | 4 | 6 | 1 | 11 |

Son resultados separados y pueden compartir paquetes/avisos. No deben sumarse como 26 vulnerabilidades únicas explotables. Se conservaron ambos JSON completos.

El lockfile fija **Next 14.2.33**, Express 4.21.2, Nodemailer 6.10.1 y Faker 10.1.0, entre otros paquetes señalados. Los dos paquetes clasificados como críticos por el registro necesitan evaluación contextual:

- **Next:** el [aviso oficial sobre AVIF](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4) incluye la versión bloqueada, pero requiere optimización de AVIF con la cadena de bibliotecas afectada. No se ha demostrado que EduTrack exponga esa combinación ni se probó RCE. Hay otros avisos de Next en el JSON. La remediación de un aviso no garantiza cubrir los demás.
- **proxy-addr:** el [aviso oficial](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h) requiere una configuración concreta de subredes IPv6 de confianza. El código revisado usa `trust proxy = 1`, por lo que **no se identificó esa condición aquí**. Es diferente del fallo de lectura manual de cabeceras de AUD-05.

**Corrección:** actualizar versiones bloqueadas tras evaluar compatibilidad; priorizar Next y dependencias HTTP/correo. Ejecutar build, pruebas de login y funcionales después de actualizar. No aplicar `npm audit fix --force` automáticamente: el resultado propone cambios mayores y hasta un retroceso de ExcelJS para alguna dependencia transitiva. Contrastar las versiones del lockfile con las imágenes que realmente corren en producción.

## AUD-07 — Secretos predeterminados permitidos

**Ubicación:** `docker-compose.cloud.yml:111`; `keycloak/realm-edutrack.json:43`; `scripts/deploy-prod-like-testing.sh:48`; `scripts/keycloak-config-moodle-client.sh:24`, `:119`.

La configuración cloud permite un secreto de cliente conocido si falta la variable. El script de preparación puede escribir ese valor predeterminado en `.env`; la configuración de SSO Moodle tiene otro fallback y lo imprime al terminar. No se incluyen los valores en este informe ni se comprobó que estén activos en producción.

**Corrección:** exigir las variables en despliegue, rechazar valores de ejemplo y dejar de imprimir credenciales. Rotar los secretos si se confirma que se utilizaron o quedaron en logs. La rotación debe coordinarse con los clientes para no interrumpir el login.

La búsqueda por firmas de claves privadas y tokens de proveedores en archivos versionados actuales no encontró coincidencias. Esto no equivale a un escaneo exhaustivo de todos los blobs históricos. No se leyeron ni publicaron secretos de `.env` locales. Los estados Terraform versionados examinados no contenían valores de claves secretas en los campos buscados.

## AUD-08 — Token Moodle con privilegios excesivos

**Ubicación:** `scripts/moodle-config-webservices.php:81`.

Si falta el token, el script toma `get_admin()`, crea un token permanente, sin vencimiento ni restricción IP, y lo imprime. El token está asociado al servicio EduTrack y sus funciones habilitadas: **no se afirma que permita llamar cualquier API Moodle**. Sin embargo, esas funciones incluyen creación/actualización de usuarios y matriculaciones con los privilegios del administrador.

**Corrección:** cuenta técnica dedicada con las capacidades mínimas necesarias, funciones del servicio limitadas, vencimiento/rotación y restricción de origen cuando sea viable. Entregar el secreto mediante almacenamiento protegido, evitando logs. Antes de cambiarlo, inventariar las funciones que necesita la sincronización y verificar altas, bajas, matrículas y notas en testing.

El cliente REST de EduTrack envía el token en el cuerpo POST, no en la URL, y tiene timeout. No se encontró desactivación de validación TLS en ese cliente. El transporte HTTP interno debe evaluarse respecto de la red Docker efectiva.

## Controles positivos y cuestiones pendientes

Los permisos de los subrouters administrativos se aplican también en sus puntos de montaje: no se contabilizaron como abiertos por carecer de un middleware repetido en cada ruta. Las licencias individuales comparan titular/alcance; el acceso a libretas rechaza docentes ajenos. Las rutas revisadas usan esquemas Zod y consultas Prisma; la búsqueda puntual no encontró `queryRawUnsafe`/`executeRawUnsafe` en el backend. Esto no acredita ausencia universal de inyección.

La cookie BFF es opaca y HttpOnly, Secure por defecto en producción, SameSite=Lax por defecto; los tokens OIDC permanecen en Redis. El guard consulta si la cuenta sigue activa/aprobada/bloqueada. Las fotos restringen tamaño, MIME y firma binaria, y no admiten SVG. Las pruebas existentes seleccionadas cubren estos controles.

Pendientes de configuración o de una segunda fase:

- **Sesiones/cuentas:** las rutas `/auth/account/*` usan un helper que sólo comprueba Redis, sin repetir el estado de cuenta. Una prueba reproduce esta diferencia. La invalidación desde administración reduce el riesgo, pero es asíncrona y tolera fallos. Unificar comprobaciones con el guard. Revisar también el uso del rol guardado en sesión en decisiones de perfil.
- **CSRF y MFA:** no se observó middleware general de token CSRF/validación de Origin. SameSite=Lax ayuda frente a sitios externos, pero no cubre todos los escenarios entre subdominios; confirmar `COOKIE_SAMESITE`/`COOKIE_DOMAIN` reales. La desactivación OTP sí exige código, pero no tiene un límite específico por usuario en la app; la plantilla del realm no declara protección de fuerza bruta. Verificar el realm activo y límites de recuperación por correo antes de concluir exposición.
- **Pruebas de permisos:** con `NODE_ENV=test`, `userPermissionScope` concede `all` a ADMIN y `own` a cualquier otro rol sin consultar grants. Existen pruebas directas de la rama DB, pero algunas pruebas de rutas no ejercitan la matriz real. Ampliar cobertura con grants explícitos y cuentas de testing de distintos roles.
- **Cabeceras:** la respuesta pública del frontend no incluyó CSP; el API sí. Moodle no incluyó HSTS en la muestra, aunque el dominio padre sirve HSTS con `includeSubDomains`. Son puntos de endurecimiento, no prueba de XSS o de transporte inseguro.
- **Datos versionados:** `data.sql` contiene datos con dominios `.test`/`.local`, 32 usuarios, 86 estudiantes, hashes y 44 filas de refresh tokens del modelo anterior. Parecen datos de demostración; no se comprobó su procedencia ni vigencia. Confirmar que sean totalmente sintéticos y retirar material de autenticación de los fixtures. No se copiaron valores al informe.
- **Operación:** hay scripts y documentación de backup/restauración, pero no se verificaron ejecución, retención, aislamiento, cifrado en reposo ni una restauración real. Tampoco se accedió al host por SSH, a su configuración efectiva, reglas Cloudflare, logs, realm activo o capacidades del usuario técnico Moodle.

## Orden de corrección y criterios de cierre

1. Corregir la vinculación de identidad y del callback, verificando migración de usuarios existentes, login normal/Google y flujos MFA en testing.
2. Restringir escritura de suplentes y validar aislamiento entre dos docentes, un suplente, adscripción y administración con datos sintéticos.
3. Corregir IP de confianza y TTL de performance; verificar ADMS real mediante un dispositivo/gateway de pruebas y revocación de SIDs.
4. Actualizar dependencias y endurecer secretos/privilegios de integración con un plan de rotación.
5. Completar pruebas autenticadas en testing y revisión efectiva de producción; realizar restauración aislada de un backup.

Los hallazgos permanecen abiertos. Para cerrarlos, invertir las expectativas de las reproducciones: callback sin cookie rechazado, sujeto ajeno no enlazado, suplencia fuera de fecha sin escritura, sesión vencida rechazada y cabecera falsificada sin efecto. Conservar pruebas de los flujos legítimos para detectar regresiones.
