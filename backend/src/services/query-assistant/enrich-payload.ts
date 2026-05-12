import { DateTime } from 'luxon'
import type { LlmIntentPayload } from './schemas.js'
import {
  heuristicIntentFromQuestion,
  spanishMonthFromQuestion,
  yearFromQuestion,
} from './question-heuristics.js'

const NEEDS_RANGE: LlmIntentPayload['intent'][] = [
  'HOURS_WORKED_SUMMARY',
  'ATTENDANCE_INCIDENTS_SUMMARY',
  'MEDICAL_LEAVES_SUMMARY',
  'ASSIGNED_EVENTS_SUMMARY',
  'BIOMETRIC_ISSUES_SUMMARY',
  'ATTENDANCE_LATE_SUMMARY',
  'AUDIT_LOG_SUMMARY',
]

/** Si el modelo devolvió UNKNOWN o faltan mes/año detectables en el texto, completamos o reemplazamos con heurística local. */
export function enrichPayloadFromQuestion(parsed: LlmIntentPayload, question: string): LlmIntentPayload {
  if (parsed.intent === 'UNKNOWN') {
    const h = heuristicIntentFromQuestion(question)
    return applyQuestionKeywordEnrichments(h ?? parsed, question)
  }

  const nowY = DateTime.utc().year
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
  return q
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/^[¿¡"'«»]+/gu, '')
    .replace(/["'«»]+$/gu, '')
    .trim()
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

  if (parsed.intent === 'ATTENDANCE_INCIDENTS_SUMMARY') {
    if (/\bsalida\s+anticipad/.test(t)) {
      params.incidentTypeScope = 'EARLY_EXIT'
    }
    const wantsCount =
      /\b(por\s+persona|por\s+docente|conteo|ranking|\btop\s+\d+)\b/.test(t) ||
      (/\branking\b/.test(t) && /\bausencias?\b/.test(t)) ||
      (/\b(quien|que\s+docente|docente\s+que|el\s+docente)\b/.test(t) && /\b(mas|m[aá]s|mayor|mayores)\b/.test(t)) ||
      /\bcuantas\s+incidencias?\s+(tiene|cada)\b/.test(t)
    if (wantsCount && params.incidentViewMode == null) {
      params.incidentViewMode = 'COUNT_BY_USER'
    }
    if (params.incidentViewMode === 'COUNT_BY_USER' && params.incidentTypeScope == null) {
      if (/\b(falt|ausen|ausencias?|no\s+show|no\s+lleg[oó]|inasisten)\b/.test(t)) {
        params.incidentTypeScope = 'TEACHER_NO_SHOW'
      } else if (/\b(tard|llegada\s+tarde)\b/.test(t)) {
        params.incidentTypeScope = 'LATE_ARRIVAL'
      }
    }
  }

  const intentsWithUserSearch: LlmIntentPayload['intent'][] = [
    'HOURS_WORKED_SUMMARY',
    'ATTENDANCE_LATE_SUMMARY',
    'ASSIGNED_EVENTS_SUMMARY',
    'MEDICAL_LEAVES_SUMMARY',
    'ATTENDANCE_INCIDENTS_SUMMARY',
    'BIOMETRIC_ISSUES_SUMMARY',
  ]
  if (intentsWithUserSearch.includes(parsed.intent) && !params.userSearch?.trim()) {
    const doc = t.match(
      /\b(?:docente|profesor|profesora)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+)?)(?=\s+en\s+|\s+del\s+|\s+durante\s+|$)/,
    )
    if (doc?.[1]) {
      const name = doc[1].trim()
      if (!/^(el|la|los|las|mes|hay|fue|mas|m[aá]s)$/.test(name)) {
        params.userSearch = name
      }
    } else {
      const de = t.match(
        /\bde\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+)*)\s+(?:en|del|durante)\s+/,
      )
      if (de?.[1]) {
        const chunk = de[1].trim()
        if (chunk.length >= 2 && spanishMonthFromQuestion(chunk) == null) {
          params.userSearch = chunk
        }
      }
    }
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
