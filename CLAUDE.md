# EduTrack — Guía para Claude

Plataforma web de gestión integral de instituciones educativas (asistencia, eventos, licencias, estructura académica, Moodle, biometría, reportes).

**Producción:** https://edutrack-uy.com/
**Local:** http://localhost:3000 (frontend) / http://localhost:4000 (API)

---

## Stack

| Capa | Tecnología |
|------|------------|
| Frontend | Next.js 14 App Router, TypeScript, Tailwind |
| Backend | Node 20, Express, Prisma ORM, PostgreSQL |
| Identidad | Keycloak (OIDC) + patrón BFF (sesiones en Redis) |
| Tests | Vitest (backend + frontend unit), Playwright (e2e) |
| CI | GitHub Actions (ci.yml, sonar.yml, deploy.yml) |
| Infra local | `docker-compose.yml` |
| Infra cloud | `docker-compose.cloud.yml` |

---

## Arranque local

```bash
cp .env.compose.example .env
docker compose up -d --build
```

El backend corre `prisma db push --skip-generate` automáticamente al arrancar (ver `backend/docker-entrypoint.sh`). **No hay `migrate deploy`**; el proyecto usa `db push` (sin tabla `_prisma_migrations`).

> **Un `@unique` nuevo sobre una tabla con datos necesita SQL previo.** En producción `db push` corre
> sin `--accept-data-loss` y rechaza agregar ese UNIQUE: no aplica nada del esquema y el código nuevo
> falla. El DDL va idempotente en `prisma/migrations/<fecha>_<nombre>/migration.sql` (con los nombres
> de índice que genera Prisma; verificar con `prisma migrate diff`) y se agrega a `npm run db:prepush`,
> que el entrypoint corre **antes** de `db push`. `db:optimize` corre en segundo plano: no sirve para esto.

URLs locales:

| Servicio | URL |
|----------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:4000 |
| Keycloak | http://localhost:8089 |

---

## Estructura del repo

```
backend/                       # API Express + Prisma
  src/
    routes/                    # Endpoints Express (un archivo por dominio)
    services/                  # Lógica de negocio
    integrations/
      moodle/                  # Sincronización EduTrack→Moodle
      zkteco/                  # Biometría ZKTeco iclock
    auth/                      # Keycloak BFF, sesiones Redis
    db/                        # Prisma client singleton
  prisma/
    schema.prisma              # Fuente de verdad del esquema
    migrations/                # Solo documentación (no se ejecutan con migrate deploy)
frontend/web/                  # Next.js App Router
  src/app/                     # Pages y layouts (admin, staff, teacher, student, auth)
keycloak/                      # Realm JSON + tema login
docs/                          # Documentación técnica
scripts/                       # Backup, restore, seed, deploy helpers
```

---

## Comandos frecuentes

```bash
# Backend
cd backend
npm run dev              # servidor local con hot-reload
npm run test             # vitest (unit)
npm run test:coverage    # genera coverage/lcov.info
npm run typecheck        # tsc --noEmit (usa ./node_modules/.bin/tsc, no npx tsc)
npm run prisma:studio    # Prisma Studio en :5555

# Frontend
cd frontend/web
npm run dev
npm run test
npm run typecheck
npm run test:e2e         # Playwright

# Compose
docker compose logs -f auth web
docker compose down
docker compose up -d --build auth  # rebuild solo el backend
```

> **Importante:** usar `./node_modules/.bin/tsc --noEmit` en el backend, no `npx tsc` (npm puede resolver el paquete `tsc@2.0.4` obsoleto).

---

## Base de datos

- Motor: PostgreSQL 16
- ORM: Prisma con `db push` (no migrate)
- Esquema: `backend/prisma/schema.prisma`
- Modelos principales: `User`, `SchoolYear`, `Course`, `CourseOffering`, `CourseOrientation`, `Subject`, `SubjectCourseAssignment`, `Student`, `StudentEnrollment`, `Event`, `Substitution`, `Attendance`, `MedicalLeave`, `MoodleObjectMap`, `MoodleEnrolmentMap`, `MoodleSyncTask`, `BiometricDevice`, `BiometricPunch`, `SystemSettings`

> **El login vincula por `User.keycloakId` (el `sub`), nunca por username.** El email sólo vincula una
> vez, a usuarios todavía sin `keycloakId` (el arranque los rellena con `backfillKeycloakLinks`). Email
> y username los edita el usuario en la consola de Keycloak: buscar por ellos es tomar cuentas ajenas.
> Toda alta que crea la cuenta en Keycloak guarda el vínculo con `linkKeycloakAccount`.

> **El alta nunca toma una cuenta de Keycloak existente** (`createKeycloakUser` con `isAppAccount`).
> Antes, ante el mismo correo, reutilizaba esa cuenta y le ponía la contraseña de quien se
> registraba: con el correo de otro era quedarse con su cuenta. Si es de un usuario de EduTrack, 409
> (`KEYCLOAK_EMAIL_IN_USE`); si quedó huérfana, se borra y se crea limpia.

> **Contraseña y Google entran a la misma cuenta.** Quien se registró con contraseña: el primer
> «Continuar con Google» con su correo pide la contraseña una vez para vincular (flujo
> `edutrack first broker login`, que crea `keycloak-apply-realm-settings.sh` sin el paso de correo de
> Keycloak: con el SMTP del realm fallando cortaba en "Falló el envío del email"). Quien no tiene
> contraseña (las altas de Administración nacen sin) la crea ahí con "Olvidé mi contraseña". También
> vincula desde Mi perfil con "Vincular con Google"
> (`kc_action=idp_link:google` + `prompt=login`; sirve aunque su Gmail sea otro). Quien se registró
> con Google: crea su contraseña en Mi perfil o con "Olvidé mi contraseña" (correo de EduTrack, que a
> una cuenta sin contraseña le dice "Creá tu contraseña"). El secreto de Google va sólo en el `.env`
> (`GOOGLE_CLIENT_SECRET`): el realm del repo es público y trae un texto de ejemplo, que el deploy no
> sube. `scripts/keycloak-audit-login.sh` muestra (sólo lectura) cómo está el realm vivo.

> **El `?v=` de los recursos del tema de Keycloak es el hash de su contenido**
> (`keycloak/themes/edutrack/login/theme.properties`; `keycloak-theme.test.ts` lo exige y dice el
> valor). Cloudflare guarda cada URL 30 días: con un `?v=` sin cambiar, "Olvidé mi contraseña" siguió
> llevando a la recuperación de Keycloak (sin correo) en vez de a la de EduTrack. Y Keycloak sirve una
> copia comprimida de cada CSS/JS (`data/tmp/kc-gzip-cache`) que no ve los cambios y sobrevive a
> `restart`: el deploy la vacía al cambiar el tema (`keycloak_restart_for_theme`) y al final
> `scripts/keycloak-verify-theme.sh` exige que lo servido sea lo del commit.

> **El registro público (`POST /auth/register`) nunca da ADMIN.** Un ADMIN nace únicamente del
> bootstrap; nunca agregarlo al esquema del registro (la lista de usuarios oculta a los ADMIN, así que
> una cuenta así ni se ve). Dirección y Adscripto sí se piden, y ven todo el centro: "Aprobar" nombra
> el perfil y lo advierte (`approvalConfirmMessage`). El registro tiene su propio rate limit por IP y
> sus errores no enumeran los perfiles válidos. `keycloak-apply-realm-settings.sh` apaga en cada
> deploy el password grant de los clientes públicos del realm (`admin-cli`).

> **La IP del cliente es `clientIp(req)` (`src/lib/client-ip.ts`).** Nunca el primer valor de
> `X-Forwarded-For`: lo escribe el cliente. `trust proxy` sólo cree en el salto inmediato y privado
> (nginx), así `req.ip` es la IP real. La usan auditoría, rate limit y las IPs permitidas de lectores.

> **Los lectores iClock (`/iclock/*`) no se autentican**: sólo los distingue `admsSerial` + la IP.
> Un lector sin `allowedIps` no recibe marcas, y el `code` no identifica a un reloj.

> **Borrar físicamente sólo lo que no tiene historial.** Estudiantes con notas, asistencias o cuotas
> pagas (`STUDENT_HAS_HISTORY`), ciclos con libretas y orientaciones en uso (se desactivan) no se
> borran: las cascadas se llevaban escolaridad, listas y libretas. `DELETE /events/purge-all` y
> `/attendance/purge-all` son herramientas de pruebas (`isAdminTestingToolsEnabled`).

> **Un usuario con historial no se borra: se da de baja.** Borrarlo arrastra en cascada su
> asistencia, sus licencias y los eventos que creó (con ellos, listas de estudiantes y suplencias).
> `DELETE /admin/users/:id` lo rechaza con `USER_HAS_HISTORY`.

> **Dos sistemas de asistencia distintos.** `Attendance` es del **personal** (`userId → User`, marcas biométricas). El pase de lista estudiantil vive en `StudentAttendanceSession` / `StudentAttendanceEntry` / `StudentAttendanceJustification`, con su propio enum `StudentAttendanceStatus`. No mezclarlos: una consulta sobre `Attendance.status` nunca debe contar alumnos.

> **El marcado manual del personal es "ahora".** `POST /attendance/register` toma la hora del
> servidor, sólo vale para una clase que se dicta hoy (`classifyOccurrence`) y abre con la misma
> anticipación que el reloj (`earlyEntryWindowMinutes`). Como el biométrico, guarda `date` = inicio
> del día civil y `time` = instante. Alimenta la liquidación: no aceptar hora ni día del cliente.

> **Las notas viven en `GradeBook*`, no en Moodle.** EduTrack es la fuente de verdad de las calificaciones; Moodle se **importa** y nunca se pisa. Los valores se guardan en centésimos como `Int` (un 8 es `800`), igual que `amountCents` — nunca `Float` ni `Decimal`.

---

## Integración Moodle

Sincronización idempotente EduTrack→Moodle. Inactiva si faltan `MOODLE_BASE_URL` o `MOODLE_WS_TOKEN`.

Módulo: `backend/src/integrations/moodle/`

- `scope.ts` — resuelve curso Moodle por asignatura/orientación de un evento (idnumber estable)
- `courses.ts` — categorías y cursos (legacy por oferta y SUBJECT_COURSE por asignatura)
- `enrolments.ts` — matriculación manual con ventana temporal (`timestart`/`timeend`)
- `enrolment-map.ts` — tracking en `MoodleEnrolmentMap` para revocar con seguridad
- `reconcile.ts` — reconciliación completa: titulares + suplentes + revocación + estudiantes
- `client.ts` — HTTP + variables de entorno Moodle

Detalle completo: [docs/MOODLE_INTEGRACION.md](docs/MOODLE_INTEGRACION.md)

> **El titular que deja una clase pierde el curso Moodle** (`revokeStaleTeachers`), pasados
> `TEACHER_ACCESS_GRACE_DAYS` desde la reasignación (versión reemplazada) o la cancelación de la
> serie. Si la fase de titulares tuvo cualquier error no se revoca nada en esa corrida. Moodle guarda
> **una** matrícula manual por usuario y curso: al titular nunca se lo inscribe además como suplente
> del mismo curso (le pondría fecha de fin).

> **El SSO de Moodle no crea cuentas** (`authpreventaccountcreation`, en
> `scripts/moodle-config-keycloak-sso.php`): sólo entra a las que creó el sync, vinculadas por
> correo. Una cuenta de Keycloak sin aprobar en EduTrack no tiene que poder abrirse una en Moodle.
> El método `none` ("Sin autenticación") nunca se activa: acepta cualquier contraseña y crea la
> cuenta que no existe.

> **El PHP de Moodle lo pone `moodlehq/moodle-php-apache`, no Bitnami.** `bitnamilegacy/moodle`
> quedó congelada en agosto de 2025 y no recibió el parche de PHP2Shell (CVE-2026-109618/109619).
> El código sigue en el volumen `/bitnami/moodle` (lo instaló Bitnami) y la config de Apache y PHP
> está en `moodle/runtime/`. El deploy no toca Moodle: tras un parche de PHP se hace `pull` y
> `up -d moodle` a mano en el servidor.

---

## Pase de lista estudiantil

El docente marca la asistencia de sus estudiantes por **ocurrencia de clase**, identificada por
`(eventId, día civil YYYY-MM-DD)` — nunca por el id compuesto `uuid_ymd` que produce la expansión
de recurrencia.

Módulo: `backend/src/services/student-attendance/`

- `roster.ts` — cohorte del evento; misma precedencia que `moodle/scope.ts` (`courseOrientationId` > `orientationId` > tronco común)
- `occurrence.ts` — valida que el día sea clase real; distingue *suspendida* de *inexistente*
- `edit-window.ts` — la lista abre 10 min antes de la clase (`opensAt`, si no `NOT_STARTED`, para todos los alcances) y la ventana del docente: hasta una semana después del **fin de la clase** (`SystemSettings.studentRollCallEditWindowHours`, default y tope 168 h; pasarla tarde no abre otra semana)
- `late-roll-call.ts` — la primera vez que el docente pasa una lista de una clase ya terminada, avisa a Dirección (`ROLL_CALL_LATE`)
- `my-classes.ts` — clases de un día con titular, suplente y estado de la lista; `loadRollCallReminders` alimenta la franja "pasá la lista" (`GET /student-attendance/reminder`, siempre lo propio)
- `day-roll-calls.ts` — estado de las listas de un día para "Clases del día" del Inicio (timeline de analytics)
- `copy-previous.ts` — sugerencia de copiar la hora anterior del mismo grupo
- `pending.ts` — listas sin pasar (se calculan; no hay filas PENDING pre-creadas)
- `consolidation.ts` — faltas por día/asignatura, derivadas al leer
- `roll-call.ts` / `justify.ts` — escritura y transición ABSENT → ABSENT_JUSTIFIED

Rutas: `backend/src/routes/student-attendance.ts` (docente) y `admin-student-attendance.ts` (control).
Frontend: `/me/roll-call` y `/admin/student-attendance`. La franja que aparece en toda la app durante
la clase es `components/rollcall/RollCallReminderBar.tsx` (montada en `UserNav`). Las fases de una
lista ("Abre 09:50", "Pasá la lista", "Sin pasar", "Pasada 10:07") salen de `lib/rollcall/rollcall-phase.ts`,
calculadas con la hora del cliente: no confiar en un `canEdit` viejo.

> **Guardar la lista y justificar pueden pisarse.** `saveRollCall` resuelve los estados contra las
> marcas bloqueadas (`FOR UPDATE`) dentro de su transacción, no contra lo leído antes, y
> `justifyEntryTx` sólo justifica si la marca **sigue** en `ABSENT` (update condicional). No volver a
> resolver estados fuera de la transacción.

> `occurrenceDate` **debe** calcularse con `uruguayWallToUtc(ymd, 0, 0)`, idéntico a lo que escribe
> `resolveSubstitutionOccurrence` en `Substitution.date`. Si difieren, el suplente recibe un 403
> silencioso. Nunca `new Date(ymd)`.

> **Un día cubierto, la lista es del suplente.** Si hay `Substitution` ese día, el responsable es
> sólo el suplente: le llegan los avisos, figura en "Listas sin pasar" (también por el filtro de
> docente) y queda como `takenBy`. El titular ve la planilla pero no la pasa
> (`COVERED_BY_SUBSTITUTE` en `resolveRollCallPermissions`); administración sí.

Detalle funcional: [docs/FUNCIONALIDADES.md](docs/FUNCIONALIDADES.md) §11 bis

---

## Libreta digital

Módulo propio bajo `/libreta` (no cuelga de Académico). Una libreta es
`(ciclo, oferta de curso, orientación opcional, asignatura)` — la misma clave que la integración
Moodle deriva de un evento, así que `GradeBook.scopeKey` y el curso Moodle `SUBJECT_COURSE` son la
misma cosa vista desde dos lados. Se generan solas a partir de los eventos de clase del horario: no
hay tabla de asignación docente.

Backend: `backend/src/services/gradebook/` (provisión, acceso, ventana de edición, calificación,
cierre de período, importación Moodle, visado, notificaciones, analítica, exportaciones) y las rutas
`gradebook.ts`, `admin-gradebook.ts`, `admin-academic-config.ts`, `admin-academic-analytics.ts`.

Frontend: `src/app/libreta/` con `LibretaShell` (marco tipo Libro del Profesor) y
`src/lib/libreta/` (menú de secciones y catálogo de distintivos).

> El semáforo académico **nunca** puede ser sólo color (RNF 7.2): siempre lleva texto o icono
> además. Los distintivos del alumno y el contador de faltas ya siguen esa regla.

> **`gradebook.grade` y `gradebook.plan` son permisos distintos a propósito.** El primero cubre
> evaluaciones, notas y juicios conceptuales; el segundo, planificación y desarrollo del curso.
> **Editan la libreta el docente (lo suyo, `own`) y Administración (todas, `all`).** `grade`, `plan`
> y `close`; Administración además reabre un período (`gradebook.manage`) y corrige fuera de plazo,
> y lo que escribe quien no es el docente queda auditado como corrección. **Dirección y Adscripción
> la ven y no la editan**: Dirección visa, Adscripción observa (el arranque les apaga grade, plan,
> close y manage). Para sacarle un permiso a un rol que ya lo tiene en producción no alcanza con
> los defaults: la autorización lee la base, así que va en `REVOKED_PROFILE_PERMISSION_IDS` (con su
> motivo). Prender uno apagado o cambiar el **alcance** de uno que ya existe tampoco llega (el sync
> sólo crea filas faltantes): va en `ENFORCED_PROFILE_PERMISSION_SCOPES`.

> **Perfiles:** Administrador; Docente; **Personal** (`STAFF`, no docente: sólo sus ingresos y sus
> licencias); **Dirección** y **Adscripción** ven todo el centro como Administración pero sólo
> editan lo suyo (visar / justificar). Inspección se retiró (`RETIRED_ORG_ROLE_CODES`): no se lista
> y el arranque la borra en cuanto queda sin usuarios. Los "Mis …" del menú (agenda, asistencias,
> licencias) no fijan alcance: quien ve todo conserva lo propio. **La cuenta de Administración no
> tiene "Mi trabajo"** (es la del sistema) y **Personal ve en el menú sólo "Mi trabajo"**: quien no
> puede abrir nada más que lo suyo no recibe Inicio ni Configuración (`visibleNavGroups`).

> **Roles / Perfiles muestra lo que la base autoriza.** Lo que fija la política (lo que se apaga, lo
> que se fuerza y lo que dejó de ser del perfil) llega en `locks` con su motivo y la pantalla no lo
> deja cambiar; el backend tampoco. La matriz se siembra y se ajusta sólo al arrancar: re-sembrarla
> en cada `GET /admin/profiles` revertía lo recién guardado. Los perfiles del sistema no se
> renombran, y los permisos que ninguna ruta consulta (`RETIRED_PERMISSION_CODES`) no se ofrecen.

> **El menú de la libreta depende de quién mira** (`sectionsFor`, `lib/libreta/menu.ts`). Quien
> supervisa tiene "Visado y seguimiento"; visar no es del docente. La libreta **no tiene sección de
> mensajes**: lo que el visado le observó al docente lo ve arriba de "Cierre de períodos"
> (`ObservacionesDireccion`), y la supervisión le escribe por la mensajería 1 a 1 ("Escribirle al
> docente" en Visado). `/libreta/:id/mensajes` sólo redirige, por los avisos viejos de la campana.

> **El suplente tiene un acceso provisorio y ve sólo lo suyo** (`services/gradebook/access.ts`).
> Entra desde su primera clase cubierta hasta `SUBSTITUTE_ACCESS_DAYS_AFTER` (7) días después de la
> última; después la libreta desaparece de su lista. Ve la lista del grupo y **sólo las notas que
> cargó él** (`ownWorkOnly`): ni las del titular, ni planificación, desarrollo, C, R, cierre,
> mensajes, historia ni exportaciones. Las rutas de `routes/gradebook.ts` se le **cierran por
> defecto** en `loadContext`: una ruta nueva sólo se abre al suplente declarando
> `{ substitute: true }`, y si muestra evaluaciones las filtra con `ownWorkFilter`. El titular ve las
> notas del suplente marcadas "Suplente: Nombre" (`author.isSubstitute`) y las puede corregir.

> **Exportar libretas y boletines es `gradebook.export`, no `exports.create`.** `exports.create`
> con alcance `all` abre también `/exports`: asistencia del personal y novedades de sueldos. Sólo
> administración lo tiene; Dirección y Adscripción exportan libretas con `gradebook.export` (`all`)
> y cada docente las suyas (`own`, acotado por `loadContext`).

> **C = conducta, R = rendimiento. La nota oficial es R.** C es la conducta en la asignatura
> (`PeriodGrade.conductValueHundredths`, escala `CONDUCTA`); R, el rendimiento que pone el docente
> (`PeriodGrade.meetingValueHundredths`, escala del nivel). Boletín, matriz, promedio, ficha e
> indicadores leen R vía `officialPeriodValue` (`services/gradebook/period-closure.ts`); sin R, la
> materia está pendiente. `PeriodGrade.valueHundredths` es la "C" vieja (calificación del docente):
> ya no se carga ni se exige. Las reuniones de boletín piden además el informe general del grupo
> (`GradeBookPeriod.groupReport`) para cerrar. Los períodos siguen la planilla del liceo: `kind` DIAGNOSTICO / TRAMO /
> ENTREGA, y sólo los TRAMO admiten evaluaciones. Las columnas Or/Otras/Ev muestran notas sueltas.

> **Se califica con la escala del nivel, nunca con un rango fijo.** EBI es 1–10 y EMS 1–12: el
> front toma el rango de `periodScale` (`GET /gradebook/:id/options`) vía `lib/gradebook/grade-scale.ts`.
> Las notas que crea la carta del alumno son `Assessment.scope = INDIVIDUAL`: el control de libretas
> no las cruza contra el grupo (sólo las `GROUP`), y desde la carta no se edita una evaluación del grupo.

> **La libreta del docente no promedia.** Es una decisión del liceo, no una omisión: la
> calificación general del período la decide el docente. El promedio vive en la matriz
> institucional (`transversalAverage`) y en la planilla de reunión, que es donde se usa para
> escolaridad y abanderados.

> **Las faltas se cuentan en centésimos y son globales.** `100` es una falta entera, `50` media.
> La llegada tarde vale `50` en todos los niveles (es "la" media falta: el docente no elige otra).
> Adscripción todavía puede graduar una ausencia al justificar. Y el conteo es del ciclo en todo el
> liceo, no de la asignatura: filtrar por `subjectId` ahí es un bug, no una optimización.

> **En ciclo básico (`AcademicLevel.EBI`) la falta es del día.** El día vale la peor de sus
> marcas: `ABSENT` 100, `ABSENT_JUSTIFIED` 50, `LATE` 50. Dos tardes son 50, y tarde + ausencia
> es 100, no 150. Ahí `absenceWeightHundredths` se ignora. Todo total pasa por
> `absenceHundredthsFor` / `loadAbsenceTotals` (`services/student-attendance/`) con el nivel del
> grupo; sumar `effectiveWeight` a mano rompe ciclo básico.

> **Los justificativos** (`StudentAbsenceJustificationRange`, en pantalla "Justificativos") valen
> para cualquier nivel y sólo los cargan administración, dirección y adscripción
> (`student-attendance.justify` con alcance `all`). Cargado después, `createJustificationRange`
> justifica las ausencias ya marcadas del período; cargado antes, las aplica `saveRollCall` al
> pasar lista. La llegada tarde no se justifica.

> **"Reunión de boletín" es `isReportCardPeriod`** (`services/gradebook/period-closure.ts`):
> reunión que pide C y juicio. EBI: 1.ª–4.ª Entrega; EMS: los semestres (son `TRAMO` con reunión,
> así que filtrar por `kind === 'ENTREGA'` deja afuera a todo EMS). Control de libretas y Reportes
> la usan; `assessmentPeriodsFor` da los tramos cuyas evaluaciones informa.

> **Las adecuaciones guardan un enlace, nunca el informe.** Un informe psicológico de un menor es un
> documento clínico, y la política de privacidad lo prohíbe (§4 bis). Las cargan Administración,
> Dirección y Adscripción con `students.accommodations` (no `students.manage`: su router,
> `admin-student-accommodations.ts`, se monta aparte), desde la ficha o desde la hoja del alumno en
> la libreta. El chip ADEC abre sólo las adecuaciones, como Gen abre las observaciones. "Visto por
> docente" lo marca sólo el titular o el suplente al abrir la hoja.

Detalle funcional: [docs/FUNCIONALIDADES.md](docs/FUNCIONALIDADES.md) §11 ter

---

## Mensajería

Mensajes privados 1 a 1 entre todo el personal (`messaging.use`, alcance `own`, en los cinco perfiles),
al estilo Moodle: ícono al lado de la campana, panel lateral con "Destacados" y "Privado", y la página
`/mensajes`. **No va en el menú lateral** (`menu: false` en el catálogo): se entra por el ícono. Es
aparte de los mensajes viejos de cada libreta (`GradeBookMessage`), que ya no tienen pantalla.

Backend: `routes/messages.ts` y `services/messaging/`. Modelos `Conversation` (`pairKey` único: un par,
una conversación), `ConversationMember` (`lastReadAt`, `starred`) y `DirectMessage`. Frontend:
`components/messages/` (`MessagesProvider`, `MessagesDrawer`, `ConversationList`, `ConversationView`)
y `lib/messages/`.

> **Nadie lee conversaciones ajenas**, ni Administración: cada ruta trabaja sobre las del usuario de la
> sesión, y quien no es miembro recibe 404. El directorio (`/messages/contacts`) devuelve sólo nombre y
> perfil: nunca correo, cédula ni teléfono.

> **"Casi al instante" es polling, no WebSocket.** El contador se pregunta cada 15 s, la conversación
> abierta cada 3 s, siempre con la pestaña a la vista, y un push refresca enseguida. Los mensajes no
> van a la campana: avisan por web push con `tag` por conversación.

---

## Frontend

> **Nombres, descripciones, íconos y permisos de cada sección salen de
> `lib/navigation/modules.ts`.** Lo usan el menú (agrupado por destinatario: Mi trabajo, Personal,
> Estudiantes, Académico, Libretas, Configuración), los accesos de Inicio, la Guía (`/guia`) y
> `ModuleHeader` (`components/common/`), el encabezado de toda pantalla de módulo. Una sección nueva
> se agrega al catálogo y su pantalla usa `ModuleHeader`; no repetir el nombre a mano.

> **Ninguna etiqueta dice "asistencia" o "control" sin decir de quién es.** Hay dos asistencias que
> no se mezclan: la del **personal** ("Asistencia del personal", "Mis asistencias") y la de los
> **estudiantes** ("Pase de lista", "Asistencia de estudiantes"). Lo que se confunde va en `related`
> del catálogo y el encabezado ofrece "¿Buscás…?". Los módulos de permisos siguen la misma regla
> (`RENAMED_PERMISSION_MODULES` en `identity/profile-permissions-defaults.ts`).

> **Elegir un alumno es `StudentCombobox`** (`components/forms/`): busca al escribir (nombre,
> apellido o cédula, sin tildes) y "todos" es una opción más del mismo desplegable (`allLabel`),
> no un selector aparte. No volver a un `<select>` con la lista del grupo.

> **Una tabla con scroll horizontal va dentro de `ScrollRegion`** (`components/common/`): si
> desborda, se vuelve enfocable para recorrerla con el teclado. Un `div` con `overflow-x-auto`
> suelto deja las columnas de la derecha fuera del alcance de quien navega con Tab.

## Tests

- Framework: **Vitest** (backend y frontend)
- Mocks: `vi.hoisted()` para mocks de módulos al tope del archivo
- Permisos en tests de rutas: el token Bearer de prueba se resuelve con la **matriz de fábrica**
  del rol (`DEFAULT_PROFILE_PERMISSIONS`). Para un perfil a medida, el token declara los extra:
  `signAccessToken({ ..., role: 'TEACHER', permissions: { 'events.update': 'own' } })`. Si un test
  necesita darle a un rol algo que de fábrica no tiene, es un perfil a medida: declararlo así.
- Cobertura: `npm run test:coverage` → genera `coverage/lcov.info`
- E2E: Playwright en `frontend/web`

SonarCloud analiza `backend/src` + `frontend/web/src`. Quality Gate: cobertura nueva ≥ 80%, 0 issues Blocker/Critical en código nuevo. La complejidad cognitiva máxima por función es 15 (regla `typescript:S3776`).

---

## CI / CD

| Workflow | Cuándo corre | Qué hace |
|----------|-------------|----------|
| `ci.yml` | push/PR a main y develop | typecheck + tests backend y frontend |
| `sonar.yml` | push/PR a main y develop | análisis SonarCloud (requiere secret `SONAR_TOKEN`) |
| `deploy.yml` | push a main | deploy automático al VPS (SSH + docker compose pull + up) |
| `e2e.yml` | push/PR | tests Playwright |

El deploy de producción es **completamente automático**: al hacer push a `main`, el workflow levanta la imagen nueva y el entrypoint corre `prisma db push` al arrancar el contenedor.

---

## Variables de entorno

Plantilla: `.env.compose.example` en la raíz.

Variables Moodle relevantes:
- `MOODLE_BASE_URL`, `MOODLE_WS_TOKEN`, `MOODLE_CANONICAL_HOST`
- `MOODLE_ROLE_TEACHER_ID` (default 3), `MOODLE_ROLE_STUDENT_ID` (default 5)
- `MOODLE_ROLE_SUBSTITUTE_TEACHER_ID` (default = valor de TEACHER_ID)
- `MOODLE_ROOT_CATEGORY_ID` (default 0), `MOODLE_USER_AUTH` (default `manual`)

---

## Producción

- Dominio: https://edutrack-uy.com/
- Compose cloud: `docker-compose.cloud.yml`
- Moodle en el mismo droplet: https://moodle.edutrack-uy.com (`docker-compose.moodle.yml`, fuera del deploy automático)
- Observabilidad: Sentry (backend + frontend), Grafana + Loki (`docker-compose.monitoring.yml`)
- Proxy: Cloudflare (SSL termination)
