# EduTrack — Catálogo de funcionalidades

Documento de referencia del **conjunto de funcionalidades implementadas** en el proyecto EduTrack (mayo 2026), alineado con el código en producción y desarrollo. Describe qué hace el sistema, para quién y cómo se integra con servicios externos.

---

## 1. Propósito del sistema

EduTrack es una **plataforma de gestión administrativa integral** orientada a instituciones educativas (liceos, colegios). Centraliza:

- Identidad y acceso del **personal** (administradores, docentes/tutores, staff).
- **Asistencia** del personal (manual, biométrica y automática vinculada a eventos/clases).
- **Eventos y turnos** de trabajo o clase.
- **Licencias médicas/laborales** e **incidencias** de asistencia.
- Estructura **académica** por ciclo lectivo (cursos, materias, estudiantes administrativos).
- **Reportes, analítica y consultas** en lenguaje natural para administración.
- Integración opcional con **Moodle** (alta de usuarios vía API REST).
- Verificación de identidad en registro (**Didit** / prueba de vida) y **biométrico** vía protocolo ADMS.

---

## 2. Arquitectura técnica (resumen)

| Capa | Tecnología |
|------|------------|
| Backend | Node.js 20, Express, Prisma, PostgreSQL |
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS |
| Identidad | Keycloak (OIDC) + patrón **BFF**: tokens en Redis, cookie `sid` HttpOnly |
| Sesiones | Redis (`backend/src/auth/session-store.ts`) |
| Despliegue | Docker Compose (`docker-compose.yml` local, `docker-compose.cloud.yml` cloud) |
| Moodle (opcional) | Contenedor Bitnami, red Docker `edutrack_moodle-net`, Web Services REST |
| Biométrico | `POST /biometric/adms-ingest` + protocolo ADMS `/iclock/*` (F22) |

---

## 3. Roles y perfiles de acceso

### 3.1 Roles organizacionales (`OrgRole`)

| Código | Etiqueta habitual | Uso principal |
|--------|-------------------|---------------|
| `ADMIN` | Administrador | Gestión completa del sistema |
| `TEACHER` | Docente | Consulta de propias asistencias, eventos y licencias |
| `STAFF` | Staff | Igual que docente en módulos “propios” |
| `STUDENT` | Estudiante | Rol reconocido en modelo; **sin panel operativo** en home (lista vacía) |
| Perfiles personalizados | Configurables | Matriz de permisos editable por administrador |

> **Nota:** Los roles built-in de permisos son **ADMIN, TEACHER y STAFF**. `STUDENT` existe en el modelo pero sin panel operativo. No hay rol `PADRE` ni `DOCENTE` (ese era nomenclatura antigua).

### 3.2 Sistema de permisos granulares

Los permisos se expresan como `módulo.acción` con alcance **`own`** (solo lo propio) o **`all`** (institucional). El menú y las APIs validan `permissionIds` del usuario.

**Permisos por defecto del administrador (ejemplos):**

- Usuarios: ver, crear, editar, seguridad (bloqueo, reset contraseña).
- Asistencias: ver, editar, eliminar, registro biométrico.
- Eventos: ver, crear, editar, cancelar, eliminar.
- Licencias: CRUD completo.
- Analytics, reportes, exportaciones.
- Ciclos lectivos, cursos, estudiantes (matrícula).
- Configuración del sistema, auditoría, asistente de consultas, gestión de perfiles.

**Docente y staff (por defecto):** lectura de propias asistencias, eventos, licencias y notificaciones.

Los administradores pueden **crear perfiles personalizados** y asignar permisos adicionales o distintos desde **Roles / Perfiles**.

### 3.3 Ciclo lectivo en contexto admin

En vistas de administración, el **año lectivo activo** filtra listados (asistencias, eventos, cursos, etc.). Opción **“Ver todos los ciclos”** para consultas transversales.

---

## 4. Autenticación, registro e identidad

### 4.1 Inicio de sesión (Keycloak + BFF)

- Pantalla de login en **Keycloak** (tema `edutrack`), redirigida desde `GET /auth/login`.
- Flujo OIDC Authorization Code + PKCE; callback en `GET /auth/callback`.
- Cookie HttpOnly `sid` → sesión server-side en **Redis** (tokens OIDC no van al navegador).
- **Google OAuth** como identity provider en Keycloak (`?provider=google`).
- **2FA TOTP** configurable en Keycloak (portal de cuenta vía `/auth/account/2fa`).
- Refresh de tokens OIDC: `POST /auth/refresh`.
- Rate limiting en `/auth/login`.
- Frontend: `/login` comprueba sesión con `/auth/me` o redirige al BFF.

### 4.2 Registro de nuevos usuarios

- Alta en la app (`POST /auth/register`) con datos de perfil.
- Contraseña creada en **Keycloak** (`createKeycloakUser`).
- **Verificación de email** (enlace/código).
- **Cloudflare Turnstile** en registro cuando está configurado.
- **Prueba de vida / Didit** (workflow configurable): obligatoria salvo bypass de desarrollo o entorno de tests.
- Flujos UI: `/register`, `/register-step-by-step`, `/register/didit-return`, `/verify`.
- Tras registro: **pendiente de aprobación** hasta que un admin apruebe la cuenta.

### 4.3 Recupero y seguridad de cuenta

- Recupero y cambio de contraseña: flujos de **Keycloak** (`/auth/account/password`, portal de cuenta).
- Bloqueo/desbloqueo y reset de contraseña por administrador (Admin API Keycloak).
- Onboarding y perfil (`/onboarding`, `/profile`).
- Auditoría de acciones sensibles.

### 4.4 Procesamiento de documento (DNI)

- Ruta administrativa **entrenamiento/preprocesado DNI** (`/admin/train-dni`, API `dni-processor`) para flujos de captura de documento en registro.

---

## 5. Gestión de usuarios (administración)

**Pantalla:** `/admin/users`

- Listado con filtros (rol, estado aprobación, activo/inactivo, búsqueda).
- Creación y edición de usuarios del personal.
- Asignación de rol/perfil organizacional.
- Aprobación de registros pendientes → dispara **sincronización Moodle** si la integración está activa.
- Desactivación, bloqueo, reset de contraseña.
- Vinculación con datos de contacto y documento.
- Notificaciones al usuario ante cambios relevantes.

---

## 6. Ciclos lectivos, cursos y materias

### 6.1 Ciclos lectivos

**Pantalla:** `/admin/school-years`

- CRUD de años lectivos (fechas, estado activo).
- Un ciclo **activo** a la vez para operaciones por defecto.
- Comparación entre ciclos (`/admin/school-years/compare`).

### 6.2 Cursos y asignaturas

**Pantalla:** `/admin/courses`

- Catálogo de **cursos por ciclo lectivo** (p. ej. orientaciones distintas = cursos distintos).
- **Materias/asignaturas** asociadas a cada curso.
- Asignación de docentes a materias donde aplica.
- Soporte a bloques de clase contiguos para lógica de asistencia docente.

### 6.3 Días no laborables

- API de **días no laborables** (`non-working-days`) para calendario institucional.

---

## 7. Estudiantes (matrícula administrativa)

**Pantalla:** `/admin/students`

Registro **sin login obligatorio** del alumnado:

- Datos personales, documento, curso, ciclo lectivo.
- Contacto, tutor, dirección, notas de acceso al liceo.
- Vencimiento de ficha médica.
- Estados de matrícula: activo, retirado, egresado, transferido.
- **Cuotas**: seguimiento anual y/o mensual (pagado, monto, notas).
- Filtros por ciclo lectivo y curso.

**Pantalla estudiante con cuenta:** `/student/attendance` (consulta limitada si el usuario tiene rol STUDENT y permisos).

---

## 8. Eventos y turnos

**Administración:** `/admin/events`  
**Propias:** `/me/events`, `/teacher/events`, `/staff/events`

- Creación de **eventos** (turnos, clases, reuniones) con fecha/hora, tipo, usuario asignado.
- Asociación a **ciclo lectivo** y, cuando corresponde, curso/materia.
- Estados: programado, en curso, finalizado, cancelado.
- Cancelación y edición con permisos.
- Al asignar usuario a evento → **ensure Moodle user** si integración activa.
- Notificaciones in-app a usuarios afectados.
- Filtros por fecha, usuario, curso, ciclo.

---

## 9. Asistencias

### 9.1 Gestión administrativa

**Pantalla:** `/admin/attendance`

- Listado institucional con filtros: fechas, usuario, tipo (entrada/salida), estado, rol, ciclo lectivo.
- Alta/edición/baja manual de registros (según permisos).
- Estados típicos: presente, tarde, ausente, salida anticipada, etc.
- Vinculación opcional a **evento** del día.
- Exportación a **Excel y PDF** (ver sección Reportes).

### 9.2 Vista personal

- `/me/attendance`, `/teacher/attendance`, `/staff/attendance`: historial propio.

### 9.3 Biométrico (ADMS)

**Protocolo ZKTeco iClock (F22, push directo):** rutas `/iclock/*` en puerto **8081** (y también en el puerto API). El terminal envía ATTLOG; ver `docs/BIOMETRICO_F22.md`.

**Endpoint JSON:** `POST /biometric/adms-ingest`

- Autenticación por secreto del dispositivo (`x-biometric-secret`) e identificación `deviceCode`.
- Mapeo **deviceUserId → usuario** (`BiometricUserMapping`).
- Registro de fichadas CHECK_IN / CHECK_OUT con timestamp.
- Idempotencia por `externalId` cuando se envía.
- Cálculo de **tardanza** según hora configurada en ajustes (`biometricLateHour/Minute`) y tolerancias.
- Asociación automática al **evento/clase** del instante (bloques contiguos para docentes).
- Creación de **incidencias** (llegada tarde, etc.) y reconciliación con licencias.
- Seed de mapeos de prueba: `prisma/seed-biometric-adms.mjs`.

### 9.4 Monitor automático de asistencia

- Job en backend que evalúa eventos con tolerancias configurables:
  - Minutos de gracia para **no-show** (ausencia sin marca).
  - Tolerancia de **tarde** respecto al inicio del evento.
  - Puente entre bloques de clase (`attendanceClassBridgeGapMinutes`).
- Intervalo y activación desde **Configuración del sistema**.

---

## 10. Licencias médicas y laborales

**Admin:** `/admin/licenses`  
**Propias:** `/me/licenses`, `/teacher/licenses`, `/staff/licenses`

- Registro de licencias con fechas, tipo, usuario, documentación.
- Estados activo/inactivo; impacto en reconciliación de asistencia e incidencias.
- Filtros por usuario, fechas y estado.
- El asistente de consultas puede listar licencias vigentes o históricas.

---

## 11. Incidencias de asistencia

- Tipos: llegada tarde, no-show docente, salida anticipada, etc.
- Generación automática desde biométrico/monitor o gestión asociada a eventos.
- API dedicada (`attendance-incidents`).
- Consultables vía **asistente de consultas** (abiertas/todas, por tipo, listado o conteo por persona).

---

## 11 bis. Pase de lista estudiantil

Concepto **distinto** de la asistencia del personal: `Attendance` registra al personal (marcas
biométricas, ligadas a `User`), mientras que el pase de lista lo carga el docente sobre sus
estudiantes, que no tienen cuenta en EduTrack. Son modelos y enums separados a propósito.

**Pantallas:** `/me/roll-call` (agenda del día del docente) y `/me/roll-call/[eventId]/[ymd]`
(la planilla, pensada para el celular). Control: `/admin/student-attendance`.

- **Estados:** Presente, Llegada tarde, Ausente, Ausente justificado. El docente marca los
  primeros tres; el justificado es acto de administración y deja una fila de transición
  (`StudentAttendanceJustification`) con motivo obligatorio, igual que en el personal.
- **Unidad:** una lista por **ocurrencia de clase**, identificada por `(eventId, día civil)`.
  Dos horas seguidas del mismo grupo son dos listas distintas.
- **Copiar la hora anterior:** si el mismo grupo ya tiene una lista tomada ese día, se ofrece
  precargarla. Es siempre una sugerencia que el docente confirma, y los alumnos que no estaban
  en la hora anterior quedan explícitamente sin marcar.
- **Cohorte:** se resuelve desde el evento con la misma precedencia que la integración Moodle
  (`courseOrientationId` > `orientationId` > tronco común) sobre las matrículas activas del ciclo.
- **Ventana de edición:** el docente edita durante N horas tras el fin de la clase
  (`studentRollCallEditWindowHours`, por defecto 48); después solo administración, con auditoría.
- **Listas sin pasar:** una clase terminada sin lista queda **pendiente**; no se generan faltas
  automáticas. Administración las ve en un panel por curso y fecha.
- **Faltas:** se guardan por clase. La consolidación diaria (presente / media falta / falta) se
  **deriva** al leer, según `studentDailyAbsenceThresholdPercent`. La llegada tarde cuenta como
  asistencia, y las clases sin lista tomada no entran en ningún denominador.
- **Suplencias:** el suplente oficial del día puede pasar la lista igual que el titular.

---

## 12. Notificaciones

**Pantalla:** `/notifications`

- **Notificaciones in-app** (campana): eventos asignados, cambios de cuenta, avisos operativos.
- **Web Push** (suscripción y envío vía API `web-push`) cuando el navegador lo permite.
- Permiso `notifications.read` (alcance own por defecto en docente/staff).

---

## 13. Analítica institucional

**Pantalla:** `/admin/analytics`

- KPIs de asistencia y operación institucional.
- Tendencias (p. ej. semanales), rankings, vistas agregadas.
- Orientada a **soporte a la decisión** administrativa.
- Requiere permiso `analytics.read`.

---

## 14. Reportes y exportaciones

Documentado en detalle en `docs/REPORTES.md`.

- **Excel (.xlsx)** y **PDF** desde gestión de asistencias.
- Reporte por usuario (estadísticas individuales, % asistencia).
- Reporte general o por filtros (fechas, estado, rol, tipo entrada/salida).
- Permisos: `reports.read`, `exports.create`.

---

## 15. Asistente de consultas (lenguaje natural)

**Pantalla:** `/admin/query-assistant`  
**Permiso:** `query-assistant.use`

El usuario escribe preguntas en español; un LLM clasifica la intención y el backend ejecuta consultas **solo lectura** sobre datos reales.

**Intenciones soportadas:**

| Intención | Ejemplo de consulta |
|-----------|---------------------|
| `HOURS_WORKED_SUMMARY` | Horas trabajadas por persona/período |
| `ATTENDANCE_INCIDENTS_SUMMARY` | Incidencias, quién faltó más, tardanzas abiertas |
| `MEDICAL_LEAVES_SUMMARY` | Licencias activas o históricas |
| `ASSIGNED_EVENTS_SUMMARY` | Eventos asignados en un rango |
| `BIOMETRIC_ISSUES_SUMMARY` | Problemas de fichadas biométricas (fallidas/pendientes) |
| `ATTENDANCE_LATE_SUMMARY` | Resumen de llegadas tarde |
| `USERS_ADMIN_SNAPSHOT` | Pendientes de aprobación, bloqueados, documento por vencer |
| `AUDIT_LOG_SUMMARY` | Registros de auditoría filtrados |

Parámetros extraíbles: año, mes, rango de fechas, búsqueda por nombre de usuario, alcance de estado, etc. Respuesta en tabla estructurada.

---

## 16. Auditoría

**Pantalla:** `/admin/audit`  
**Permiso:** `audit.read`

- Registro de acciones relevantes (quién, qué, cuándo, metadatos).
- Consulta desde UI y desde asistente de consultas.
- Trazabilidad para cumplimiento y soporte.

---

## 17. Configuración del sistema

**Pantalla:** `/admin/settings`

Secciones:

1. **Sistema:** monitor automático de asistencia (activo, intervalo).
2. **Asistencia:** tolerancias no-show, tarde, puente entre clases, umbral de tarde biométrica.
3. **Identidad:** activación de verificación Didit / prueba de vida en registro.

Valores persistidos en tabla `SystemSettings`.

---

## 18. Integración Moodle (opcional)

Cuando `MOODLE_BASE_URL` y `MOODLE_WS_TOKEN` están configurados:

- **Alta/actualización de usuario Moodle** al aprobar cuenta o al asignar eventos (`ensureMoodleUser`, `ensureMoodleUserById`).
- Comunicación interna Docker (`http://moodle:8080`) y URL canónica pública para enlaces (`MOODLE_CANONICAL_HOST`).
- Despliegue separado: `docker-compose.moodle.yml` (no forma parte del pipeline cloud principal por defecto).
- Servicio externo Edutrack en Moodle debe estar **habilitado** con token REST válido.

EduTrack **no** sincroniza calificaciones ni contenidos de cursos Moodle en esta versión; el alcance es **provisión de cuentas de usuario**.

---

## 19. Pantallas y rutas web (mapa)

### Públicas / auth
`/login`, `/register`, `/register-step-by-step`, `/verify`, `/onboarding`, `/register/didit-return`

`/forgot` y `/reset` redirigen al login de Keycloak (recupero gestionado en el IdP).

### Administración
`/admin/users`, `/admin/attendance`, `/admin/events`, `/admin/licenses`, `/admin/school-years`, `/admin/school-years/compare`, `/admin/courses`, `/admin/students`, `/admin/student-attendance`, `/admin/analytics`, `/admin/query-assistant`, `/admin/settings`, `/admin/profiles`, `/admin/audit`, `/admin/train-dni`, `/admin/test-preprocessing`

### Personal (rutas legacy por rol)
`/teacher/*`, `/staff/*` — equivalentes a módulos “mis …”

### Unificadas “mis datos”
`/me/attendance`, `/me/events`, `/me/licenses`, `/me/roll-call`, `/me/roll-call/[eventId]/[ymd]`

### General
`/`, `/profile`, `/notifications` (`/student/attendance` es legacy y redirige a `/me/roll-call`)

El menú lateral (`UserNav`) agrupa entradas según **permisos**, no solo por rol fijo.

---

## 20. API REST (módulos principales)

| Prefijo / módulo | Responsabilidad |
|------------------|-----------------|
| `auth` | Login/logout OIDC (BFF), registro, verificación email, perfil, cuenta Keycloak |
| `admin` | Usuarios, aprobaciones, ajustes sistema, perfiles |
| `admin-school-years` | Ciclos lectivos |
| `admin-students` | Matrícula y cuotas |
| `courses` | Cursos y materias |
| `events` | Eventos y turnos |
| `attendance` | CRUD asistencias, listados |
| `attendance-incidents` | Incidencias |
| `student-attendance` | Pase de lista del docente por ocurrencia de clase |
| `admin-student-attendance` | Control: listas sin pasar, justificación de faltas, ficha por alumno |
| `medical-leaves` | Licencias |
| `biometric-adms` | Ingesta biométrica |
| `reports` / `exports` | Reportes Excel/PDF |
| `analytics` | KPIs |
| `in-app-notifications` | Notificaciones |
| `web-push` | Push subscriptions |
| `didit-liveness`, `didit-webhook` | Verificación identidad |
| `dni-processor` | Procesamiento documento |
| `non-working-days` | Calendario |
| Query assistant | Endpoint interno vía servicio (admin) |

Todas las rutas protegidas validan sesión BFF (`authGuard` + cookie `sid`) y, donde aplica, permisos granulares.

---

## 21. Operación, despliegue y datos

- **Local:** `docker compose up` → Postgres + Redis + Keycloak + API (`:4000`) + Web (`:3000`).
- **Cloud/testing:** `docker-compose.cloud.yml`; Moodle manual con `docker-compose.moodle.yml`.
- Esquema BD: `backend/prisma/schema.prisma`; `prisma db push` al arrancar auth.
- Copias de seguridad y restore: `scripts/` + `docs/TESTING_DB_RESTORE.md` + `docs/CIBERSEGURIDAD_CONTINUIDAD.md`.
- Zona horaria operativa: **Uruguay** para días de asistencia y bloques de clase.
- Índice de docs: `docs/README.md`.

---

## 22. Funcionalidades no implementadas o fuera de alcance actual

Funcionalidades **no** implementadas:

| Tema | Estado |
|------|--------|
| Predicción ML de inasistencias | **No implementado** en el código actual |
| Portal padres/tutores (rol PADRE) | **No implementado** como rol operativo |
| App móvil nativa | **No**; web responsive |
| Sincronización bidireccional Moodle (notas, tareas) | **No**; solo usuarios |
| Pagos en línea de cuotas estudiantiles | **No**; solo registro administrativo de cuotas |
| Control de asistencia estudiantil **por biométrico** | **No**; el biométrico es solo para personal. La asistencia de alumnos la carga el docente (ver §11 bis) |
| Autogestión del alumno (ver su propia asistencia) | **No**; `Student` no tiene cuenta ni rol. Se consulta desde administración |

---

## 23. Resumen por actor

| Actor | Puede hacer |
|-------|-------------|
| **Visitante** | Registrarse, verificar email, Didit (si activo), recuperar contraseña |
| **Usuario pendiente** | Completar perfil; sin módulos operativos hasta aprobación |
| **Administrador** | Todo lo anterior + usuarios, asistencias, eventos, licencias, académico, reportes, analítica, consultas, auditoría, configuración, perfiles |
| **Docente / Staff** | Ver propias asistencias, eventos, licencias; notificaciones; **pasar lista de sus clases** |
| **Estudiante** | Sin cuenta ni login. Es un registro administrativo: su matrícula, cuotas y asistencia las gestionan administración y sus docentes |
| **Dispositivo biométrico** | Enviar fichadas ADMS autenticadas |
| **Moodle** | Recibir usuarios creados/actualizados vía WS |

---

*Última revisión: mayo 2026. Fuente: código en `backend/`, `frontend/web/`, `docs/REPORTES.md`, `profile-permissions-defaults.ts`.*
