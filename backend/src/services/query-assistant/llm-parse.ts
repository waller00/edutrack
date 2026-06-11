import OpenAI, { APIError } from 'openai'
import { enrichPayloadFromQuestion } from './enrich-payload.js'
import { heuristicIntentFromQuestion } from './question-heuristics.js'
import { loosenLlmIntentJson } from './llm-json-loosen.js'
import { temperatureParams } from './model-params.js'
import { SEMANTIC_SYNONYMS } from './schema-context.js'
import { llmIntentSchema, type LlmIntentPayload } from './schemas.js'

const SYSTEM_PROMPT = `Sos un clasificador de consultas administrativas para EduTrack (asistencias, eventos, licencias, biométrico, usuarios, auditoría).
Tu única tarea es devolver un JSON válido según el esquema. No inventes cifras de negocio: solo clasificá y extraé parámetros.

Intents (campo "intent"):
1) HOURS_WORKED_SUMMARY — Horas efectivas trabajadas según eventos asignados y marcas entrada/salida en un mes o rango.
   params: year, month (1-12) o dateFrom+dateTo. Opcional: userSearch (fragmento de nombre, apellido o usuario del docente).
2) ABSENCES_SUMMARY — Faltas/ausencias/inasistencias de docentes o personal a sus eventos asignados en un período (derivadas del horario planificado; incluye las aún no materializadas).
   params: year+month o dateFrom+dateTo. Opcional: userSearch.
   incidentViewMode: LIST (default, una fila por falta) o COUNT_BY_USER si piden ranking, "quién faltó más", conteo por persona.
   personRoleScope: TEACHER si pregunta por docentes/profesores; STAFF si pregunta por funcionarios/personal; omitir si no distingue.
3) ATTENDANCE_INCIDENTS_SUMMARY — Incidencias registradas (llegadas tarde, ausencia docente detectada por el monitor, salida anticipada) cuando el usuario habla explícitamente de "incidencias" o "no show".
   params: year+month o dateFrom+dateTo. Opcional: userSearch.
   incidentStatusScope: OPEN_ONLY si pide solo abiertas / pendientes; si no, ALL.
   incidentTypeScope: LATE_ARRIVAL | TEACHER_NO_SHOW | EARLY_EXIT | ALL según la pregunta.
   incidentViewMode: LIST (default, detalle fila a fila) o COUNT_BY_USER si piden ranking, "por persona", "quién tuvo más", "top", conteo por docente.
4) MEDICAL_LEAVES_SUMMARY — Licencias o permisos cuyo período se solapa con el rango indicado.
   params: year+month o dateFrom/dateTo. Opcional: userSearch.
   leaveStatusScope: ALL (default) | ACTIVE_ONLY si dicen licencias activas/vigentes | INACTIVE_ONLY si dicen cerradas/inactivas.
5) ASSIGNED_EVENTS_SUMMARY — Eventos asignados a personal (clases, jornadas, etc.) que empiezan en el período.
   params: year+month o rango. Opcional: userSearch (si nombra a alguien, se listará detalle de eventos).
6) BIOMETRIC_ISSUES_SUMMARY — Marcas biométricas fallidas o pendientes de procesar.
   params: year+month o rango. Opcional: userSearch.
   biometricIssueScope: FAILED | PENDING | BOTH (por defecto BOTH si no aclara).
7) ATTENDANCE_LATE_SUMMARY — Cantidad de entradas marcadas como tardías (CHECK_IN LATE) por persona en el período.
   params: year+month o rango. Opcional: userSearch (docente concreto).
8) USERS_ADMIN_SNAPSHOT — Listados administrativos de cuentas (sin necesidad de mes si la pregunta es general).
   userAdminScope: PENDING_APPROVAL (pendientes de aprobación), INACTIVE (bajas), DOC_EXPIRING_90D (documento por vencer), LOCKED (cuenta bloqueada), ACTIVE_RECENT (activos recientes, por defecto si pregunta genérica de "usuarios").
9) AUDIT_LOG_SUMMARY — Trazas de auditoría del sistema en el período.
   params: year+month o rango; si no hay fecha, el servidor usará el mes calendario UTC actual.
   auditActionKeyword: palabra para filtrar (ej. "login", "usuario", "licencia", "evento", "configuración").
10) UNKNOWN — Fuera de alcance o datos insuficientes para elegir un informe.

Ejemplos (mapeá intent + params; userSearch en minúsculas o tal cual el nombre mencionado):
- "Horas trabajadas de Ana Martínez en octubre" → HOURS_WORKED_SUMMARY, month 10, userSearch "Martínez" o "Ana".
- "¿Cuántas veces llegó tarde García en mayo?" → ATTENDANCE_LATE_SUMMARY, month 5, userSearch "García".
- "Licencias activas en junio" → MEDICAL_LEAVES_SUMMARY, month 6, leaveStatusScope ACTIVE_ONLY.
- "Qué profesores faltaron en junio" → ABSENCES_SUMMARY, month 6, personRoleScope TEACHER.
- "Quién faltó más en abril" / "ranking de ausencias docentes en marzo" → ABSENCES_SUMMARY, incidentViewMode COUNT_BY_USER, personRoleScope TEACHER, month según texto.
- "Incidencias de ausencia docente (no show) en abril" → ATTENDANCE_INCIDENTS_SUMMARY, incidentTypeScope TEACHER_NO_SHOW.
- "Incidencias abiertas de salida anticipada en agosto" → ATTENDANCE_INCIDENTS_SUMMARY, incidentStatusScope OPEN_ONLY, incidentTypeScope EARLY_EXIT.
- "Eventos asignados al docente López en septiembre" → ASSIGNED_EVENTS_SUMMARY, userSearch "López", month 9.

Reglas:
- Interpretá sinónimos: docente/profesor/profe/maestro/tutor → TEACHER o persona asignada; funcionario/personal/staff/administrativo/adscripto/bedel → personal; alumno/estudiante → Student si pregunta matrícula/cursos. Asistencia/marca/marcación/fichada/registro son equivalentes según contexto. Atraso/retraso/tardanza/llegada tarde son LATE. Retiro temprano/se fue antes/salida anticipada son EARLY_EXIT.
- Frases cortas válidas: "horas trabajadas mayo", "lista de usuarios", "incidencias abiertas octubre", "tardanzas en mayo" → rellená intent y params (mes en número 1-12).
- Para mes sin año explícito: inferí year desde el año por defecto indicado en el Contexto; corresponde al ciclo lectivo seleccionado por el usuario.
- year y month en JSON deben ser números, no strings.
- dateFrom y dateTo son YYYY-MM-DD inclusive; usalos si el usuario da fechas concretas.
- reply: una frase corta en español al usuario (confirmación o aclaración mínima).
- JSON único, sin markdown.`

function currentContextLine(defaultYear = new Date().getUTCFullYear()) {
  const now = new Date()
  return `Contexto: fecha/hora servidor UTC aproximada: ${now.toISOString().slice(0, 10)}. Año por defecto para meses sin año explícito: ${defaultYear}.`
}

export async function parseQuestionWithLlm(question: string, options?: { defaultYear?: number }): Promise<LlmIntentPayload> {
  // Fast path sin tokens: si las heurísticas locales clasifican con confianza la consulta
  // (frases comunes como "horas trabajadas mayo", "licencias activas", "lista de usuarios"),
  // resolvemos sin llamar al modelo. Solo caemos al LLM cuando la heurística no está segura.
  if (process.env.QUERY_ASSISTANT_DISABLE_HEURISTIC !== '1') {
    const fast = heuristicIntentFromQuestion(question.trim(), options?.defaultYear)
    if (fast) {
      return enrichPayloadFromQuestion(fast, question.trim(), { defaultYear: options?.defaultYear })
    }
  }

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
      ...temperatureParams(model, 0.1),
      response_format: { type: 'json_object' },
      messages: [
        // System 100% estático (clasificador + sinónimos) → prefijo cacheable por OpenAI.
        // Sin el esquema completo de tablas: el clasificador no lo necesita.
        { role: 'system', content: `${SYSTEM_PROMPT}\n\n${SEMANTIC_SYNONYMS}` },
        // Lo volátil (fecha, año por defecto) va en el mensaje del usuario.
        { role: 'user', content: `${currentContextLine(options?.defaultYear)}\n\nConsulta: ${question.trim().slice(0, 2000)}` },
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
  return enrichPayloadFromQuestion(base, question.trim(), { defaultYear: options?.defaultYear })
}
