import { DateTime } from 'luxon'
import type { LlmIntentPayload } from './schemas.js'
import { heuristicIntentFromQuestion, spanishMonthFromQuestion, yearFromQuestion } from './question-heuristics.js'

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
    return h ?? parsed
  }

  const nowY = DateTime.utc().year
  const monthFromText = spanishMonthFromQuestion(question)
  const yearFromText = yearFromQuestion(question)

  if (NEEDS_RANGE.includes(parsed.intent) && parsed.params.month == null && monthFromText != null) {
    return {
      ...parsed,
      params: {
        ...parsed.params,
        month: monthFromText,
        year: parsed.params.year ?? yearFromText ?? nowY,
      },
    }
  }

  if (parsed.intent === 'HOURS_WORKED_SUMMARY' && parsed.params.month != null && parsed.params.year == null) {
    return {
      ...parsed,
      params: { ...parsed.params, year: yearFromText ?? nowY },
    }
  }

  return parsed
}
