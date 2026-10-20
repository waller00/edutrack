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
- Alta con **aprobación manual** de cada cuenta nueva y **biométrico** vía protocolo ADMS.

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
- **Sin verificación de identidad en línea.** La prueba de vida con Didit se quitó, y con ella el paso
  de revisión: existía para confirmar los datos que Didit leía del documento contra los declarados, y
  sin esa lectura sólo repetía lo que el usuario acababa de escribir. El alta es **un formulario, un
  envío**, y la identidad la controla administración al aprobar la cuenta.
- Flujos UI: `/register` (`/register-step-by-step` redirige ahí), `/verify`, `/onboarding` (completar
  datos faltantes, p. ej. tras entrar con Google).
- Tras registro: **pendiente de aprobación** (`isApproved: false`) hasta que un admin apruebe la cuenta.

### 4.3 Recupero y seguridad de cuenta

- Recupero y cambio de contraseña: flujos de **Keycloak** (`/auth/account/password`, portal de cuenta).
- Bloqueo/desbloqueo y reset de contraseña por administrador (Admin API Keycloak).
- Onboarding y perfil (`/onboarding`, `/profile`).
- Auditoría de acciones sensibles.

---

## 5. Gestión de usuarios (administración)

**Pantalla:** `/admin/users`

- Listado con filtros (rol, estado aprobación, activo/inactivo, búsqueda).
- Creación y edición de usuarios del personal.
- Asignación de rol/perfil organizacional.
- Aprobación de registros pendientes (exige el correo verificado) → le llega un **correo de cuenta
  aprobada** y dispara la **sincronización Moodle** si la integración está activa. Una cuenta sin
  aprobar o dada de baja nunca se crea en Moodle, aunque ya tenga eventos asignados.
- **Rechazo** de una solicitud (`POST /admin/users/:id/reject`, motivo opcional): borra la cuenta, el
  acceso de Keycloak y las sesiones, y avisa por correo si la dirección estaba verificada. Sólo para
  cuentas sin aprobar y sin actividad (eventos, asistencias, licencias, libretas, suplencias, pases de
  lista ni cuenta Moodle); una cuenta con historia se da de baja.
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

## 9. Asistencia del personal

> Es la asistencia de **docentes y funcionarios**. La de los estudiantes es otra cosa: se pasa en
> el pase de lista (§11 bis) y se controla en "Asistencia de estudiantes". En pantalla, ninguna de
> las dos se nombra sin decir de quién es.

### 9.1 Gestión administrativa

**Pantalla:** "Asistencia del personal" (`/admin/attendance`)

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
- **Una licencia es de días enteros** (`services/medical-leave-dates.ts`): cubre desde las 00:00
  del primer día hasta el final del último en hora institucional, para la conciliación, la marca de
  entrada, las incidencias y la biometría. Se guarda con la fecha UTC del día; antes se comparaba
  ese instante y una licencia "del 3 al 7" iba de las 9:00 del 3 a las 9:00 del 7.
- **En vivo:** cargar una licencia justifica sólo las clases que ya terminaron. Las que vienen
  aparecen como ausencia justificada cuando termina cada una (la ausencia virtual ya mira las
  licencias); antes, cargar el lunes una licencia para el jueves creaba la ausencia del jueves en el
  momento. `npm run fix:license-future-absences` (dry-run; `-- --apply`) borra las ausencias
  futuras que creó el comportamiento anterior.
- **Desactivar o acortar** una licencia deshace lo que ya no cubre: lo que la licencia creó se
  borra (la ausencia vuelve a calcularse en vivo) y lo que justificó vuelve a sin justificar. No se
  tocan las justificaciones a mano ni lo que otra licencia vigente sigue cubriendo.
- **Ciclo lectivo:** la licencia no tiene ciclo propio; aparece en un ciclo si está vigente algún
  día de él, comparando días (antes una licencia que empezaba el último día del ciclo quedaba
  afuera). Un ciclo sin fechas cargadas es su año calendario; antes el filtro se ignoraba y se
  veían las licencias de todos los años. Al crear una licencia de otro ciclo, la pantalla avisa
  que no va a aparecer en la lista que se está mirando.
- **Filtros:** usuario, estado, tipo y un período (desde/hasta) que trae las licencias vigentes
  algún día de él, también las que empezaron antes o terminan después.
- **Lista paginada** (50 por página, ordenadas por fecha de la licencia) con los totales del
  filtro entero; antes se veían sólo las 20 cargadas más recientemente. El selector de personal
  trae a todos, también después del usuario 100.

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

- **Agenda del día del docente:** el día se elige con flechas o con la fecha, y viaja en la URL
  (`?date=`). Las clases se ordenan en **Ahora**, **Más tarde** y **Terminadas**.
  - Cada clase muestra el grupo, la asignatura, la hora y el estado de la lista: "Abre 09:50",
    "Pasá la lista", "Sin pasar", "Pasada 10:07" o "Fuera de plazo".
  - Con suplencia dice quién da la clase: "Suplencia: cubrís a …" o "La pasa … (suplencia)".
    Para administración dice "Docente: …".
- **La planilla dice qué clase es:**
  - el grupo y la asignatura;
  - el día en palabras, con la hora;
  - el titular o el suplente;
  - quién pasó la lista y a qué hora.
- **La lista abre 10 minutos antes de la clase** (`ROLL_CALL_OPENS_BEFORE_MINUTES`). Antes no se
  puede pasar, ni siquiera desde administración ni desde la libreta: nadie sabe todavía quién vino.
  El servidor responde `NOT_STARTED` con la hora de apertura (`opensAt`). La planilla abierta antes
  de hora se habilita sola al llegar esa hora.
- **Aviso en toda la app:** mientras la clase está abierta y la lista sin pasar, aparece una franja
  debajo del encabezado, en cualquier pantalla, con el botón "Pasar lista".
  - Si una clase de hoy terminó sin lista, la franja pasa a ámbar y se puede dejar para más tarde
    (una hora).
  - No avisa al titular que cubre un suplente, ni a quien tiene licencia ese día, ni en un día no
    laborable.
  - Datos: `GET /student-attendance/reminder`, siempre con las clases propias.
- **Administración ve el estado de cada lista del día:**
  - en "Clases del día" del Inicio, con "Listas pasadas: X de Y";
  - al tocar una clase en la Agenda: quién la pasó, a qué hora y cuántos presentes, tardes y
    ausentes hubo (`GET /admin/student-attendance/sessions/:eventId/:ymd/status`).
  - En los dos lugares hay enlace a la lista, si se puede pasar con alcance total.

- **Estados:** Presente, Llegada tarde, Ausente, Ausente justificado. El docente marca los
  primeros tres; el justificado es acto de administración y deja una fila de transición
  (`StudentAttendanceJustification`) con motivo obligatorio, igual que en el personal.
- **Unidad:** una lista por **ocurrencia de clase**, identificada por `(eventId, día civil)`.
  Dos horas seguidas del mismo grupo son dos listas distintas.
- **Presente por defecto:** una lista que nunca se pasó abre con todos presentes; el docente sólo
  toca a quien faltó o llegó tarde. Una lista ya pasada muestra lo guardado.
- **Marcación para celular:** cada estudiante tiene un único botón de estado, de al menos 48 px,
  que recorre **Presente → Ausente → Llegada tarde → Presente**. El color se acompaña con texto e
  icono. La búsqueda por nombre o documento conserva las marcas del grupo completo. El resumen y
  el botón Guardar quedan al pie, con indicación de cambios pendientes; durante el guardado se
  bloquea la edición para no perder marcas. Las notas son opcionales y se despliegan por alumno.
- **Copiar la hora anterior:** si el mismo grupo ya tiene una lista tomada ese día, se ofrece
  precargarla. Es siempre una sugerencia que el docente confirma, y los alumnos que no estaban
  en la hora anterior quedan explícitamente sin marcar (se les saca el "presente" por defecto).
- **Cohorte:** se resuelve desde el evento con la misma precedencia que la integración Moodle
  (`courseOrientationId` > `orientationId` > tronco común) sobre las matrículas activas del ciclo.
- **Ventana de edición:** se abre 10 minutos antes de la clase. El docente puede pasarla o
  corregirla **hasta una semana** después del fin de la clase (`studentRollCallEditWindowHours`,
  por defecto y como máximo 168 h). El plazo se cuenta siempre desde el fin de la clase: pasarla
  tarde no abre otra semana. Después solo administración, con auditoría.
- **Lista pasada fuera de hora:** si el docente (titular o suplente) pasa por primera vez la lista
  de una clase que ya terminó, Dirección recibe un aviso (`ROLL_CALL_LATE`, campana y push) con la
  clase, el día y cuándo se pasó. Las correcciones posteriores no vuelven a avisar.
- **Listas sin pasar:** una clase terminada sin lista queda **pendiente**; no se generan faltas
  automáticas. Administración las ve en un panel por curso y fecha.
- **Faltas:** se guardan por clase. La consolidación diaria (presente / media falta / falta) se
  **deriva** al leer, según `studentDailyAbsenceThresholdPercent`, y las clases sin lista tomada
  no entran en ningún denominador.
- **La llegada tarde es la media falta, en todos los niveles.** El docente ya no elige "Media
  falta" en la libreta: marca falta o llegada tarde. En bachillerato cada tarde suma 0,5 (EMS sigue
  contando por clase); una ausencia que adscripción graduó a media al justificarla se respeta y el
  docente no la pisa al volver a guardar el día.
- **Ciclo básico (EBI, 7.º a 9.º) cuenta la falta por día**, sin umbral:
  - faltar a **una sola** clase del día (sin justificar) ya es la falta del día;
  - una **llegada tarde** vale media falta y **no se justifica**;
  - una **ausencia justificada** vale media falta.

  El día vale la marca más pesada, no la suma: dos tardes son media falta, y tarde + ausencia es
  una falta (no una y media). En ciclo básico el peso manual (`absenceWeightHundredths`) se ignora
  y el docente no ve la opción "Media falta".
- **Justificativos** (certificado médico, viaje, duelo…): un período con motivo
  (`StudentAbsenceJustificationRange`) en "Asistencia de estudiantes" → "Justificativos".
  - Valen para estudiantes de **cualquier nivel**.
  - Los cargan sólo administración, dirección y adscripción (`student-attendance.justify` con
    alcance `all`); el docente no.
  - Puede ser **previo**: las ausencias que se marquen en esos días entran ya justificadas, a nombre
    de quien lo cargó.
  - O **posterior**: al cargarlo justifica las ausencias ya marcadas del período.
  - Cuánto cuenta la falta justificada lo decide el nivel: en ciclo básico vale media; en
    bachillerato sigue contando como falta, justificada.
  - La pantalla lista los últimos cargados del ciclo; el nombre abre al estudiante.
  - Si el docente marca presente o tarde, gana su marca.
  - Revocar un rango deja de aplicarlo de ahí en adelante, pero no deshace lo ya justificado.
- **Suplencias: un día cubierto, la lista es del suplente.**
  - La pasa el suplente oficial de ese día, y queda a su nombre.
  - Le llegan a él los avisos y figura como responsable en "Listas sin pasar"; el filtro por
    docente lo encuentra.
  - El titular ve la planilla de ese día pero no la pasa ("La pasa el suplente"). Administración
    sí puede.

---

## 11 ter. Libreta digital de calificaciones

Libreta por asignatura y grupo, con EduTrack como **fuente de verdad** de las notas. Reemplaza al
puente Excel hacia Moodle, que no persistía nada y era sólo para administración.

**Módulo propio, fuera de Académico:** todo vive bajo `/libreta`. La metáfora es el Libro del
Profesor de papel — una libreta es un libro con capítulos siempre visibles a la izquierda, no una
pantalla con paneles apilados.

**Pantallas del docente:** `/libreta` (mis libretas, con filtros Libreta / Asignatura / Docente) y
`/libreta/[id]`, que abre el Libro del Profesor. El menú depende de quién mira
(`sectionsFor` en `lib/libreta/menu.ts`):
- **Suplente:** sólo **Tus notas (suplencia)** (`evaluaciones`), con la lista del grupo. Ver
  "Acceso del suplente" más abajo.
- **Docente titular:** `planificacion`, `desarrollo`, `evaluaciones`, `cierre` y
  **Mensajes del director** (`mensajes`): lo que Dirección le observó en el visado y los hilos que le
  abrió, a los que responde.
- **Supervisión** (Dirección, adscripción, inspección): las mismas cuatro, de sólo lectura, y
  **Visado y seguimiento** (`visado`): visar cada reunión cerrada, seguir si el docente dio lo que
  planificó (planificación al lado del desarrollo clase a clase), leer el informe del grupo y
  escribirle al docente.

Una sección que no es de quien mira vuelve a la portada de la libreta. Las inasistencias ya no son
una sección: salen del pase de lista y se ven en la carta de cada alumno.
Cada sección lleva en el menú una línea que explica para qué sirve: "Precierre" o "Visado" no se
entienden solos. Contraído, el menú muestra la abreviatura de cada sección; en el celular las
secciones se eligen de un selector, para no empujar el contenido una pantalla hacia abajo.

**Pantallas de supervisión:** `/libreta/reunion` (matriz del grupo), `/libreta/control`, `/libreta/visado`,
`/libreta/indicadores`, `/libreta/estudiante/[id]` (ficha) y `/libreta/configuracion`
(parametrización académica). Entradas globales de trabajo: `/libreta/evaluaciones` y
`/libreta/cierre-alumno` (*Cierre de períodos*: C, R e informe alumno por alumno y el cierre de cada
entrega; `/libreta/cierre-libreta` era la misma pantalla y redirige).

- **Unidad:** una libreta es `(ciclo, oferta de curso, orientación opcional, asignatura)`. En
  EduTrack el "grupo" es el curso más su orientación —no hay grupos paralelos—, así que esa clave
  coincide exactamente con la que la integración Moodle deriva de un evento: la libreta y su curso
  Moodle `SUBJECT_COURSE` son la misma cosa vista desde dos lados (`GradeBook.scopeKey`).
- **Generación automática:** las libretas se derivan de los eventos de clase del ciclo. Corre
  sola cada hora sobre el ciclo activo (y al minuto de arrancar el servidor), y administración
  puede correrla en *Configuración de libreta → Libretas* después de cargar el horario
  (`POST /admin/academic-config/gradebooks/provision`). No hay tabla de asignación docente: quién
  dicta qué sólo existe en el horario. Es idempotente, sólo reescribe el titular si cambió, no
  revive libretas archivadas y respeta la oferta del ciclo (un curso no ofertado no genera
  libretas). El resumen avisa las clases sin asignatura o curso, que no generan libreta.
- **Acceso:** el titular, y por un tiempo el suplente que cubrió alguna de sus clases. Adscripción,
  Dirección e Inspección leen todas las del centro pero **no** califican: leer y escribir son
  permisos distintos (`gradebook.read` vs `gradebook.grade`).
- **Acceso del suplente: provisorio y sólo a lo suyo.**
  - Dura desde su primera clase cubierta hasta **7 días después de la última**. Después la libreta
    desaparece de "Mis libretas" y no la puede abrir. La tarjeta y la libreta dicen hasta cuándo.
  - Ve la lista del grupo y la hoja de cada alumno, y **agrega notas** (de grupo o sueltas). Ve y
    corrige sólo las que cargó él.
  - No ve nada del titular: sus notas, planificación, desarrollo, conducta (C), rendimiento (R),
    cierre, mensajes, historia ni exportaciones. El servidor se lo cierra por defecto.
  - El titular ve las notas del suplente en la carta y en el detalle, marcadas "Suplente: Nombre",
    y las puede corregir como las suyas.
- **Calificar y planificar también son permisos distintos.** `gradebook.grade` cubre evaluaciones,
  notas y juicios conceptuales; `gradebook.plan`, la planificación y el desarrollo del curso.
  **Dirección no tiene ninguno de los dos:** ve la libreta, la visa y le avisa al docente lo que
  está mal cargado, pero no la edita. Como la autorización lee los permisos de la base, el permiso
  `plan` que Dirección tenía se apaga solo al arrancar (`REVOKED_PROFILE_PERMISSION_IDS`). Las
  pantallas lo respetan (`access.canPlan` en `GET /gradebook/:id`). Si administración corrige la
  planificación de otro, queda en la auditoría (`GRADEBOOK_PLANNING_UPDATED`) y la planificación
  muestra quién la modificó por última vez. Un registro del desarrollo se corrige en la misma fila
  (`PATCH /gradebook/:id/development/:entryId`); corregirlo y borrarlo quedan auditados.
- **Pasar lista desde la libreta** ya no tiene pantalla propia: se pasa en `/me/roll-call`. El
  endpoint `PUT /gradebook/:id/absences/day` sigue las mismas reglas (ventana del docente, planilla
  cerrada por administración, administración fuera de plazo auditada).
- **Estructura de la planilla del liceo.** La carta del alumno reproduce los bloques de la planilla
  que el liceo usaba en Excel (`docs/Prototipo Libreta.xlsx`), para no cambiarle la operativa al
  docente. Cada período tiene un **tipo** (`AcademicPeriod.kind`):
  - *Diagnóstico* (reunión de trayectorias): sólo texto por estudiante.
  - *Tramo* (Marzo–Abril, Mayo–Junio, Julio, Agosto–Setiembre, Octubre–Noviembre, Diciembre, APE
    Febrero): columnas **Or · Otras · Ev** con las notas sueltas —nunca un promedio—, **Prueba** si
    hubo prueba semestral, y **C · R**. La columna de cada nota la define el tipo de actividad
    (`ActivityType.category`), editable en la configuración.
  - *Entrega* (1.ª a 4.ª, cada una con su reunión): **informe de actuación · C · R**. No admite
    notas sueltas: ni el docente ni la importación de Moodle pueden cargar evaluaciones ahí.
- **C = conducta, R = rendimiento.** **C** es una nota entera del **1 al 10** de conducta del
  estudiante en la asignatura (`PeriodGrade.conductValueHundredths`), igual que la conducta
  institucional de adscripción. Se carga y muestra como número en la libreta, los boletines y las
  exportaciones; no se reemplaza por juicios como «Buena» o «Mala». **R** es el rendimiento, con la escala
  del nivel, y lo pone el docente en su libreta (`PeriodGrade.meetingValueHundredths`). **La nota
  oficial es siempre R** (`officialPeriodValue`): la usan el boletín, el promedio de la reunión, la
  ficha académica y los indicadores. Mientras no haya R, la materia figura pendiente.
  `PeriodGrade.valueHundredths` es la "C" anterior (la calificación del docente antes del cambio):
  ya no se carga ni se exige; la matriz la muestra como *propuesta* si no hay R.
  `npm run backfill:period-rendimiento` (dry-run; `-- --apply`) copia esa nota vieja a R donde R
  está vacía, sólo en libretas del ciclo en curso.
- **Períodos con reunión** (`AcademicPeriod.isMeeting`): las entregas, Diciembre y APE Febrero. Son
  los que listan la reunión, el boletín, el visado y el control. Si exigen rendimiento, cerrar exige
  R de cada alumno y, si además son reunión, también C (`MISSING_GRADES`, `MISSING_CONDUCT`).
- **Informe general del grupo** (`GradeBookPeriod.groupReport`): el docente lo escribe por período
  en la sección Cierre (vista del grupo, `PUT /gradebook/:id/periods/:periodId/group-report`). En las
  reuniones de boletín es obligatorio para cerrar (`MISSING_GROUP_REPORT`) y el control de libretas
  lo cuenta como pendiente. Dirección lo lee y lo visa (sección `GROUP_REPORT`).
- **Cerrar una entrega cierra sus tramos** (los que están entre la entrega anterior y ella): una
  entrega cuyas notas de tramo siguieran editables dejaría de significar algo. Se cierra desde la
  sección Cierre de la libreta; si falta algo, se listan todos los faltantes juntos.
- **Escala 1 a 10 en seis tramos**, con los colores de la planilla: 1–2 rojo, 3–4 naranja, 5
  amarillo, 6–7 verde claro, 8–9 azul y 10 azul oscuro. **Se aprueba desde 5.** Cada tramo lleva
  además símbolo y texto (RNF 7.2). El color de la UI sale siempre de la escala, nunca de un umbral
  fijo en el front.
- **Transición:** `npm run seed:remap-ebi-periods` (dry-run; `-- --apply` para aplicar) siembra la
  estructura nueva, mueve las evaluaciones de Mayo, Junio‑Julio y Evaluación Semestral a los tramos
  nuevos, da de baja esos períodos si quedaron vacíos y completa R desde C en los períodos que ya
  estaban cerrados.
- **Parametrización (RF-044, RF-050, RF-041):** escalas con sus tramos y descriptores, períodos por
  ciclo **y nivel** —EBI y EMS tienen calendarios distintos— y tipos de actividad. Todo se edita
  desde administración, sin tocar código.
- **Escalas que la libreta busca por código:** `NUMERICA_1_10` y `NUMERICA_1_12` (C y R de cada
  nivel) y `CONDUCTA`. Configuración no deja desactivarlas ni dejarlas sin mínimo, máximo o tramos
  (`GRADEBOOK_SCALE_REQUIRED`, `_NEEDS_RANGE`, `_NEEDS_LEVELS`), y lo dice en la tarjeta de cada
  una. Antes, desactivar una hacía que la libreta pasara en silencio a la primera escala activa.
  Igual se leen aunque estén inactivas, por si alguna quedó así de antes.
- **Calificaciones:** los valores se guardan en **centésimos** (`8` → `800`), como `amountCents`,
  para que la comparación contra umbrales sea exacta. El tramo de la escala se deriva del valor;
  el descriptor no se persiste.
- **Se califica con la escala del nivel:** 1 a 10 en ciclo básico y 1 a 12 en bachillerato. Notas,
  C y R ofrecen el rango que manda el backend (`periodScale` en `GET /gradebook/:id/options`, `scale`
  en el cierre); antes el selector era 1–10 fijo y en bachillerato no se podía poner 11 ni 12. Una
  nota fuera del rango se ofrece igual, para que tocar el selector no la borre.
- **Notas sueltas y evaluaciones del grupo** (`Assessment.scope`): la carta del alumno crea notas
  sueltas (`INDIVIDUAL`, un oral o una participación) y la planilla *Evaluación del grupo* crea un
  escrito o una prueba para todos (`GROUP`). Desde la carta, la nota de una evaluación del grupo se
  edita sola: título, fecha y período son de la evaluación y no se tocan desde un alumno. Las dos
  admiten "no rindió". `npm run seed:fix-gradebook-assessments` (dry-run; `-- --apply`) marca como
  sueltas las notas de la carta cargadas antes, y pasa a 1–12 las evaluaciones manuales de
  bachillerato que se crearon con la escala 1–10.
- **Historial (§6.2):** toda escritura que cambie una nota ya cargada deja una fila en
  `GradeRevision` con valor anterior, nuevo, autor, origen y motivo. Reenviar el mismo valor no
  escribe ni audita. La primera carga no genera revisión. **Borrar una nota** también deja su fila
  ("Nota borrada"), y el historial sobrevive al borrado (`onDelete: SetNull`, con `assessmentId` y
  `studentId`); antes se iba en cascada con la nota. **C, R, conducta e informe** tienen su propio
  historial (`PeriodGradeRevision`): corregir un dato que ya estaba deja lo anterior y lo nuevo, y
  el origen distingue al docente de una corrección de administración. Los dos cierres validan todo
  antes de escribir y escriben en una transacción. Se consulta en *Historial de cambios*, en el
  detalle del alumno en Calificaciones y en el cierre por alumno (`GET /gradebook/:id/history`).
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
  del plazo del período (§5.9). La sección Cierre se usa **por alumno** (la carta con todas sus
  notas) o para **todo el grupo en un período** (una tabla con C, R, informe y conducta,
  `GET`/`PUT /gradebook/:id/periods/:periodId[/grades]`), y avisa antes de descartar cambios sin
  guardar al cambiar de alumno, de período o de libreta. Las dos formas siguen las mismas reglas:
  período del nivel de la libreta, abierto y ya habilitado (`PERIOD_NOT_ENABLED`).
- **La libreta del docente no promedia.** El liceo fue explícito: la calificación general del
  período la decide el docente. Al cerrar se muestra cuántas notas cargó —para ver a quién le
  falta—, no un promedio. El indicador automático de RF-061 vive donde se usa de verdad: la matriz
  institucional y la planilla de reunión, con un decimal, para escolaridad y abanderados. Ahí
  tampoco se persiste: guardarlo lo convertiría de a poco en la calificación oficial.
- **Inasistencias globales y media falta.** El liceo cuenta las faltas del estudiante **en el
  liceo**, no por materia: `GET /gradebook/:id` las devuelve del ciclo entero. Cada marca lleva un
  peso en centésimos (`100` = falta entera, `50` = media) que fija **adscripción caso por caso** al
  justificar — no hay regla automática. Justificar es de adscripción (`student-attendance.justify`),
  no del docente, que sólo marca presente/tarde/ausente. **En ciclo básico** la regla sí es
  automática y por día (§11 bis): libreta, planilla de reunión y boletín suman los días, y el
  detalle del alumno muestra cuánto aportó cada uno. Ahí también justifica dirección.
- **Conducta, dos veces.** Cada docente pone la de su asignatura (la **C** de la carta,
  `PeriodGrade.conductValueHundredths`) en cada tramo y entrega —en la carta, por alumno o en la
  tabla del grupo—; el servidor sólo acepta valores de la escala
  (`CONDUCT_OUT_OF_SCALE`). Adscripción pone una institucional por estudiante y
  período (`StudentConductRecord`). La reunión las ve juntas. Usa su propia escala (`CONDUCTA`),
  porque no se mide como el rendimiento, y las etiquetas salen de esa escala (no de una tabla en el
  código): un cambio en Configuración llega a la reunión y al boletín. Adscripción y Dirección
  (`gradebook.review`) cargan la institucional en la columna Conducta de la matriz de reunión; el
  servidor sólo acepta valores de la escala y un período del ciclo indicado.
- **Reunión (`/libreta/reunion`):** la matriz del grupo con rendimiento, conducta e inasistencias en
  la misma fila, el promedio con **un decimal** —hace falta para escolaridad y abanderados— y el
  registro de decisiones sobre `TeacherMeetingRecord`. Grupo y período quedan en la URL
  (`?grupo=&periodo=`): la ficha del alumno vuelve a la misma reunión y el enlace se puede
  compartir.
- **Decisiones de reunión:** son del grupo **con su orientación**; antes las de 5.º Científico
  aparecían en 5.º Humanístico, también en el "Juicio Reu." del docente, que ahora toma la decisión
  del alumno o la del grupo de *su* orientación. Las registran adscripción y dirección
  (`gradebook.review`); el resto las lee. Una decisión nueva sucede a la anterior sin borrarla, y
  la pantalla marca cuál está vigente (la que ve el docente).
- **Boletín (`GET /admin/gradebook/report-card/:studentId?periodId=`):** PDF por estudiante y
  período con nota y juicio de **todas** sus asignaturas, conducta, promedio e inasistencias. Es la
  única salida transversal: el resto de las exportaciones son por libreta, o sea de una materia.
  El grupo sale de la matrícula del **ciclo del período** (la activa, o la última de ese año si el
  estudiante ya se fue), no de la de hoy, y un período de otro nivel responde `LEVEL_MISMATCH`.
  **Boletines del grupo** (`GET /admin/gradebook/report-cards`): un solo PDF, una hoja por
  estudiante, para imprimir la entrega. Los dos se descargan desde la matriz de reunión en las
  reuniones de boletín, con `gradebook.export`.
- **Control de libretas (`/libreta/control`):** antes de cada reunión de boletín (cada ~2 meses)
  administración revisa que cada docente esté al día y, si no, le avisa por notificación interna.
  - El desplegable lista sólo **reuniones de boletín**, separadas por nivel: EBI 1.ª a 4.ª Entrega,
    EMS 1.er y 2.º semestre (`isReportCardPeriod`: reunión que pide C y juicio; quedan afuera
    exámenes y APE). Se preselecciona la próxima.
  - Sólo aparecen las libretas del nivel de la reunión.
  - "Al día" = en los tramos que informa la reunión **cada evaluación del grupo** tiene nota (o "no
    rindió") de cada alumno y, si el tramo sólo tiene notas sueltas, **cada alumno tiene al menos
    una**; además está la **calificación del período (C)** y el **juicio** cuando el período los
    pide. La **R no se exige**: se pone en la reunión misma. Una nota suelta no se cruza contra el
    grupo: antes cada nota cargada desde la carta sumaba "29 notas sin cargar".
  - El texto del aviso lo arma el backend con el mismo cálculo que ve la pantalla; queda en la
    auditoría (`GRADEBOOK_COMPLETION_REQUESTED`), y de ahí sale el "Avisado el…" de cada libreta,
    que sobrevive a recargar la pantalla.
  - **Después de la reunión** la misma pantalla mira lo que queda de ella: la **R** de cada alumno
    y el **período cerrado**, que es lo que habilita el visado. El aviso de esa etapa dice qué falta
    para cerrar.
  - **Avisar a todos** (`POST /admin/gradebook/completeness/request-all`): un solo aviso por docente
    con todas sus libretas pendientes, no uno por materia.
  - Cada libreta se nombra con la orientación del grupo, y el roster se consulta una vez por grupo
    y no una por libreta.
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
  visado hecho sobre el cierre anterior siga existiendo (RF-083). Se hace desde la grilla de visado
  o desde la barra de reuniones del cierre. Reabrir una **entrega reabre también los tramos** que su
  cierre congeló (si no, sus notas de evaluación seguirían bloqueadas para todos), y el docente
  recibe un aviso (`GRADEBOOK_PERIOD_REOPENED`) con el motivo.
- **Importación desde Moodle (§11 ter · Moodle):** previsualizar y confirmar. Idempotente por
  `(libreta, ítem de Moodle)`, convierte proporcionalmente a la escala elegida y **nunca toca un
  período cerrado**. Detalle en `docs/MOODLE_INTEGRACION.md`.

### Vistas institucionales (RF-031, RF-060, RF-061, RF-070)

**Pantallas:** `/libreta/reunion` (matriz de grupo) y `/libreta/estudiante/[id]` (ficha
académica). La vieja "Vista de grupo" (`/libreta/grupo`) era la misma matriz: se unificó y la ruta
redirige a la reunión. El período se filtra por el nivel del grupo. Permiso `gradebook.read` de alcance ALL:
adscripción, dirección, inspección y administración.

- **Matriz Estudiante × Asignatura** del período, con calificación, juicio, descriptor, pendientes
  y alertas. Un grupo ve **las asignaturas de su orientación más las de tronco común** — la
  contracara exacta del roster; quedarse sólo con las de la orientación dejaría media matriz vacía.
- **Promedio transversal (RF-061):** indicador automático, derivado al leer y nunca persistido. Una
  asignatura pendiente no lo arrastra: "todavía no tiene nota" no es "sacó poco".
- **Ficha académica (RF-031):** trayectoria por ciclo —con el estado de la matrícula, las faltas
  del ciclo y la conducta institucional de cada reunión—, histórico por materia y período,
  evolución por asignatura, los juicios conceptuales de cada período y las decisiones de la reunión
  sobre el estudiante. Con `gradebook.export` descarga el boletín de cada reunión de boletín. Un
  período sin datos se conserva como hueco; borrarlo haría que dos períodos separados parecieran
  consecutivos.
- **Riesgo (§5.7):** se marca al estudiante con N o más asignaturas en tramo de alerta. El umbral
  es la regla *Asignaturas en alerta* del ciclo (3 por defecto), la misma que usan los indicadores,
  así "en alerta" significa lo mismo en la reunión y en Rendimiento académico. El descenso
  sostenido exige **tres** bajas consecutivas: dos
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
- **Circuito de corrección:** se observa una sección → administración reabre el período → el
  docente corrige y vuelve a cerrar (la grilla marca "volvió a cerrarse tras la observación") →
  adscripción o dirección la **da por corregida** → Dirección visa. Cada fila de la grilla se abre
  para observar por sección, dar por corregido, reabrir y ver el historial; los botones aparecen
  sólo para quien tiene la atribución.
- **Visado en lote:** con una reunión elegida, Dirección visa de una vez lo que está cerrado y sin
  observaciones (`POST /admin/gradebook/endorsements/bulk`). Cada libreta pasa por las mismas
  reglas, auditoría y aviso que de a una; lo que no está listo queda afuera con su motivo.
- **Secciones del visado:** Calificaciones, Cierre, Juicios, **Seguimiento** (`PLANNING`: si dio lo
  que planificó) e **Informe del grupo** (`GROUP_REPORT`), más el visado del período (`ALL`).
- **Visar es de Dirección, no del docente.** Dirección visa desde la grilla `/libreta/visado` o desde
  *Visado y seguimiento* dentro de cada libreta. **El docente ve lo que le observaron** arriba de sus
  *Mensajes del director* (`GET /gradebook/:id/endorsements`), incluidas las observaciones de un
  período reabierto para corregir; los avisos de observación, visado y reapertura lo llevan ahí.
- **Antigüedad del pendiente** en la grilla, para priorizar (§5.9), junto con la marca de cierre
  fuera de plazo. La grilla filtra por reunión y por grupo (orientación más tronco común), sin tope
  de filas.
- El rol del actor se **congela** en cada evento: si mañana cambia de rol, el historial sigue
  diciendo con qué atribución se visó.

### Observaciones, mensajería y accesos (RF-090, RF-091, RF-100)

- **Espacio de intercambio** por libreta, con hilos. Un hilo no puede cruzar libretas.
  - El docente lo ve como **Mensajes del director**: sólo los hilos que abrió Dirección
    (`GET /gradebook/:id/messages?from=DIRECCION`), y responde dentro de ellos; no abre hilos.
  - Dirección escribe desde *Visado y seguimiento* ("Mensajes al docente") y ve todo el intercambio.
  - Cuando el docente responde, le llega el aviso a quien abrió el hilo.
- Va **separado de la cadena de visado** a propósito: acá viven las consultas y aclaraciones; en
  `Endorsement` sólo lo que cambia un estado formal.
- **Avisos (RF-091):** observación, visado y mensaje nuevo llegan por la campana que ya existe
  (`InAppNotification`) y por push, con tipos propios para poder filtrarlos. Nunca se avisa a quien originó
  la acción, y **un fallo del aviso jamás interrumpe lo que lo originó**: observar o visar queda
  firme aunque la notificación no salga.
- **Registro de acceso (RF-100):** cada apertura de una libreta deja usuario, rol, fecha e IP en
  `GradeBookAccessLog`. Es tabla aparte de `AuditLog` a propósito —alto volumen y retención
  distinta—; mezclarlas sepultaría la auditoría real bajo las consultas. Se escribe
  *fire-and-forget*: si falla, la lectura responde igual. Supervisión lo consulta en el detalle de
  cada fila de la grilla de visado, *Accesos a la libreta*
  (`GET /admin/gradebook/gradebooks/:gradeBookId/access-log`, las últimas 100).

### Exportaciones (RF-120)

Desde `/libreta/[id]`, con permiso `gradebook.export`: Dirección, Adscripción y administración
exportan cualquier libreta, cada docente las suyas, e Inspección no exporta (no se le muestra el
botón). El boletín (`/admin/gradebook/report-card/:studentId`) usa el mismo permiso. No es
`exports.create` a propósito: ese abre también las exportaciones generales, con la asistencia del
personal y las novedades de sueldos.

- **Excel**: una hoja de calificaciones —una columna por evaluación— más una hoja de cierre por
  período, con calificación, descriptor y juicio conceptual. Sirve de archivo del año entero.
- **PDF de la libreta** y **informe individual** por estudiante, con sus períodos cerrados, el
  descriptor y el estado de visado.
- El descriptor de C y R sale de la escala del nivel, la misma con la que se califican, y no de
  la escala de alguna evaluación de la libreta.
- Los valores van al Excel como **número**, no como texto: una planilla de notas se ordena y se
  promedia, y una columna de strings lo impide. El formato de celda respeta los decimales de la
  escala. El *ausente* se distingue del *sin calificar*: uno dice "Ausente", el otro queda vacío.
- Todo documento lleva impreso de qué libreta, ciclo y docente salió, más la fecha de emisión: una
  hoja suelta sin eso no dice a qué grupo pertenece.
- La descarga va por `fetch` + blob y no por un enlace directo, porque la API vive en otro origen
  y la sesión viaja en cookie: un `<a href>` plano daría 401.

### Backoffice de inteligencia académica (§5, RF-200)

**Pantalla:** "Rendimiento académico" (`/libreta/indicadores`), permiso `academic-analytics.read`
de alcance ALL. En el menú se llama así para que no se confunda con los indicadores del personal.
Filtros de
nivel, reunión y grupo.

- **Tres bloques** como pide el pliego: *Estudiantes* (total, evaluados, sin evaluaciones, en
  alerta, con mejora, con descenso), *Rendimiento* (promedio, mediana, distribución por tramo) y
  *Gestión de libretas* (completas, incompletas, cierres y visados pendientes, % visadas, cierres
  fuera de plazo).
- **Por nivel, nunca mezclados.** Ciclo básico califica de 1 a 10 y bachillerato de 1 a 12: un
  promedio que junta las dos escalas no dice nada. Los tramos y las alertas salen de la escala de C
  y R del nivel (`periodScaleFor`). Si no se elige nivel y los datos tienen uno solo, se usa ese;
  con los dos, la API responde 400 `LEVEL_REQUIRED` con los niveles para elegir.
- **Contra una reunión:** la elegida o la última que ya tiene alguna R (`referencePeriod`).
  Promedio, mediana, distribución, materias en alerta y gestión son de esa reunión; antes se
  mezclaban todas las del año, del diagnóstico a febrero. Se mide sobre R, la nota oficial. La
  pantalla dice contra qué reunión y qué escala está midiendo.
- **Con mejora / en descenso** compara, punta a punta, el promedio de las materias del alumno en
  cada reunión hasta la de referencia. Antes la serie guardaba por reunión la nota de una materia
  cualquiera, y comparaba Matemática de una entrega con Dibujo de otra.
- **Con un grupo elegido** cuentan sus libretas más las de tronco común, como en la reunión, y sólo
  sus alumnos: una libreta de tronco común trae a todo el curso.
- **Promedio y mediana van juntos, no uno en lugar del otro:** una distribución con pocos
  resultados muy bajos mueve el promedio y no la mediana, y esa diferencia es la señal.
- **Comparativas** por asignatura, curso y ciclo lectivo, siempre dentro de un nivel, con el
  porcentaje de resultados en tramo de alerta (§5.3 a §5.5). Entre años se compara la misma
  reunión por código y nivel: la "1.ª Entrega" de cada ciclo es otro período.
- **Umbrales configurables (§5.7)** en `AcademicAlertRule`, desde *Configuración de libreta →
  Alertas*, con **vigencia por ciclo (RF-200)**: la regla del año pisa a la general y la general al
  valor por defecto, así una comparativa histórica se evalúa con el umbral que regía entonces y no
  cambia sola cuando alguien mueve el actual. Una regla apagada en un ciclo también pisa: no deja
  que se cuele la general. Sin reglas cargadas rige *Asignaturas en alerta* con 3 (lo que usó
  siempre la matriz de reunión); *Caída del promedio* y *Sin evaluaciones* arrancan apagadas.
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

**Pantalla:** `/notifications`. No está en el menú lateral: se entra desde la campana del encabezado.

- **Campana:**
  - Muestra cuántos avisos hay sin leer.
  - Al tocarla abre un panel con los últimos avisos: ícono y etiqueta según el tipo, hace cuánto
    llegó y si está sin leer.
  - Tocar un aviso lo marca leído y lleva a su pantalla sin recargar.
  - Abajo están "Ver todos los avisos" y "Configurar avisos", que abre
    `/profile?section=notifications` para activar el push.
- **Al día solo:**
  - El número se actualiza cada minuto con la pestaña a la vista, al volver a la pestaña y apenas
    llega un push (el service worker avisa a las pestañas abiertas).
  - Leer en cualquier lado (panel, cartelito o página) lo baja enseguida: comparten el estado
    (`NotificationsProvider`).
- **Cartelito:** un aviso que llega mientras se usa la app aparece unos segundos abajo. Con uno solo
  se abre al tocarlo; con varios, los cuenta y abre el panel.
- **Página de avisos:**
  - agrupada por día;
  - filtro de no leídos;
  - cada fila se toca entera, y hay una acción aparte para marcarla como leída;
  - "Cargar más", paginado por cursor (`GET /notifications/in-app?before=`).
- **Qué avisa y a quién:**

  | Avisa | A quién | Por push |
  |-------|---------|----------|
  | Licencias registradas o actualizadas | el titular | sí |
  | Eventos asignados | quien lo recibe | sí |
  | Libreta: observaciones, mensajes, visados, reaperturas y pendientes de cierre | el titular | sí |
  | Alertas de estudiantes | adscripción y dirección | sí |
  | Incidentes de marcación | administración | no |

  - Todos los avisos pasan por `notifyUsers` (`services/notifications/notify.ts`): campana y push
    juntos, y un fallo nunca corta la acción que lo originó.
  - De las alertas de estudiantes sólo avisan las **faltas seguidas** y las **18/25 faltas**. Las
    bajas de nota se siguen registrando y viendo en Reportes, pero no notifican.
- **Web Push** (suscripción y envío vía API `web-push`) cuando el navegador lo permite.
  - Cada aviso lleva su propia etiqueta, para que dos seguidos no se pisen en el celular.
  - Tocar el push usa la pestaña de EduTrack que ya está abierta.
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

### Reportes de estudiantes

Permiso `student-reports.read` (administración, dirección y adscripción). Todo se deriva al leer
(`services/student-reports/`). No tienen pantalla propia: cada reporte vive donde se trabaja su tema.

- **Faltas** → **Asistencia de estudiantes** (`/admin/student-attendance`), en las pestañas "Faltas
  seguidas" (`?tab=seguidas`) y "18 y 25 faltas" (`?tab=faltas`).
  - Comparten pantalla con "Justificaciones" y "Listas sin pasar": quien ve que un alumno llegó a 18
    lo justifica ahí mismo.
  - Cada pestaña se muestra con su permiso.
- **Notas** → **Rendimiento académico** (`/libreta/indicadores`), en la vista "Seguimiento"
  (`?view=seguimiento`): un solo boletín para las dos listas.
  - El tablero dice cuántos están "en alerta" o "en descenso"; el seguimiento, quiénes.
  - Adscripción, que no tiene `academic-analytics.read`, entra con `student-reports.read` y ve sólo
    esa vista.
- `/admin/reportes` queda como redirección para los avisos guardados y los enlaces viejos:
  - `faltas` → 18 y 25;
  - `notas` y `bajas` → Seguimiento;
  - el resto → Faltas seguidas.

- **Notas bajas:** % de alumnos con nota baja por materia y curso en una reunión de boletín, más el
  total por curso con alumnos distintos. Nota baja = banda de alerta (`isAlert`) de la escala del
  nivel, sobre la R.
- **Bajas de boletín:** materias en las que la R es menor que la del boletín anterior del mismo nivel.
- **Faltas seguidas:** 3 o más días de clase seguidos del grupo con falta entera sin justificar
  (EBI: alguna ausencia sin justificar ese día; EMS: la consolidación diaria da falta). Fines de
  semana y feriados no son días de clase, así que no cortan la racha.
- **18 / 25 faltas:** con el mismo conteo que la libreta (por día en ciclo básico).
- **Alertas:** cada una se guarda en `StudentAlert` (unique tipo + alumno + clave). Las de faltas
  (seguidas y 18/25) se avisan **una sola vez** por notificación `STUDENT_ALERT` y push a DIRECCION y
  ADSCRIPTO, con enlace a su pestaña de Asistencia de estudiantes; con más de 5 nuevas, un resumen.
  Las bajas de nota se registran pero no avisan. El escaneo corre cada hora y, además, unos minutos
  después de guardar una lista.

### Asistencia del personal

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
`/login`, `/register`, `/register-step-by-step`, `/verify`, `/onboarding`

`/forgot` y `/reset` redirigen al login de Keycloak (recupero gestionado en el IdP).

### Administración
`/admin/users`, `/admin/attendance`, `/admin/events`, `/admin/licenses`, `/admin/school-years`, `/admin/school-years/compare`, `/admin/courses`, `/admin/students`, `/admin/student-attendance`, `/admin/analytics`, `/admin/settings`, `/admin/profiles`, `/admin/audit`

### Personal (rutas legacy por rol)
`/teacher/*`, `/staff/*` — equivalentes a módulos “mis …”

### Unificadas “mis datos”
`/me/attendance`, `/me/events`, `/me/licenses`, `/me/roll-call`, `/me/roll-call/[eventId]/[ymd]`

### Libreta digital (módulo propio, §11 ter)
Docente — `/libreta`, `/libreta/[id]` y sus secciones. Dentro de la libreta hay un **selector de
grupo** que conserva la sección abierta: el docente entra una vez y cambia de grupo sin salir.
`/libreta/[id]/{planificacion,desarrollo,evaluaciones,inasistencias,cierre,visados,mensajes}`.

Trabajo transversal — `/libreta/inasistencias`, `/libreta/evaluaciones` y `/libreta/cierre-alumno`
(`/libreta/cierre-libreta` redirige ahí).

Supervisión y parametrización — `/libreta/reunion`, `/libreta/control`, `/libreta/visado`,
`/libreta/indicadores`, `/libreta/estudiante/[id]`, `/libreta/configuracion`.

### General
`/`, `/guia`, `/profile`, `/notifications` (`/student/attendance` es legacy y redirige a `/me/roll-call`)

### Menú, nombres y Guía

El menú lateral (`UserNav`) muestra cada entrada según **permisos**, no por rol fijo, y agrupa por
**destinatario**, para que lo del personal y lo de los estudiantes no se mezclen:

| Grupo | Qué tiene |
|-------|-----------|
| Inicio | Inicio y la **Guía** (`/guia`) |
| Mi trabajo | Lo propio: Mi agenda, Pase de lista, Mis libretas, Mis asistencias, Mis licencias |
| Personal | Asistencia del personal, Licencias, Agenda y clases, Usuarios, Indicadores del personal |
| Estudiantes | Estudiantes, Asistencia de estudiantes, Mensualidades |
| Académico | Ciclos lectivos, Cursos |
| Libretas | Libretas, Control, Visado, Reunión de profesores, Rendimiento académico, Configuración de libreta |
| Configuración | Mi perfil, Configuración del sistema, Roles / Perfiles, Auditoría |

- **Nombres y descripciones:** salen de un solo catálogo (`frontend/web/src/lib/navigation/modules.ts`),
  que también usan Inicio, el encabezado de cada pantalla (`ModuleHeader`) y la Guía.
- **Encabezado:** cada pantalla dice de qué grupo es y para qué sirve. Si tiene una pantalla parecida
  con la que se confunde, ofrece el enlace ("¿Buscás las faltas de los estudiantes?").
- **La Guía:** explica la diferencia entre las dos asistencias y lista sólo lo que la persona
  puede usar. Inicio la ofrece la primera vez, con un aviso que se cierra.

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
| **Visitante** | Registrarse (queda pendiente de aprobación), verificar email, recuperar contraseña |
| **Usuario pendiente** | Completar perfil; sin módulos operativos hasta aprobación |
| **Administrador** | Todo lo anterior + usuarios, asistencias, eventos, licencias, académico, reportes, analítica, consultas, auditoría, configuración, perfiles |
| **Docente / Staff** | Ver propias asistencias, eventos, licencias; notificaciones; **pasar lista de sus clases** |
| **Estudiante** | Sin cuenta ni login. Es un registro administrativo: su matrícula, cuotas y asistencia las gestionan administración y sus docentes |
| **Dispositivo biométrico** | Enviar fichadas ADMS autenticadas |
| **Moodle** | Recibir usuarios creados/actualizados vía WS |

---

*Última revisión: mayo 2026. Fuente: código en `backend/`, `frontend/web/`, `docs/REPORTES.md`, `profile-permissions-defaults.ts`.*
