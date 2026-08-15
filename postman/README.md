# Colección Postman · EduTrack API

Cobertura completa de los endpoints del backend (`backend/src/routes/`): **178 requests en 25 carpetas**.

## Archivos

| Archivo | Qué es |
|---|---|
| `EduTrack.postman_collection.json` | La colección |
| `EduTrack.local.postman_environment.json` | Entorno local (`http://localhost:4000`) |
| `EduTrack.prod.postman_environment.json` | Entorno producción (`https://api.edutrack-uy.com`) |

Importá los tres en Postman (`Import` → arrastrá la carpeta) y elegí el entorno arriba a la derecha.

## Autenticación: cookie, no Bearer

EduTrack usa **patrón BFF**. No hay tokens en el header `Authorization`: la sesión es una cookie `sid`
respaldada en Redis, emitida cuando Keycloak completa el flujo OIDC.

Un script a nivel colección inyecta `Cookie: sid={{sid}}` en cada request. Solo tenés que cargar la variable `sid`.

### Opción A — atajo programático (local)

Requiere que el backend tenga:

```bash
EDUTRACK_PERFORMANCE_AUTH_ENABLED=true
EDUTRACK_PERFORMANCE_AUTH_SECRET=<un secreto>
```

Cargá ese secreto en la variable `perfSecret` y el email/username de un usuario existente en `perfUser`.
Corré **01 · Sesión → Crear sesión (performance)**: guarda el `sid` solo. Verificá con **Yo (perfil de la sesión)**.

Si el flag está apagado el endpoint devuelve 404 (así viene producción por defecto).

### Opción B — login real por navegador (producción)

1. Abrí `https://api.edutrack-uy.com/auth/login` en el navegador y completá Keycloak.
2. DevTools → Application → Cookies → copiá el valor de `sid`.
3. Pegalo en la variable `sid` del entorno de producción.

La sesión caduca: si empezás a ver 401, repetí el paso.

## Cómo está organizada

```
00 · Salud del servicio          health / ready
01 · Sesión (empezar acá)        login, refresh, me, logout
02 · Cuenta y 2FA                Keycloak: contraseña, OTP, recuperación por correo
03 · Registro y perfil propio    alta pública, verificación de correo, perfil
04 · Prueba de vida (Didit)      liveness + webhook
05-09 · Admin                    usuarios, perfiles/permisos, ajustes, estudiantes, ciclos lectivos
10 · Estructura académica        cursos, orientaciones, asignaturas
11-12 · Eventos y suplencias     horarios, recurrencias, ocurrencias, cobertura
13-14 · Asistencia               registro, conciliación, justificaciones, incidencias
15-16 · Licencias y feriados
17-19 · Analítica, reportes y exportaciones
20 · Calificaciones              puente con Moodle
21-22 · Biometría                lectores, vinculación, ingesta ADMS y protocolo ZKTeco
23 · Notificaciones              web push + in-app
24 · ⚠️ Destructivo              purgas y reset (NO contra producción)
```

## Convenciones

- **Fechas de rango**: `YYYY-MM-DD`, interpretadas como día civil en `America/Montevideo`.
- **Ciclo lectivo**: si omitís `schoolYearId` se usa el activo; `allYears=1` desactiva el filtro.
- **Parámetros opcionales**: vienen deshabilitados (tildados en gris) en cada request. Activá los que necesites.
- **IDs encadenados**: los listados guardan solos el primer ID en variables de entorno (`userId`, `eventId`,
  `courseId`, …), así podés correr una carpeta de arriba hacia abajo sin copiar y pegar.
- **Endpoints de dispositivo** (`/biometric/adms-ingest`, `/iclock/*`) y webhooks no llevan cookie: se
  autentican por secreto de dispositivo, SN e IP permitida.

## Dos detalles del dominio que conviene saber

**Las faltas no son filas.** Una ausencia se deriva comparando la designación planificada contra las marcas
existentes; solo se materializa en `Attendance` cuando alguien la justifica o la marca. En los filtros,
`status=ABSENCES` es un centinela que agrupa `ABSENT_NOT_JUSTIFIED` + `ABSENT_JUSTIFIED` + `SUBSTITUTED`.

**Las horas de liquidación son nominales.** El export `payroll_novedades` suma las horas de la *designación*,
no las biométricas: el titular cobra sus horas asignadas y las faltas descuentan como concepto aparte.
La huella es control, no base de cálculo.

## Regenerar la colección

La colección se generó a partir de las rutas reales del repo. Si agregás endpoints, actualizá el generador
y volvé a correrlo, en vez de editar el JSON a mano.
