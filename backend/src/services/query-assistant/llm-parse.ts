import OpenAI, { APIError } from 'openai'
import { enrichPayloadFromQuestion } from './enrich-payload.js'
import { loosenLlmIntentJson } from './llm-json-loosen.js'
import { llmIntentSchema, type LlmIntentPayload } from './schemas.js'

const SYSTEM_PROMPT = `Sos un clasificador de consultas administrativas para EduTrack (asistencias, eventos, licencias, biométrico, usuarios, auditoría).
Tu única tarea es devolver un JSON válido según el esquema. No inventes cifras de negocio: solo clasificá y extraé parámetros.

Intents (campo "intent"):
1) HOURS_WORKED_SUMMARY — Horas efectivas trabajadas según eventos asignados y marcas entrada/salida en un mes.
   params: year, month (1-12); si falta year usá el año del Contexto UTC. Opcional: userSearch (nombre).
2) ATTENDANCE_INCIDENTS_SUMMARY — Incidencias (llegadas tarde, ausencia docente, salida anticipada, etc.) en un período.
   params: year+month o dateFrom+dateTo (YYYY-MM-DD). Opcional: userSearch.
   incidentStatusScope: OPEN_ONLY si pide solo abiertas / pendientes; si no, ALL.
   incidentTypeScope: LATE_ARRIVAL | TEACHER_NO_SHOW | EARLY_EXIT | ALL según la pregunta.
3) MEDICAL_LEAVES_SUMMARY — Licencias o permisos cuyo período se solapa con el rango indicado.
   params: year+month o dateFrom/dateTo. Opcional: userSearch.
4) ASSIGNED_EVENTS_SUMMARY — Eventos asignados a personal (clases, jornadas, etc.) que empiezan en el período.
   params: year+month o rango. Opcional: userSearch (si nombra a alguien, se listará detalle de eventos).
5) BIOMETRIC_ISSUES_SUMMARY — Marcas biométricas fallidas o pendientes de procesar.
   params: year+month o rango. Opcional: userSearch.
   biometricIssueScope: FAILED | PENDING | BOTH (por defecto BOTH si no aclara).
6) ATTENDANCE_LATE_SUMMARY — Cantidad de entradas marcadas como tardías por persona en el período.
   params: year+month o rango. Opcional: userSearch.
7) USERS_ADMIN_SNAPSHOT — Listados administrativos de cuentas (sin necesidad de mes si la pregunta es general).
   userAdminScope: PENDING_APPROVAL (pendientes de aprobación), INACTIVE (bajas), DOC_EXPIRING_90D (documento por vencer), LOCKED (cuenta bloqueada), ACTIVE_RECENT (activos recientes, por defecto si pregunta genérica de "usuarios").
8) AUDIT_LOG_SUMMARY — Trazas de auditoría del sistema en el período.
   params: year+month o rango; si no hay fecha, el servidor usará el mes calendario UTC actual.
   auditActionKeyword: palabra para filtrar (ej. "login", "usuario", "licencia", "evento", "configuración").
9) UNKNOWN — Fuera de alcance o datos insuficientes para elegir un informe.

Reglas:
- Frases cortas válidas: "horas trabajadas mayo", "lista de usuarios", "incidencias abiertas octubre" → rellená intent y params (mes en número 1-12).
- Para mes sin año explícito: inferí year desde el Contexto (fecha UTC).
- year y month en JSON deben ser números, no strings.
- dateFrom y dateTo son YYYY-MM-DD inclusive; usalos si el usuario da fechas concretas.
- reply: una frase corta en español al usuario (confirmación o aclaración mínima).
- JSON único, sin markdown.`

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
        { role: 'system', content: `${SYSTEM_PROMPT}\n${currentContextLine()}` },
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
