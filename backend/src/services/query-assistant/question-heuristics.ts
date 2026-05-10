import { DateTime } from 'luxon'
import type { LlmIntentPayload, QueryAssistantIntent } from './schemas.js'

const MONTH_WORD: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
}

/** Extrae mes 1-12 si aparece nombre en español en el texto. */
export function spanishMonthFromQuestion(q: string): number | undefined {
  const t = norm(q)
  for (const [word, m] of Object.entries(MONTH_WORD)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(t)) return m
  }
  return undefined
}

/** Año explícito 20xx en la pregunta. */
export function yearFromQuestion(q: string): number | undefined {
  const m = norm(q).match(/\b(20[0-9]{2})\b/)
  if (!m) return undefined
  const y = Number(m[1])
  if (y >= 2000 && y <= 2100) return y
  return undefined
}

function payload(
  intent: QueryAssistantIntent,
  params: LlmIntentPayload['params'],
  reply: string,
): LlmIntentPayload {
  return { intent, params, reply }
}

/**
 * Clasificación local (sin LLM) para frases cortas o cuando el modelo falla.
 * Devuelve null si no hay patrón claro.
 */
export function heuristicIntentFromQuestion(question: string): LlmIntentPayload | null {
  const t = norm(question)
  if (t.length < 2) return null

  const month = spanishMonthFromQuestion(question)
  const year = yearFromQuestion(question)
  const nowY = DateTime.utc().year

  const hoursCue =
    /\bhoras?\b/.test(t) &&
    (/\btrabajad/.test(t) || /\bcuant/.test(t) || /\bjornada\b/.test(t) || /\bdocente\b/.test(t) || /\bprofesor/.test(t))
  if (hoursCue && month != null) {
    return payload(
      'HOURS_WORKED_SUMMARY',
      { month, year: year ?? nowY },
      `Horas trabajadas (${month}/${year ?? nowY}).`,
    )
  }
  if (/\bhoras?\b/.test(t) && month != null) {
    return payload(
      'HOURS_WORKED_SUMMARY',
      { month, year: year ?? nowY },
      `Horas en el mes indicado (${month}/${year ?? nowY}).`,
    )
  }

  const usersListRequest =
    /\b(lista|listado|mostrar|ver|dame|deme|quiero|necesito|todos?\s+los?|del\s+sistema)\b/.test(t) &&
    /\b(usuarios?|personal|cuentas?)\b/.test(t)
  const usersStatusRequest =
    /\b(usuarios?|personal|cuentas?)\b/.test(t) &&
    /\b(pendientes?|inactiv|bloquead|cedula|documento|venc)\b/.test(t)
  const genericUsers =
    /^(dame|lista|listado|mostrar|ver|usuarios?|todos?\s+los?\s+usuarios?)$/i.test(t.trim()) ||
    /\b(todos?\s+los?\s+usuarios?|usuarios?\s+del\s+sistema|listado\s+de\s+usuarios?)\b/.test(t)

  if (usersListRequest || usersStatusRequest || genericUsers || /^usuarios?\s*$/i.test(t.trim())) {
    let scope: NonNullable<LlmIntentPayload['params']['userAdminScope']> = 'ACTIVE_RECENT'
    if (/\b(pendientes?|aprobar|aprobacion)\b/.test(t)) scope = 'PENDING_APPROVAL'
    else if (/\b(inactiv|baja|desactiv)\b/.test(t)) scope = 'INACTIVE'
    else if (/\b(bloquead|bloqueo)\b/.test(t)) scope = 'LOCKED'
    else if (/\b(cedula|documento|venc|vencer)\b/.test(t)) scope = 'DOC_EXPIRING_90D'
    return payload('USERS_ADMIN_SNAPSHOT', { userAdminScope: scope }, 'Listado de usuarios según el criterio pedido.')
  }

  if (/\bincidencias?\b|\bausencia\s+docente\b|\bno\s+show\b|\bllegadas?\s+tarde\b/.test(t)) {
    return payload(
      'ATTENDANCE_INCIDENTS_SUMMARY',
      {
        month: month ?? new Date().getUTCMonth() + 1,
        year: year ?? nowY,
        incidentStatusScope: /\b(abiert|pendiente|sin\s+resolver)\b/.test(t) ? 'OPEN_ONLY' : 'ALL',
      },
      'Incidencias de asistencia en el período.',
    )
  }

  if (/\b(licencia|permiso\s+medico|permiso\s+laboral)\b/.test(t)) {
    if (month == null) return null
    return payload(
      'MEDICAL_LEAVES_SUMMARY',
      { month, year: year ?? nowY },
      'Licencias que cruzan el mes indicado.',
    )
  }

  if (/\b(evento|clases?|turnos?)\b/.test(t) && /\b(asignad|docente)\b/.test(t)) {
    if (month == null) return null
    return payload(
      'ASSIGNED_EVENTS_SUMMARY',
      { month, year: year ?? nowY },
      'Eventos asignados en el período.',
    )
  }

  if (/\b(biometric|marcas?\s+fallid|reloj\s+biometric)\b/.test(t)) {
    if (month == null) return null
    return payload(
      'BIOMETRIC_ISSUES_SUMMARY',
      { month, year: year ?? nowY, biometricIssueScope: 'BOTH' },
      'Marcas biométricas con problemas en el período.',
    )
  }

  if (/\b(tardanz|llegadas?\s+tarde|entrada\s+tarde)\b/.test(t)) {
    if (month == null) return null
    return payload(
      'ATTENDANCE_LATE_SUMMARY',
      { month, year: year ?? nowY },
      'Tardanzas registradas en el período.',
    )
  }

  if (/\b(auditoria|registro\s+de\s+auditoria|logins?\s+de\s+usuarios)\b/.test(t)) {
    return payload(
      'AUDIT_LOG_SUMMARY',
      {
        month: month ?? new Date().getUTCMonth() + 1,
        year: year ?? nowY,
        auditActionKeyword: /\blogin\b/.test(t) ? 'login' : undefined,
      },
      'Registros de auditoría en el período.',
    )
  }

  return null
}
