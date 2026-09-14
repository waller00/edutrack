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
| `ADSCRIPTO` | Adscripto | Control de libretas y observaciones; **no visa** |
| `DIRECCION` | Dirección | Único rol que **visa** libretas; indicadores académicos |
| `INSPECCION` | Inspección | Consulta libretas y registra observaciones; **no puede visar ni modificar visados** |
| `STUDENT` | Estudiante | Rol reconocido en modelo; **sin panel operativo** en home (lista vacía) |
| Perfiles personalizados | Configurables | Matriz de permisos editable por administrador |

> **Nota:** Los roles built-in de permisos son **ADMIN, TEACHER, STAFF, ADSCRIPTO, DIRECCION e INSPECCION**. `STUDENT` existe en el modelo pero sin panel operativo. No hay rol `PADRE` ni `DOCENTE` (ese era nomenclatura antigua).

> **Por qué built-in y no perfiles personalizados:** que el visado quede sólo en Dirección y que
> Inspección no pueda tocarlo es una regla del reglamento, no una preferencia de configuración.
> Vive en el catálogo de permisos (`gradebook.endorse` sólo lo tiene `DIRECCION`), no en un `if`
> de una ruta ni en cómo un administrador arme una matriz a mano. La lista canónica está en
> `backend/src/identity/org-role-seed.ts` y su matriz en `profile-permissions-defaults.ts`.

### 3.2 Sistema de permisos granulares

Los permisos se expresan como `módulo.acción` con alcance **`own`** (solo lo propio) o **`all`** (institucional). El menú y las APIs validan `permissionIds` del usuario.

**Permisos por defecto del administrador (ejemplos):**

- Usuarios: ver, crear, editar, seguridad (bloqueo, reset contraseña).
- Asistencias: ver, editar, eliminar, registro biométrico.
- Eventos: ver, crear, editar, cancelar, eliminar.
- Licencias: CRUD completo.
- Analytics, reportes, exportaciones.
- Ciclos lectivos, cursos, estudiantes (matrícula).
- Configuración del sistema, auditoría, gestión de perfiles.

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

---

## 11. Incidencias de asistencia

- Tipos: llegada tarde, no-show docente, salida anticipada, etc.
- Generación automática desde biométrico/monitor o gestión asociada a eventos.
- API dedicada (`attendance-incidents`).

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

## 11 ter. Libreta digital de calificaciones

Libreta por asignatura y grupo, con EduTrack como **fuente de verdad** de las notas. Reemplaza al
puente Excel hacia Moodle, que no persistía nada y era sólo para administración.

**Módulo propio, fuera de Académico:** todo vive bajo `/libreta`. La metáfora es el Libro del
Profesor de papel — una libreta es un libro con capítulos siempre visibles a la izquierda, no una
pantalla con paneles apilados.

**Pantallas del docente:** `/libreta` (mis libretas, con filtros Libreta / Asignatura / Docente) y
`/libreta/[id]`, que abre el Libro del Profesor con sus siete secciones:
`planificacion`, `desarrollo`, `evaluaciones`, `inasistencias`, `cierre`, `visados` y `mensajes`.
Cada sección lleva en el menú una línea que explica para qué sirve: "Precierre" o "Visados" no se
entienden solos.

**Pantallas de supervisión:** `/libreta/grupo` (matriz), `/libreta/visado`, `/libreta/reunion`,
`/libreta/indicadores`, `/libreta/estudiante/[id]` (ficha) y `/libreta/configuracion`
(parametrización académica). Entradas globales de trabajo: `/libreta/inasistencias`,
`/libreta/evaluaciones`, `/libreta/cierre-alumno` y `/libreta/cierre-libreta`.

- **Unidad:** una libreta es `(ciclo, oferta de curso, orientación opcional, asignatura)`. En
  EduTrack el "grupo" es el curso más su orientación —no hay grupos paralelos—, así que esa clave
  coincide exactamente con la que la integración Moodle deriva de un evento: la libreta y su curso
  Moodle `SUBJECT_COURSE` son la misma cosa vista desde dos lados (`GradeBook.scopeKey`).
- **Generación automática:** las libretas se derivan de los eventos de clase del ciclo
  (`POST /admin/academic-config/gradebooks/provision`). No hay tabla de asignación docente: quién
  dicta qué sólo existe en el horario. Es idempotente y respeta la oferta del ciclo (un curso no
  ofertado no genera libretas).
- **Acceso:** el titular y el suplente que cubrió alguna de sus clases. Adscripción, Dirección e
  Inspección leen todas las del centro pero **no** califican: leer y escribir son permisos
  distintos (`gradebook.read` vs `gradebook.grade`).
- **Calificar y planificar también son permisos distintos.** `gradebook.grade` cubre evaluaciones,
  notas y juicios conceptuales; `gradebook.plan`, la planificación y el desarrollo del curso.
  Dirección tiene `plan` con alcance ALL y no tiene `grade`, así que corrige la libreta de un
  docente sin poder tocar una calificación ni un juicio — que es exactamente lo que pide el liceo.
- **Parametrización (RF-044, RF-050, RF-041):** escalas con sus tramos y descriptores, períodos por
  ciclo **y nivel** —EBI y EMS tienen calendarios distintos— y tipos de actividad. Todo se edita
  desde administración, sin tocar código.
- **Calificaciones:** los valores se guardan en **centésimos** (`8` → `800`), como `amountCents`,
  para que la comparación contra umbrales sea exacta. El tramo de la escala se deriva del valor;
  el descriptor no se persiste.
- **Historial (§6.2):** toda escritura que cambie una nota ya cargada deja una fila en
  `GradeRevision` con valor anterior, nuevo, autor, origen y motivo. Reenviar el mismo valor no
  escribe ni audita. La primera carga no genera revisión.
- **Ventana de edición:** el docente edita durante `gradebookEditWindowDays` (30 por defecto) desde
  la fecha de la evaluación. Después sólo `gradebook.manage`, y esa escritura se audita esperando
  el write y se marca con origen `ADMIN_CORRECTION`.
- **Snapshot de identidad:** cada calificación copia apellido, nombre y documento, igual que el
  pase de lista: una baja o un cambio de nombre no reescriben una nota ya puesta.
- **Ciclo cerrado:** las libretas pasan a `ARCHIVED` y son de sólo lectura para todos, incluida
  administración.
- **Cierre de período (RF-051, RF-052):** el docente registra la calificación general y el juicio
  conceptual de cada estudiante y cierra el período. El cierre **valida contra la configuración
  del período**: si exige calificación o juicio, no cierra hasta completarlos, y devuelve la lista
  entera de lo que falta para que la UI la marque de una vez. Se registra si el cierre quedó fuera
  del plazo del período (§5.9).
- **La libreta del docente no promedia.** El liceo fue explícito: la calificación general del
  período la decide el docente. Al cerrar se muestra cuántas notas cargó —para ver a quién le
  falta—, no un promedio. El indicador automático de RF-061 vive donde se usa de verdad: la matriz
  institucional y la planilla de reunión, con un decimal, para escolaridad y abanderados. Ahí
  tampoco se persiste: guardarlo lo convertiría de a poco en la calificación oficial.
- **Inasistencias globales y media falta.** El liceo cuenta las faltas del estudiante **en el
  liceo**, no por materia: `GET /gradebook/:id` las devuelve del ciclo entero. Cada marca lleva un
  peso en centésimos (`100` = falta entera, `50` = media) que fija **adscripción caso por caso** al
  justificar — no hay regla automática. Justificar es de adscripción (`student-attendance.justify`),
  no del docente, que sólo marca presente/tarde/ausente.
- **Conducta, dos veces.** Cada docente pone la de su asignatura junto a la nota del período
  (`PeriodGrade.conductValueHundredths`), y adscripción pone una institucional por estudiante y
  período (`StudentConductRecord`). La reunión las ve juntas. Usa su propia escala (`CONDUCTA`),
  porque no se mide como el rendimiento.
- **Reunión (`/libreta/reunion`):** la matriz del grupo con rendimiento, conducta e inasistencias en
  la misma fila, el promedio con **un decimal** —hace falta para escolaridad y abanderados— y el
  registro de decisiones sobre `TeacherMeetingRecord`.
- **Boletín (`GET /admin/gradebook/report-card/:studentId?periodId=`):** PDF por estudiante y
  período con nota y juicio de **todas** sus asignaturas, conducta, promedio e inasistencias. Es la
  única salida transversal: el resto de las exportaciones son por libreta, o sea de una materia.
- **Control de adscripción (`/libreta/control`):** qué libretas están incompletas en un período,
  con cuántos estudiantes faltan en cada una, y aviso al docente por notificación interna diciendo
  exactamente qué falta.
- **Hoja del estudiante (`GET /gradebook/:id/students/:studentId`):** dentro de la libreta, el
  docente abre a cualquier estudiante de **su** grupo y ve foto, nacimiento, de dónde vino el pase o
  cómo promovió el año anterior, si está derivado a APE, las materias que arrastra y las
  adecuaciones vigentes. Está ahí y no en una ficha aparte porque es lo que se tiene en cuenta al
  calificar. Las adecuaciones guardan el tipo, un resumen y un **enlace**: el informe nunca entra al
  sistema (ver `docs/POLITICA_PRIVACIDAD.md` §4 bis).
- **Descriptor (RF-053):** se deriva al leer del tramo de la escala, nunca se guarda. Un cambio en
  la redacción reglamentaria no reescribe libretas viejas.
- **Un período cerrado congela sus evaluaciones**, no sólo la calificación general: si no, se
  podría cambiar una nota parcial después del cierre y el cierre dejaría de significar algo.
- **Reapertura:** sólo `gradebook.manage`, con motivo obligatorio y auditoría garantizada. **No
  borra el cierre previo** (`closedAt` y `closedByUserId` se conservan): es lo que permitirá que un
  visado hecho sobre el cierre anterior siga existiendo (RF-083).
- **Importación desde Moodle (§11 ter · Moodle):** previsualizar y confirmar. Idempotente por
  `(libreta, ítem de Moodle)`, convierte proporcionalmente a la escala elegida y **nunca toca un
  período cerrado**. Detalle en `docs/MOODLE_INTEGRACION.md`.

### Vistas institucionales (RF-031, RF-060, RF-061, RF-070)

**Pantallas:** `/libreta/grupo` (matriz de grupo), `/libreta/estudiante/[id]` (ficha
académica) y `/libreta/reunion` (modo reunión). Permiso `gradebook.read` de alcance ALL:
adscripción, dirección, inspección y administración.

- **Matriz Estudiante × Asignatura** del período, con calificación, juicio, descriptor, pendientes
  y alertas. Un grupo ve **las asignaturas de su orientación más las de tronco común** — la
  contracara exacta del roster; quedarse sólo con las de la orientación dejaría media matriz vacía.
- **Promedio transversal (RF-061):** indicador automático, derivado al leer y nunca persistido. Una
  asignatura pendiente no lo arrastra: "todavía no tiene nota" no es "sacó poco".
- **Ficha académica (RF-031):** trayectoria por ciclo, histórico por materia y período, y evolución
  por asignatura. Un período sin datos se conserva como hueco; borrarlo haría que dos períodos
  separados parecieran consecutivos.
- **Riesgo (§5.7):** se marca al estudiante con N o más asignaturas en tramo de alerta (umbral
  configurable, 3 por defecto) y el descenso sostenido exige **tres** bajas consecutivas: dos
  puntos son ruido, no tendencia. Las alertas son informativas y no generan por sí solas
  decisiones administrativas, promociones ni sanciones.
- **Reunión de profesores (RF-070):** la misma matriz en tamaño de proyección, más
  `TeacherMeetingRecord` para registrar decisiones sobre un estudiante o sobre el grupo.

### Visado (RF-080 a RF-083)

**Pantalla:** `/libreta/visado`.

- **Append-only.** El estado vigente de cada sección es su última fila; nada se actualiza ni se
  borra. Una observación posterior a un visado no lo elimina, lo **sucede**, y el visado anterior
  sigue consultable con su autor y su fecha. Eso es RF-083 por construcción, no por convención.
- **Secciones independientes (RF-081):** Calificaciones, Cierre del período y Juicios conceptuales,
  más `ALL` para el visado del período.
- **Sólo se visa lo cerrado.** Un período abierto no llega a la grilla: no hay nada firme que visar
  mientras el docente todavía puede cambiar una nota.
- **Visado final (RF-082):** se habilita cuando ninguna sección obligatoria queda observada. Una
  sección sin revisar no bloquea (puede que no hubiera nada que objetar); una observación viva sí,
  hasta que se marque corregida.
- **Quién hace qué:** observar es de adscripción, dirección e inspección (`gradebook.review` o
  `gradebook.inspect`); **visar es sólo de Dirección** (`gradebook.endorse`).
- **Protección del visado de Dirección.** Sobre una sección ya visada **sólo puede escribir quien
  tiene `gradebook.endorse`**. Sin esa regla, como el estado vigente es la última fila, una
  observación de Inspección —o de Adscripción— revertiría de hecho el visado sin tener la
  atribución para hacerlo. Es lo que cumple la nota funcional del pliego.
- **Antigüedad del pendiente** en la grilla, para priorizar (§5.9), junto con la marca de cierre
  fuera de plazo.
- El rol del actor se **congela** en cada evento: si mañana cambia de rol, el historial sigue
  diciendo con qué atribución se visó.

### Observaciones, mensajería y accesos (RF-090, RF-091, RF-100)

- **Espacio de intercambio** por libreta, con hilos: docente ↔ adscripción ↔ dirección ↔
  inspección. Cualquiera que pueda leer la libreta lee el intercambio; separarlo por rol lo
  volvería inútil. Un hilo no puede cruzar libretas.
- Va **separado de la cadena de visado** a propósito: acá viven las consultas y aclaraciones; en
  `Endorsement` sólo lo que cambia un estado formal.
- **Avisos (RF-091):** observación, visado y mensaje nuevo llegan por la campana que ya existe
  (`InAppNotification`), con tipos propios para poder filtrarlos. Nunca se avisa a quien originó
  la acción, y **un fallo del aviso jamás interrumpe lo que lo originó**: observar o visar queda
  firme aunque la notificación no salga.
- **Registro de acceso (RF-100):** cada apertura de una libreta deja usuario, rol, fecha e IP en
  `GradeBookAccessLog`. Es tabla aparte de `AuditLog` a propósito —alto volumen y retención
  distinta—; mezclarlas sepultaría la auditoría real bajo las consultas. Se escribe
  *fire-and-forget*: si falla, la lectura responde igual.

### Exportaciones (RF-120)

Desde `/libreta/[id]`, con permiso `exports.create`.

- **Excel**: una hoja de calificaciones —una columna por evaluación— más una hoja de cierre por
  período, con calificación, descriptor y juicio conceptual. Sirve de archivo del año entero.
- **PDF de la libreta** y **informe individual** por estudiante, con sus períodos cerrados, el
  descriptor y el estado de visado.
- Los valores van al Excel como **número**, no como texto: una planilla de notas se ordena y se
  promedia, y una columna de strings lo impide. El formato de celda respeta los decimales de la
  escala. El *ausente* se distingue del *sin calificar*: uno dice "Ausente", el otro queda vacío.
- Todo documento lleva impreso de qué libreta, ciclo y docente salió, más la fecha de emisión: una
  hoja suelta sin eso no dice a qué grupo pertenece.
- La descarga va por `fetch` + blob y no por un enlace directo, porque la API vive en otro origen
  y la sesión viaja en cookie: un `<a href>` plano daría 401.

### Backoffice de inteligencia académica (§5, RF-200)

**Pantalla:** `/libreta/indicadores`, permiso `academic-analytics.read` de alcance ALL.

- **Tres bloques** como pide el pliego: *Estudiantes* (total, evaluados, sin evaluaciones, en
  alerta, con mejora, con descenso), *Rendimiento* (promedio, mediana, distribución por tramo) y
  *Gestión de libretas* (completas, incompletas, cierres y visados pendientes, % visadas, cierres
  fuera de plazo).
- **Promedio y mediana van juntos, no uno en lugar del otro:** una distribución con pocos
  resultados muy bajos mueve el promedio y no la mediana, y esa diferencia es la señal.
- **Comparativas** por asignatura, curso y ciclo lectivo, con el porcentaje de resultados en tramo
  de alerta (§5.3 a §5.5).
- **Umbrales configurables (§5.7)** en `AcademicAlertRule`, con **vigencia por ciclo (RF-200)**: la
  regla del año pisa a la general, así una comparativa histórica se evalúa con el umbral que regía
  entonces y no cambia sola cuando alguien mueve el actual.
- **Sin repositorio analítico aparte.** A escala de un liceo la separación que sugiere §5.10 no
  compensa, y un agregado persistido se desactualiza sin que nadie se entere: todo se deriva al
  leer del mismo esquema transaccional.
- **La distribución se muestra como gráfico y como tabla.** El gráfico no puede ser la única
  lectura: sin la tabla, el dato depende del color.
- El dashboard devuelve y muestra la aclaración del pliego: las alertas son informativas, no
  generan automáticamente decisiones administrativas, promociones ni sanciones, y los indicadores
  de gestión no constituyen por sí solos un mecanismo de evaluación del desempeño docente.

### Históricos y cierre de año (RF-110, RF-111)

- **Al cerrar el ciclo** (`POST /admin/school-years/:id/close`) sus libretas pasan a `ARCHIVED`.
  No se copia ni se mueve nada: el estado es lo que bloquea la escritura, y la consulta queda
  abierta para quien tenga permiso.
- **Todo lo que escribe queda bloqueado**: calificar, cerrar o reabrir períodos, importar de
  Moodle, visar y publicar mensajes responden `SCHOOL_YEAR_CLOSED`. Ni administración con
  `gradebook.manage` puede escribir.
- **Lo que sigue disponible**: leer la libreta, el hilo de mensajes, la matriz de grupo, la ficha
  del estudiante, el backoffice y **las exportaciones** — consultar un histórico incluye poder
  imprimirlo.
- **Cerrar el año no exige que todo esté cerrado y visado.** Un año lectivo termina en una fecha,
  no cuando el último docente completó su libreta; bloquearlo dejaría a la institución sin poder
  pasar de año. La respuesta informa cuántos períodos quedaron abiertos.
- **Reabrir el ciclo** devuelve las libretas a `ACTIVE`. Existe porque cerrar un año por error es
  plausible y sin eso la única salida sería tocar la base a mano. **No reabre los períodos**: cada
  uno conserva su estado y su historial de visado.

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

## 15. Auditoría

**Pantalla:** `/admin/audit`  
**Permiso:** `audit.read`

- Registro de acciones relevantes (quién, qué, cuándo, metadatos).
- Consulta desde la interfaz de auditoría.
- Trazabilidad para cumplimiento y soporte.

---

## 16. Configuración del sistema

**Pantalla:** `/admin/settings`

Secciones:

1. **Sistema:** monitor automático de asistencia (activo, intervalo).
2. **Asistencia:** tolerancias no-show, tarde, puente entre clases, umbral de tarde biométrica.
3. **Identidad:** activación de verificación Didit / prueba de vida en registro.

Valores persistidos en tabla `SystemSettings`.

---

## 17. Integración Moodle (opcional)

Cuando `MOODLE_BASE_URL` y `MOODLE_WS_TOKEN` están configurados:

- **Alta/actualización de usuario Moodle** al aprobar cuenta o al asignar eventos (`ensureMoodleUser`, `ensureMoodleUserById`).
- Comunicación interna Docker (`http://moodle:8080`) y URL canónica pública para enlaces (`MOODLE_CANONICAL_HOST`).
- Despliegue separado: `docker-compose.moodle.yml` (no forma parte del pipeline cloud principal por defecto).
- Servicio externo Edutrack en Moodle debe estar **habilitado** con token REST válido.

Además de la provisión de cuentas y la matriculación, EduTrack **importa** las calificaciones del
libro de Moodle hacia su libreta digital (ver §11 ter y `docs/MOODLE_INTEGRACION.md`). La
importación es unidireccional: EduTrack es la fuente de verdad y **no** escribe notas en Moodle.

---

## 18. Pantallas y rutas web (mapa)

### Públicas / auth
`/login`, `/register`, `/register-step-by-step`, `/verify`, `/onboarding`, `/register/didit-return`

`/forgot` y `/reset` redirigen al login de Keycloak (recupero gestionado en el IdP).

### Administración
`/admin/users`, `/admin/attendance`, `/admin/events`, `/admin/licenses`, `/admin/school-years`, `/admin/school-years/compare`, `/admin/courses`, `/admin/students`, `/admin/student-attendance`, `/admin/analytics`, `/admin/settings`, `/admin/profiles`, `/admin/audit`, `/admin/train-dni`, `/admin/test-preprocessing`

### Personal (rutas legacy por rol)
`/teacher/*`, `/staff/*` — equivalentes a módulos “mis …”

### Unificadas “mis datos”
`/me/attendance`, `/me/events`, `/me/licenses`, `/me/roll-call`, `/me/roll-call/[eventId]/[ymd]`

### Libreta digital (módulo propio, §11 ter)
Docente — `/libreta`, `/libreta/[id]` y sus secciones. Dentro de la libreta hay un **selector de
grupo** que conserva la sección abierta: el docente entra una vez y cambia de grupo sin salir.
`/libreta/[id]/{planificacion,desarrollo,evaluaciones,inasistencias,cierre,visados,mensajes}`.

Trabajo transversal — `/libreta/inasistencias`, `/libreta/evaluaciones`, `/libreta/cierre-alumno`,
`/libreta/cierre-libreta`.

Supervisión y parametrización — `/libreta/grupo`, `/libreta/control`, `/libreta/visado`, `/libreta/reunion`,
`/libreta/indicadores`, `/libreta/estudiante/[id]`, `/libreta/configuracion`.

### General
`/`, `/profile`, `/notifications` (`/student/attendance` es legacy y redirige a `/me/roll-call`)

El menú lateral (`UserNav`) agrupa entradas según **permisos**, no solo por rol fijo.

---

## 19. API REST (módulos principales)

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

Todas las rutas protegidas validan sesión BFF (`authGuard` + cookie `sid`) y, donde aplica, permisos granulares.

---

## 20. Operación, despliegue y datos

- **Local:** `docker compose up` → Postgres + Redis + Keycloak + API (`:4000`) + Web (`:3000`).
- **Cloud/testing:** `docker-compose.cloud.yml`; Moodle manual con `docker-compose.moodle.yml`.
- Esquema BD: `backend/prisma/schema.prisma`; `prisma db push` al arrancar auth.
- Copias de seguridad y restore: `scripts/` + `docs/TESTING_DB_RESTORE.md` + `docs/CIBERSEGURIDAD_CONTINUIDAD.md`.
- Zona horaria operativa: **Uruguay** para días de asistencia y bloques de clase.
- Índice de docs: `docs/README.md`.

---

## 21. Funcionalidades no implementadas o fuera de alcance actual

Funcionalidades **no** implementadas:

| Tema | Estado |
|------|--------|
| Predicción ML de inasistencias | **No implementado** en el código actual |
| Portal padres/tutores (rol PADRE) | **No implementado** como rol operativo |
| App móvil nativa | **No**; web responsive |
| Sincronización **bidireccional** Moodle (escribir notas en Moodle) | **No**; la importación es sólo Moodle → EduTrack |
| Portal de consulta para estudiantes y familias | **No**; la libreta es para el personal del liceo (docente, adscripción, dirección, inspección) |
| Pagos en línea de cuotas estudiantiles | **No**; solo registro administrativo de cuotas |
| Control de asistencia estudiantil **por biométrico** | **No**; el biométrico es solo para personal. La asistencia de alumnos la carga el docente (ver §11 bis) |
| Autogestión del alumno (ver su propia asistencia) | **No**; `Student` no tiene cuenta ni rol. Se consulta desde administración |

---

## 22. Resumen por actor

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
