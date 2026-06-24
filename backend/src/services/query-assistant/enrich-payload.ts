import { DateTime } from 'luxon'
import type { LlmIntentPayload } from './schemas.js'
import {
  heuristicIntentFromQuestion,
  spanishMonthFromQuestion,
  yearFromQuestion,
} from './question-heuristics.js'

const NEEDS_RANGE: LlmIntentPayload['intent'][] = [
  'HOURS_WORKED_SUMMARY',
  'ABSENCES_SUMMARY',
  'ATTENDANCE_INCIDENTS_SUMMARY',
  'MEDICAL_LEAVES_SUMMARY',
  'ASSIGNED_EVENTS_SUMMARY',
  'BIOMETRIC_ISSUES_SUMMARY',
  'ATTENDANCE_LATE_SUMMARY',
  'AUDIT_LOG_SUMMARY',
]

const ROLE_PERSON_WORD = String.raw`docentes?|profesor(?:es)?|profesora(?:s)?|profes?|maestros?|maestras?|educadores?|tutores?|funcionarios?|personal|staff|administrativos?|adscriptos?|bedeles?`
const ABSENCE_WORD = String.raw`falt|ausen|ausencias?|no\s+show|no\s+lleg[oó]|inasisten|no\s+vino`
const LATE_WORD = String.raw`tard|atras|retras|llegada\s+tarde|entrada\s+tarde`
const EARLY_EXIT_WORD = String.raw`salidas?\s+anticipad[ao]s?|retiros?\s+tempran[ao]s?|se\s+retir[oó]\s+antes|se\s+fue\s+antes`

/**
 * Palabras que nunca son un nombre de persona: artículos/preposiciones, palabras de rol
 * ("docentes") y verbos/sustantivos del dominio ("faltaron", "llegaron", "tardanzas").
 * Sin esto, "qué profesores faltaron en junio" terminaba buscando un usuario "faltaron"
 * y la respuesta era siempre vacía. Se listan formas completas (no raíces) para no
 * descartar nombres reales como "Marcos" o "Marcela".
 */
const NON_NAME_TOKEN = new RegExp(
  `^(?:${String.raw`el|la|los|las|un|una|unos|unas|en|de|del|al|por|para|durante|y|o|u|que|mes|hay|fue|mas|este|esta|estos|estas|todos|todas|cada` +
    '|' +
    String.raw`falto|falta|faltan|faltaron|faltado|faltas|ausente|ausentes|ausencia|ausencias|inasistencia|inasistencias|llego|llegan|llegaron|llegada|llegadas|tarde|temprano|trabajo|trabajan|trabajaron|asistio|asisten|asistieron|marcaron|ficharon|ficho|vino|vinieron|estuvo|estuvieron|tuvo|tuvieron|hizo|hicieron|salio|salieron|retiro|retiraron|presento|presentes|tardanza|tardanzas|atraso|atrasos|retraso|retrasos|licencia|licencias|incidencia|incidencias|evento|eventos|clase|clases|hora|horas` +
    '|' +
    ROLE_PERSON_WORD})$`,
)

function looksLikePersonName(chunk: string): boolean {
  const words = chunk.trim().split(/\s+/)
  if (words.length === 0 || !words[0]) return false
  return words.every((w) => !NON_NAME_TOKEN.test(w) && spanishMonthFromQuestion(w) == null)
}

/** Si el modelo devolvió UNKNOWN o faltan mes/año detectables en el texto, completamos o reemplazamos con heurística local. */
export function enrichPayloadFromQuestion(
  parsed: LlmIntentPayload,
  question: string,
  options?: { defaultYear?: number },
): LlmIntentPayload {
  const defaultYear = options?.defaultYear ?? DateTime.utc().year
  if (parsed.intent === 'UNKNOWN') {
    const h = heuristicIntentFromQuestion(question, defaultYear)
    return applyQuestionKeywordEnrichments(h ?? parsed, question)
  }

  const nowY = defaultYear
  const monthFromText = spanishMonthFromQuestion(question)
  const yearFromText = yearFromQuestion(question)

  let next = parsed

  if (NEEDS_RANGE.includes(next.intent) && next.params.month == null && monthFromText != null) {
    next = {
      ...next,
      params: {
        ...next.params,
        month: monthFromText,
        year: next.params.year ?? yearFromText ?? nowY,
      },
    }
  }

  if (next.intent === 'HOURS_WORKED_SUMMARY' && next.params.month != null && next.params.year == null) {
    next = {
      ...next,
      params: { ...next.params, year: yearFromText ?? nowY },
    }
  }

  return applyQuestionKeywordEnrichments(next, question)
}

function normQuestion(q: string) {
  const normalized = q
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
  return trimQuestionPunctuation(normalized)
}

function trimQuestionPunctuation(value: string) {
  const chars = new Set(['¿', '¡', '"', "'", '«', '»'])
  let start = 0
  let end = value.length
  while (start < end && chars.has(value[start])) start += 1
  while (end > start && chars.has(value[end - 1])) end -= 1
  return value.slice(start, end).trim()
}

/** Refina params según palabras en la pregunta (sin LLM). */
function applyQuestionKeywordEnrichments(parsed: LlmIntentPayload, question: string): LlmIntentPayload {
  const t = normQuestion(question)
  const params = { ...parsed.params }

  if (parsed.intent === 'MEDICAL_LEAVES_SUMMARY') {
    if (/\b(activas?|vigentes?)\b/.test(t) && !/\b(inactivas?)\b/.test(t)) {
      params.leaveStatusScope = 'ACTIVE_ONLY'
    } else if (/\b(inactivas?|cerradas?)\b/.test(t)) {
      params.leaveStatusScope = 'INACTIVE_ONLY'
    }
  }

  if (parsed.intent === 'ABSENCES_SUMMARY') {
    const wantsCount =
      new RegExp(`\\b(por\\s+persona|por\\s+(?:${ROLE_PERSON_WORD})|conteo|ranking|top\\s+\\d+)\\b`).test(t) ||
      /\bcuant[ao]s\s+(veces|faltas|ausencias|inasistencias)\b/.test(t) ||
      /\b(cantidad|numero|total)\s+de\s+(veces|faltas|ausencias|inasistencias)\b/.test(t) ||
      (new RegExp(`\\b(quien|que\\s+(?:${ROLE_PERSON_WORD})|(?:${ROLE_PERSON_WORD})\\s+que|el\\s+(?:${ROLE_PERSON_WORD}))\\b`).test(t) &&
        /\b(mas|m[aá]s|mayor|mayores)\b/.test(t))
    if (wantsCount && params.incidentViewMode == null) {
      params.incidentViewMode = 'COUNT_BY_USER'
    }
    if (params.personRoleScope == null) {
      if (/\bno\s+docentes?\b/.test(t)) {
        params.personRoleScope = 'STAFF'
      } else if (/\b(?:docentes?|profesor(?:es)?|profesora(?:s)?|profes?|maestros?|maestras?|educadores?)\b/.test(t)) {
        params.personRoleScope = 'TEACHER'
      } else if (/\b(?:funcionarios?|personal|staff|administrativos?|adscriptos?|bedeles?)\b/.test(t)) {
        params.personRoleScope = 'STAFF'
      }
    }
  }

  if (parsed.intent === 'ATTENDANCE_INCIDENTS_SUMMARY') {
    if (new RegExp(`\\b(?:${EARLY_EXIT_WORD})\\b`).test(t)) {
      params.incidentTypeScope = 'EARLY_EXIT'
    }
    const wantsCount =
      new RegExp(`\\b(por\\s+persona|por\\s+(?:${ROLE_PERSON_WORD})|conteo|ranking|top\\s+\\d+)\\b`).test(t) ||
      (/\branking\b/.test(t) && /\bausencias?\b/.test(t)) ||
      (new RegExp(`\\b(quien|que\\s+(?:${ROLE_PERSON_WORD})|(?:${ROLE_PERSON_WORD})\\s+que|el\\s+(?:${ROLE_PERSON_WORD}))\\b`).test(t) && /\b(mas|m[aá]s|mayor|mayores)\b/.test(t)) ||
      /\bcuantas\s+incidencias?\s+(tiene|cada)\b/.test(t)
    if (wantsCount && params.incidentViewMode == null) {
      params.incidentViewMode = 'COUNT_BY_USER'
    }
    if (params.incidentViewMode === 'COUNT_BY_USER' && params.incidentTypeScope == null) {
      if (new RegExp(`\\b(?:${ABSENCE_WORD})\\b`).test(t)) {
        params.incidentTypeScope = 'TEACHER_NO_SHOW'
      } else if (new RegExp(`\\b(?:${LATE_WORD})\\b`).test(t)) {
        params.incidentTypeScope = 'LATE_ARRIVAL'
      }
    }
  }

  const intentsWithUserSearch: LlmIntentPayload['intent'][] = [
    'HOURS_WORKED_SUMMARY',
    'ABSENCES_SUMMARY',
    'ATTENDANCE_LATE_SUMMARY',
    'ASSIGNED_EVENTS_SUMMARY',
    'MEDICAL_LEAVES_SUMMARY',
    'ATTENDANCE_INCIDENTS_SUMMARY',
    'BIOMETRIC_ISSUES_SUMMARY',
  ]
  if (intentsWithUserSearch.includes(parsed.intent) && !params.userSearch?.trim()) {
    const afterRole = t
      .match(new RegExp(`\\b(?:${ROLE_PERSON_WORD})\\s+([a-záéíóúñ]+(?:\\s+[a-záéíóúñ]+)?)(?=\\s+en\\s+|\\s+del\\s+|\\s+durante\\s+|$)`))?.[1]
      ?.trim()
    const afterDe = t.match(/\bde\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+)*)\s+(?:en|del|durante)\s+/)?.[1]?.trim()
    const candidate = [afterRole, afterDe].find((c) => c && c.length >= 2 && looksLikePersonName(c))
    if (candidate) params.userSearch = candidate
  }

  if (parsed.intent === 'ATTENDANCE_LATE_SUMMARY' && !params.userSearch?.trim()) {
    const lt = t.match(/\blleg[oó]\s+tarde\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+)?)\s+en\s+/)
    if (lt?.[1]) params.userSearch = lt[1].trim()
  }

  if (parsed.intent === 'AUDIT_LOG_SUMMARY' && !params.auditActionKeyword?.trim()) {
    const auditHints = ['login', 'usuario', 'licencia', 'evento', 'configuracion', 'contraseña']
    for (const kw of auditHints) {
      if (new RegExp(`\\b${kw}\\b`, 'i').test(t)) {
        params.auditActionKeyword = kw === 'configuracion' ? 'config' : kw
        break
      }
    }
  }

  if (
    parsed.intent === 'ATTENDANCE_INCIDENTS_SUMMARY' &&
    params.incidentViewMode === 'COUNT_BY_USER' &&
    params.month == null &&
    !params.dateFrom?.trim()
  ) {
    const now = DateTime.utc()
    params.month = now.month
    params.year = params.year ?? now.year
  }

  return { ...parsed, params }
}
