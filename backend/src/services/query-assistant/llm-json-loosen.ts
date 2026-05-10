import { QUERY_ASSISTANT_INTENTS, type QueryAssistantIntent } from './schemas.js'

const INTENT_SYNONYMS: Record<string, QueryAssistantIntent> = {
  HOURS_WORKED: 'HOURS_WORKED_SUMMARY',
  HORAS_TRABAJADAS: 'HOURS_WORKED_SUMMARY',
  INCIDENTS: 'ATTENDANCE_INCIDENTS_SUMMARY',
  INCIDENCIAS: 'ATTENDANCE_INCIDENTS_SUMMARY',
  LEAVES: 'MEDICAL_LEAVES_SUMMARY',
  LICENCIAS: 'MEDICAL_LEAVES_SUMMARY',
  EVENTS: 'ASSIGNED_EVENTS_SUMMARY',
  BIOMETRIC: 'BIOMETRIC_ISSUES_SUMMARY',
  LATE: 'ATTENDANCE_LATE_SUMMARY',
  TARDANZAS: 'ATTENDANCE_LATE_SUMMARY',
  USERS: 'USERS_ADMIN_SNAPSHOT',
  USUARIOS: 'USERS_ADMIN_SNAPSHOT',
  AUDIT: 'AUDIT_LOG_SUMMARY',
  AUDITORIA: 'AUDIT_LOG_SUMMARY',
}

function coerceYearMonthKey(key: string, n: number): number | undefined {
  if (!Number.isFinite(n)) return undefined
  if (key === 'year' && n >= 2000 && n <= 2100) return n
  if (key === 'month' && n >= 1 && n <= 12) return n
  return undefined
}

/** Normaliza JSON del modelo antes de Zod (strings numéricas, intent alias). */
export function loosenLlmIntentJson(input: unknown): unknown {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return input
  const o = { ...(input as Record<string, unknown>) }

  const rawIntent = o.intent
  if (typeof rawIntent === 'string') {
    let u = rawIntent.trim().toUpperCase().replace(/\s+/g, '_')
    const allowed = QUERY_ASSISTANT_INTENTS as readonly string[]
    if (!allowed.includes(u)) {
      const syn = INTENT_SYNONYMS[u]
      if (syn) u = syn
    }
    if (allowed.includes(u)) {
      o.intent = u
    }
  }

  const p = o.params
  if (p != null && typeof p === 'object' && !Array.isArray(p)) {
    const pr = { ...(p as Record<string, unknown>) }
    for (const key of ['year', 'month'] as const) {
      const v = pr[key]
      if (typeof v === 'string' && /^\d{1,4}$/.test(v.trim())) {
        const n = Number(v.trim())
        const coerced = coerceYearMonthKey(key, n)
        if (coerced !== undefined) pr[key] = coerced
      }
    }
    o.params = pr
  }

  return o
}
