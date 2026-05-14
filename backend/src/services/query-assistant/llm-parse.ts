import OpenAI, { APIError } from 'openai'
import { enrichPayloadFromQuestion } from './enrich-payload.js'
import { loosenLlmIntentJson } from './llm-json-loosen.js'
import { llmIntentSchema, type LlmIntentPayload } from './schemas.js'

const SYSTEM_PROMPT = `Sos un clasificador de consultas administrativas para EduTrack (asistencias, eventos, licencias, biométrico, usuarios, auditoría).
Tu única tarea es devolver un JSON válido según el esquema. No inventes cifras de negocio: solo clasificá y extraé parámetros.

Intents (campo "intent"):
1) HOURS_WORKED_SUMMARY — Horas efectivas trabajadas según eventos asignados y marcas entrada/salida en un mes o rango.
   params: year, month (1-12) o dateFrom+dateTo. Opcional: userSearch (fragmento de nombre, apellido o usuario del docente).
2) ATTENDANCE_INCIDENTS_SUMMARY — Incidencias (llegadas tarde, ausencia docente, salida anticipada, etc.) en un período.
   params: year+month o dateFrom+dateTo. Opcional: userSearch.
   incidentStatusScope: OPEN_ONLY si pide solo abiertas / pendientes; si no, ALL.
   incidentTypeScope: LATE_ARRIVAL | TEACHER_NO_SHOW | EARLY_EXIT | ALL según la pregunta.
   incidentViewMode: LIST (default, detalle fila a fila) o COUNT_BY_USER si piden ranking, "por persona", "quién tuvo más", "top", conteo por docente.
3) MEDICAL_LEAVES_SUMMARY — Licencias o permisos cuyo período se solapa con el rango indicado.
   params: year+month o dateFrom/dateTo. Opcional: userSearch.
   leaveStatusScope: ALL (default) | ACTIVE_ONLY si dicen licencias activas/vigentes | INACTIVE_ONLY si dicen cerradas/inactivas.
4) ASSIGNED_EVENTS_SUMMARY — Eventos asignados a personal (clases, jornadas, etc.) que empiezan en el período.
   params: year+month o rango. Opcional: userSearch (si nombra a alguien, se listará detalle de eventos).
5) BIOMETRIC_ISSUES_SUMMARY — Marcas biométricas fallidas o pendientes de procesar.
   params: year+month o rango. Opcional: userSearch.
   biometricIssueScope: FAILED | PENDING | BOTH (por defecto BOTH si no aclara).
6) ATTENDANCE_LATE_SUMMARY — Cantidad de entradas marcadas como tardías (CHECK_IN LATE) por persona en el período.
   params: year+month o rango. Opcional: userSearch (docente concreto).
7) USERS_ADMIN_SNAPSHOT — Listados administrativos de cuentas (sin necesidad de mes si la pregunta es general).
   userAdminScope: PENDING_APPROVAL (pendientes de aprobación), INACTIVE (bajas), DOC_EXPIRING_90D (documento por vencer), LOCKED (cuenta bloqueada), ACTIVE_RECENT (activos recientes, por defecto si pregunta genérica de "usuarios").
8) AUDIT_LOG_SUMMARY — Trazas de auditoría del sistema en el período.
   params: year+month o rango; si no hay fecha, el servidor usará el mes calendario UTC actual.
   auditActionKeyword: palabra para filtrar (ej. "login", "usuario", "licencia", "evento", "configuración").
9) UNKNOWN — Fuera de alcance o datos insuficientes para elegir un informe.

Ejemplos (mapeá intent + params; userSearch en minúsculas o tal cual el nombre mencionado):
- "Horas trabajadas de Ana Martínez en octubre" → HOURS_WORKED_SUMMARY, month 10, userSearch "Martínez" o "Ana".
- "¿Cuántas veces llegó tarde García en mayo?" → ATTENDANCE_LATE_SUMMARY, month 5, userSearch "García".
- "Licencias activas en junio" → MEDICAL_LEAVES_SUMMARY, month 6, leaveStatusScope ACTIVE_ONLY.
- "Quién faltó más en abril" / "ranking de ausencias docentes en marzo" → ATTENDANCE_INCIDENTS_SUMMARY, incidentViewMode COUNT_BY_USER, incidentTypeScope TEACHER_NO_SHOW, month según texto.
- "Incidencias abiertas de salida anticipada en agosto" → ATTENDANCE_INCIDENTS_SUMMARY, incidentStatusScope OPEN_ONLY, incidentTypeScope EARLY_EXIT.
- "Eventos asignados al docente López en septiembre" → ASSIGNED_EVENTS_SUMMARY, userSearch "López", month 9.

Reglas:
- Frases cortas válidas: "horas trabajadas mayo", "lista de usuarios", "incidencias abiertas octubre", "tardanzas en mayo" → rellená intent y params (mes en número 1-12).
- Para mes sin año explícito: inferí year desde el Contexto (fecha UTC).
- year y month en JSON deben ser números, no strings.
- dateFrom y dateTo son YYYY-MM-DD inclusive; usalos si el usuario da fechas concretas.
- reply: una frase corta en español al usuario (confirmación o aclaración mínima).
- JSON único, sin markdown.`

const DATABASE_CONTEXT = `Contexto de base de datos disponible (estructura, sin datos reales):
- User: personas/cuentas del sistema. Campos útiles: id, email, username, firstName, lastName, name, nationalIdDocumentExpiresAt, isApproved, isActive, lockUntil, createdAt, roleId. Relación con OrgRole por roleId. Usá userSearch para nombres, apellidos, username o email.
- OrgRole: rol organizacional. Campos: code, label. Códigos esperados: ADMIN, TEACHER, STAFF, STUDENT u otros roles configurados.
- Attendance: marcas de asistencia. Campos: userId, eventId, type, status, date, time. type: CHECK_IN/CHECK_OUT. status incluye PRESENT, LATE, ABSENT_NOT_JUSTIFIED, ABSENT_JUSTIFIED, EXIT, EARLY_EXIT.
- AttendanceIncident: incidencias derivadas de asistencia. Campos: userId, eventId, attendanceId, type, status, detectedAt. type: LATE_ARRIVAL (llegada tarde), TEACHER_NO_SHOW (falta/ausencia docente), EARLY_EXIT (salida anticipada). status: OPEN, ACKNOWLEDGED, RESOLVED.
- Event: clases, jornadas, reuniones y turnos. Campos: title, type, status, startDate, endDate, startTime, endTime, userId, assignedUserId, courseId. Para eventos asignados a docentes/personal, assignedUserId es la persona asignada.
- Course: cursos/grupos asociados a eventos. Campos: name, code, isActive.
- MedicalLeave: licencias o permisos. Campos: userId, type, status, startDate, endDate, reason. status: ACTIVE/INACTIVE. El período de licencia se interpreta por solapamiento con el rango pedido.
- BiometricPunch: marcas crudas del reloj biométrico. Campos: userId, deviceUserId, occurredAt, punchType, processStatus, processError. processStatus: PENDING, PROCESSED, FAILED, DUPLICATE.
- AuditLog: auditoría del sistema. Campos: occurredAt, action, actorUserId, actorIp, source, entityType, entityId, metadata.

Mapa semántico:
- "faltas", "ausencias", "no vino", "no llegó", "inasistencias docentes" suelen mapear a AttendanceIncident.type TEACHER_NO_SHOW.
- "llegadas tarde", "tardanzas", "entradas tarde" suelen mapear a AttendanceIncident.type LATE_ARRIVAL o Attendance CHECK_IN con status LATE; para conteos por persona preferí ATTENDANCE_LATE_SUMMARY.
- "salidas anticipadas" mapea a AttendanceIncident.type EARLY_EXIT.
- "docentes con más faltas", "ranking de ausencias", "quién faltó más" mapea a ATTENDANCE_INCIDENTS_SUMMARY con incidentViewMode COUNT_BY_USER e incidentTypeScope TEACHER_NO_SHOW.
- "licencias activas/vigentes" mapea a MEDICAL_LEAVES_SUMMARY con leaveStatusScope ACTIVE_ONLY.
- "usuarios pendientes", "cuentas bloqueadas", "documento por vencer" mapea a USERS_ADMIN_SNAPSHOT con userAdminScope correspondiente.`

function currentContextLine() {
  const now = new Date()
  return `Contexto: fecha/hora servidor UTC aproximada: ${now.toISOString().slice(0, 10)} (usá este año si el usuario no indica año explícito).`
}

export async function parseQuestionWithLlm(question: string): Promise<LlmIntentPayload> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY_NOT_CONFIGURED')
  }
  if (!apiKey.startsWith('sk-')) {
    throw new Error(
      'OPENAI_API_KEY_INVALID_FORMAT: Usá una "Secret key" de OpenAI que empiece con sk- (creada en https://platform.openai.com/api-keys). Sin comillas ni espacios en el .env.',
    )
  }

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
  const client = new OpenAI({ apiKey })

  let completion
  try {
    completion = await client.chat.completions.create({
      model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\n${DATABASE_CONTEXT}\n${currentContextLine()}` },
        { role: 'user', content: question.trim().slice(0, 2000) },
      ],
    })
  } catch (e: unknown) {
    if (e instanceof APIError) {
      const hint =
        e.status === 401
          ? ' Revisá que OPENAI_API_KEY sea una clave válida de https://platform.openai.com/api-keys (debe empezar con sk-).'
          : ''
      throw new Error(`OpenAI API (${e.status ?? '?'}): ${e.message}.${hint}`)
    }
    throw e
  }

  const raw = completion.choices[0]?.message?.content
  if (!raw) throw new Error('OPENAI_EMPTY_RESPONSE')

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    throw new Error('OPENAI_INVALID_JSON')
  }

  const loosened = loosenLlmIntentJson(parsedJson)
  const parsed = llmIntentSchema.safeParse(loosened)
  const fallbackUnknown: LlmIntentPayload = {
    intent: 'UNKNOWN',
    params: {},
    reply:
      'No pude interpretar la consulta. Probá ser más concreto (ej.: incidencias abiertas de mayo, licencias en junio 2025, auditoría de logins esta semana).',
  }

  const base = parsed.success ? parsed.data : fallbackUnknown
  return enrichPayloadFromQuestion(base, question.trim())
}
