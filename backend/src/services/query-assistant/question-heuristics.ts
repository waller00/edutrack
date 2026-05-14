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
    .replace(/^[¿¡"'«»]+/gu, '')
    .replace(/["'«»]+$/gu, '')
    .trim()
}

/** Extrae mes 1-12 si aparece nombre en español en el texto. */
export function spanishMonthFromQuestion(q: string): number | undefined {
  const t = norm(q)
  if (/\beste\s+mes\b/.test(t)) return new Date().getUTCMonth() + 1
  for (const [word, m] of Object.entries(MONTH_WORD)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(t)) return m
  }
  return undefined
}

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
  /** "documento por vencer" sin mencionar usuarios explícitamente */
  const docExpireStandalone =
    /\b(documento|cedula|ci\s+venc)\b/.test(t) && /\b(venc|vencer|por\s+vencer)\b/.test(t)
  const genericUsers =
    /^(dame|lista|listado|mostrar|ver|usuarios?|todos?\s+los?\s+usuarios?)$/i.test(t.trim()) ||
    /\b(todos?\s+los?\s+usuarios?|usuarios?\s+del\s+sistema|listado\s+de\s+usuarios?)\b/.test(t)

  if (
    usersListRequest ||
    usersStatusRequest ||
    genericUsers ||
    docExpireStandalone ||
    /^usuarios?\s*$/i.test(t.trim())
  ) {
    let scope: NonNullable<LlmIntentPayload['params']['userAdminScope']> = 'ACTIVE_RECENT'
    if (/\b(pendientes?|aprobar|aprobacion)\b/.test(t)) scope = 'PENDING_APPROVAL'
    else if (/\b(inactiv|baja|desactiv)\b/.test(t)) scope = 'INACTIVE'
    else if (/\b(bloquead|bloqueo)\b/.test(t)) scope = 'LOCKED'
    else if (/\b(cedula|documento|venc|vencer)\b/.test(t)) scope = 'DOC_EXPIRING_90D'
    return payload('USERS_ADMIN_SNAPSHOT', { userAdminScope: scope }, 'Listado de usuarios según el criterio pedido.')
  }

  /** Ranking de ausencias / no-show por docente (sin palabra "incidencias"). */
  if (
    /\b(quien|que\s+docente|docente\s+que|el\s+docente)\b/.test(t) &&
    /\b(mas|m[aá]s|mayor|mayores|tiene\s+mas)\b/.test(t) &&
    /\b(falt[oó]?|ausent[oó]?|ausencias?|no\s+show|inasisten)\b/.test(t)
  ) {
    if (/\beste\s+ano\b/.test(t)) {
      return payload(
        'ATTENDANCE_INCIDENTS_SUMMARY',
        {
          dateFrom: `${nowY}-01-01`,
          dateTo: `${nowY}-12-31`,
          incidentViewMode: 'COUNT_BY_USER',
          incidentTypeScope: 'TEACHER_NO_SHOW',
        },
        'Ranking de ausencias docente en el año en curso (UTC).',
      )
    }
    return payload(
      'ATTENDANCE_INCIDENTS_SUMMARY',
      {
        month: month ?? new Date().getUTCMonth() + 1,
        year: year ?? nowY,
        incidentViewMode: 'COUNT_BY_USER',
        incidentTypeScope: 'TEACHER_NO_SHOW',
      },
      'Ranking de ausencias docente por persona en el período.',
    )
  }

  /** "¿Quién tiene más llegadas tarde?" → tardanzas por persona (no listado genérico de incidencias). */
  if (
    /\b(quien|que\s+docente|docente\s+que|el\s+docente)\b/.test(t) &&
    /\b(mas|m[aá]s|mayor|mayores|tiene\s+mas)\b/.test(t) &&
    /\bllegadas?\s+tarde\b/.test(t)
  ) {
    if (/\beste\s+ano\b/.test(t)) {
      return payload(
        'ATTENDANCE_LATE_SUMMARY',
        {
          dateFrom: `${nowY}-01-01`,
          dateTo: `${nowY}-12-31`,
        },
        'Tardanzas por persona en el año en curso (UTC).',
      )
    }
    if (month == null) return null
    return payload(
      'ATTENDANCE_LATE_SUMMARY',
      { month, year: year ?? nowY },
      'Tardanzas (llegadas tarde) por persona en el mes.',
    )
  }

  /** "Ranking de ausencias en marzo" (sin quién / más). */
  if (/\branking\b/.test(t) && /\bausencias?\b/.test(t)) {
    if (/\beste\s+ano\b/.test(t)) {
      return payload(
        'ATTENDANCE_INCIDENTS_SUMMARY',
        {
          dateFrom: `${nowY}-01-01`,
          dateTo: `${nowY}-12-31`,
          incidentViewMode: 'COUNT_BY_USER',
          incidentTypeScope: 'TEACHER_NO_SHOW',
        },
        'Ranking de ausencias en el año en curso (UTC).',
      )
    }
    return payload(
      'ATTENDANCE_INCIDENTS_SUMMARY',
      {
        month: month ?? new Date().getUTCMonth() + 1,
        year: year ?? nowY,
        incidentViewMode: 'COUNT_BY_USER',
        incidentTypeScope: 'TEACHER_NO_SHOW',
      },
      'Ranking de incidencias tipo ausencia docente por persona.',
    )
  }

  /** "Conteo de incidencias por docente" (sin mes explícito → mes UTC actual). */
  if (/\bincidencias?\b/.test(t) && /\b(conteo|por\s+persona|por\s+docente)\b/.test(t)) {
    return payload(
      'ATTENDANCE_INCIDENTS_SUMMARY',
      {
        month: month ?? new Date().getUTCMonth() + 1,
        year: year ?? nowY,
        incidentViewMode: 'COUNT_BY_USER',
        incidentStatusScope: /\b(abiert|pendiente|sin\s+resolver)\b/.test(t) ? 'OPEN_ONLY' : 'ALL',
      },
      'Conteo de incidencias por persona en el período.',
    )
  }

  if (/\bincidencias?\b|\bausencia\s+docente\b|\bno\s+show\b|\bllegadas?\s+tarde\b/.test(t)) {
    const earlyExit = /\bsalida\s+anticipad/.test(t)
    return payload(
      'ATTENDANCE_INCIDENTS_SUMMARY',
      {
        month: month ?? new Date().getUTCMonth() + 1,
        year: year ?? nowY,
        incidentStatusScope: /\b(abiert|pendiente|sin\s+resolver)\b/.test(t) ? 'OPEN_ONLY' : 'ALL',
        ...(earlyExit ? { incidentTypeScope: 'EARLY_EXIT' as const } : {}),
      },
      'Incidencias de asistencia en el período.',
    )
  }

  if (/\b(licencias?|permiso\s+medico|permiso\s+laboral)\b/.test(t) && /\b(activas?|vigentes?)\b/.test(t)) {
    return payload(
      'MEDICAL_LEAVES_SUMMARY',
      {
        month: month ?? new Date().getUTCMonth() + 1,
        year: year ?? nowY,
        leaveStatusScope: 'ACTIVE_ONLY',
      },
      'Licencias activas que cruzan el mes indicado.',
    )
  }

  if (/\b(licencias?|permiso\s+medico|permiso\s+laboral)\b/.test(t)) {
    if (month == null) return null
    return payload(
      'MEDICAL_LEAVES_SUMMARY',
      { month, year: year ?? nowY },
      'Licencias que cruzan el mes indicado.',
    )
  }

  const eventEste =
    /\b(eventos?|clases?|turnos?)\b/.test(t) && (/\beste\s+mes\b/.test(t) || /\beste\s+ano\b/.test(t))
  const eventAssignedCue =
    /\b(eventos?|clases?|turnos?)\b/.test(t) &&
    (/\basignad/.test(t) || /\bdocentes?\b/.test(t) || /\bdel\s+docente\b/.test(t) || /\bdocente\s+[a-záéíóúñ]/.test(t) || eventEste)
  if (eventAssignedCue) {
    if (/\beste\s+ano\b/.test(t)) {
      return payload(
        'ASSIGNED_EVENTS_SUMMARY',
        {
          dateFrom: `${nowY}-01-01`,
          dateTo: `${nowY}-12-31`,
        },
        'Eventos asignados en el año en curso (UTC).',
      )
    }
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

  /** "tardanz" sola no matchea "tardanzas". Incluye "llegó tarde" y "¿cuántas veces … tarde?". */
  const latePhrase =
    /\b(tardanzas?|llegadas?\s+tarde|entrada\s+tarde|lleg[oó]\s+tarde)\b/.test(t) ||
    (/\bcuantas\s+veces\b/.test(t) && /\blleg[oó]\s+tarde\b/.test(t))
  if (latePhrase) {
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
