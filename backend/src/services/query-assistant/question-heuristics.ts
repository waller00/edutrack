import { DateTime } from 'luxon'
import { APP_TIMEZONE } from '../../config/app-timezone.js'
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

const ROLE_PERSON_WORD = String.raw`docentes?|profesor(?:es)?|profesora(?:s)?|profes?|maestros?|maestras?|educadores?|tutores?|funcionarios?|personal|staff|administrativos?|adscriptos?|bedeles?`
const ABSENCE_WORD = String.raw`falt(?:[oó]|a|an|as|e|aron|ado)?|ausent[oó]?|ausentes?|ausencias?|no\s+show|inasistencias?|inasisten|no\s+vino|no\s+lleg[oó]?`
const LATE_WORD = String.raw`tardanzas?|tard[ií]as?|atrasos?|retrasos?|llegadas?\s+tarde|entrada\s+tarde|lleg(?:[oó]|aron|an)\s+tarde`
const EARLY_EXIT_WORD = String.raw`salidas?\s+anticipad[ao]s?|retiros?\s+tempran[ao]s?|se\s+retir[oó]\s+antes|se\s+fue\s+antes`
const EVENT_WORD = String.raw`eventos?|clases?|turnos?|jornadas?|reuniones?|actividades?`
const BIOMETRIC_WORD = String.raw`biometric[oa]s?|biometria|reloj(?:es)?|marcador(?:es)?|terminal(?:es)?|lectores?`

/**
 * Señales de dominios que tienen informe propio (faltas, tardanzas, horas, licencias,
 * incidencias, eventos, biométrico, auditoría, asistencias). Si alguna aparece, palabras
 * como "usuarios" o "personal" solo nombran a las personas de esa pregunta y el listado
 * administrativo de cuentas NO corresponde: la consulta debe enrutar al dominio específico.
 * Regla de precedencia única para que la clasificación no dependa del orden de las ramas.
 */
const NON_USER_DOMAIN_CUE = new RegExp(
  [
    String.raw`\b(?:${ABSENCE_WORD})\b`,
    String.raw`\b(?:${LATE_WORD})\b`,
    String.raw`\b(?:${EARLY_EXIT_WORD})\b`,
    String.raw`\b(?:${EVENT_WORD})\b`,
    String.raw`\b(?:${BIOMETRIC_WORD})\b`,
    String.raw`\bhoras?\b`,
    String.raw`\blicencias?\b|\bpermiso\s+(?:medico|laboral)\b`,
    String.raw`\bincidencias?\b|\bno\s+show\b`,
    String.raw`\basistencias?\b|\bmarcas?\b|\bmarcaron\b|\bficharon\b`,
    String.raw`\bauditoria\b`,
  ].join('|'),
)

/**
 * Pedidos de conteo/ranking por persona en cualquier fraseo: "quién faltó más",
 * "cantidad de veces", "cuántas faltas", "conteo por docente", "top 5".
 */
function wantsCountByUser(t: string): boolean {
  return (
    /\branking\b/.test(t) ||
    /\btop\s+\d+\b/.test(t) ||
    /\b(por\s+persona|por\s+docente|conteo)\b/.test(t) ||
    /\bcuant[ao]s\s+(veces|faltas|ausencias|inasistencias|tardanzas)\b/.test(t) ||
    /\b(cantidad|numero|total)\s+de\s+(veces|faltas|ausencias|inasistencias|tardanzas)\b/.test(t) ||
    (new RegExp(`\\b(quien|que\\s+(?:${ROLE_PERSON_WORD})|(?:${ROLE_PERSON_WORD})\\s+que|el\\s+(?:${ROLE_PERSON_WORD}))\\b`).test(t) &&
      /\b(mas|m[aá]s|mayor|mayores|tiene\s+mas)\b/.test(t))
  )
}

function norm(s: string): string {
  const normalized = s
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

const TEACHER_WORD = String.raw`docentes?|profesor(?:es)?|profesora(?:s)?|profes?|maestros?|maestras?|educadores?`
const STAFF_WORD = String.raw`funcionarios?|personal|staff|administrativos?|adscriptos?|bedeles?`

/** TEACHER/STAFF si la pregunta nombra un colectivo claro; undefined si no distingue. */
function personRoleScopeFromText(t: string): LlmIntentPayload['params']['personRoleScope'] {
  if (new RegExp(`\\b(?:${TEACHER_WORD})\\b`).test(t)) return 'TEACHER'
  if (new RegExp(`\\b(?:${STAFF_WORD})\\b`).test(t)) return 'STAFF'
  return undefined
}

/** Rango por palabras de día relativo ("hoy", "ayer", "esta semana", "semana pasada") en día civil Uruguay. */
function relativeDayRangeFromText(t: string): { dateFrom: string; dateTo: string } | null {
  const today = DateTime.now().setZone(APP_TIMEZONE).startOf('day')
  if (/\bhoy\b/.test(t)) {
    const ymd = today.toISODate()!
    return { dateFrom: ymd, dateTo: ymd }
  }
  if (/\bayer\b/.test(t)) {
    const ymd = today.minus({ days: 1 }).toISODate()!
    return { dateFrom: ymd, dateTo: ymd }
  }
  if (/\besta\s+semana\b/.test(t)) {
    return { dateFrom: today.startOf('week').toISODate()!, dateTo: today.toISODate()! }
  }
  if (/\bsemana\s+pasada\b/.test(t)) {
    const start = today.startOf('week').minus({ weeks: 1 })
    return { dateFrom: start.toISODate()!, dateTo: start.plus({ days: 6 }).toISODate()! }
  }
  return null
}

/**
 * Clasificación local (sin LLM) para frases cortas o cuando el modelo falla.
 * Devuelve null si no hay patrón claro.
 */
export function heuristicIntentFromQuestion(question: string, defaultYear = DateTime.utc().year): LlmIntentPayload | null {
  const t = norm(question)
  if (t.length < 2) return null

  const month = spanishMonthFromQuestion(question)
  const year = yearFromQuestion(question)
  const nowY = defaultYear

  const hoursCue =
    /\bhoras?\b/.test(t) &&
    (/\btrabajad/.test(t) || /\bcuant/.test(t) || /\bjornada\b/.test(t) || new RegExp(`\\b(?:${ROLE_PERSON_WORD})\\b`).test(t))
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

  const usersLikeRequest =
    usersListRequest ||
    usersStatusRequest ||
    genericUsers ||
    docExpireStandalone ||
    /^usuarios?\s*$/i.test(t.trim())

  /**
   * El listado de cuentas solo aplica si la pregunta es sobre las cuentas en sí.
   * "dame los usuarios que faltaron en junio" menciona usuarios pero pregunta por
   * faltas: la señal de dominio gana siempre y la consulta sigue hacia las ramas
   * específicas (o al NL→SQL si ninguna matchea).
   */
  if (usersLikeRequest && !NON_USER_DOMAIN_CUE.test(t)) {
    let scope: NonNullable<LlmIntentPayload['params']['userAdminScope']> = 'ACTIVE_RECENT'
    if (/\b(pendientes?|aprobar|aprobacion)\b/.test(t)) scope = 'PENDING_APPROVAL'
    else if (/\b(inactiv|baja|desactiv)\b/.test(t)) scope = 'INACTIVE'
    else if (/\b(bloquead|bloqueo)\b/.test(t)) scope = 'LOCKED'
    else if (/\b(cedula|documento|venc|vencer)\b/.test(t)) scope = 'DOC_EXPIRING_90D'
    return payload('USERS_ADMIN_SNAPSHOT', { userAdminScope: scope }, 'Listado de usuarios según el criterio pedido.')
  }

  /**
   * Faltas/ausencias a eventos asignados (listado o ranking). Van al informe derivado
   * ABSENCES_SUMMARY (mismo cálculo que el listado admin) y no a SQL ni a incidencias:
   * las ausencias pueden no estar materializadas como filas de "Attendance" y los
   * incidentes TEACHER_NO_SHOW dependen de que el monitor estuviera activo.
   * Si la pregunta habla explícitamente de "incidencias" o "no show", se respeta más
   * abajo el informe de incidencias.
   */
  const mentionsIncidents = /\bincidencias?\b/.test(t) || /\bno\s+show\b/.test(t)
  if (!mentionsIncidents && new RegExp(`\\b(?:${ABSENCE_WORD})\\b`).test(t)) {
    const viewParams = wantsCountByUser(t) ? { incidentViewMode: 'COUNT_BY_USER' as const } : {}
    const roleScope = personRoleScopeFromText(t)
    const roleParams = roleScope ? { personRoleScope: roleScope } : {}

    if (/\beste\s+ano\b/.test(t)) {
      return payload(
        'ABSENCES_SUMMARY',
        { dateFrom: `${nowY}-01-01`, dateTo: `${nowY}-12-31`, ...viewParams, ...roleParams },
        '',
      )
    }
    const relative = relativeDayRangeFromText(t)
    if (relative) {
      return payload('ABSENCES_SUMMARY', { ...relative, ...viewParams, ...roleParams }, '')
    }
    return payload(
      'ABSENCES_SUMMARY',
      {
        month: month ?? DateTime.now().setZone(APP_TIMEZONE).month,
        year: year ?? nowY,
        ...viewParams,
        ...roleParams,
      },
      '',
    )
  }

  /** "¿Quién tiene más llegadas tarde?" → tardanzas por persona (no listado genérico de incidencias). */
  if (
    new RegExp(`\\b(quien|que\\s+(?:${ROLE_PERSON_WORD})|(?:${ROLE_PERSON_WORD})\\s+que|el\\s+(?:${ROLE_PERSON_WORD}))\\b`).test(t) &&
    /\b(mas|m[aá]s|mayor|mayores|tiene\s+mas)\b/.test(t) &&
    new RegExp(`\\b(?:${LATE_WORD})\\b`).test(t)
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

  if (new RegExp(`\\bincidencias?\\b|\\bausencia\\s+(?:${ROLE_PERSON_WORD})\\b|\\bno\\s+show\\b|\\b(?:${EARLY_EXIT_WORD})\\b`).test(t)) {
    const earlyExit = new RegExp(`\\b(?:${EARLY_EXIT_WORD})\\b`).test(t)
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
    new RegExp(`\\b(?:${EVENT_WORD})\\b`).test(t) && (/\beste\s+mes\b/.test(t) || /\beste\s+ano\b/.test(t))
  const eventAssignedCue =
    new RegExp(`\\b(?:${EVENT_WORD})\\b`).test(t) &&
    (/\basignad/.test(t) || new RegExp(`\\b(?:${ROLE_PERSON_WORD})\\b`).test(t) || new RegExp(`\\bdel\\s+(?:${ROLE_PERSON_WORD})\\b`).test(t) || new RegExp(`\\b(?:${ROLE_PERSON_WORD})\\s+[a-záéíóúñ]`).test(t) || eventEste)
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

  if (new RegExp(`\\b(?:${BIOMETRIC_WORD})\\b`).test(t) && /\b(fallid|pendiente|error|problema|sin\s+procesar)\b/.test(t)) {
    if (month == null) return null
    return payload(
      'BIOMETRIC_ISSUES_SUMMARY',
      { month, year: year ?? nowY, biometricIssueScope: 'BOTH' },
      'Marcas biométricas con problemas en el período.',
    )
  }

  /** "tardanz" sola no matchea "tardanzas". Incluye "llegó tarde" y "¿cuántas veces … tarde?". */
  const latePhrase =
    new RegExp(`\\b(?:${LATE_WORD})\\b`).test(t) ||
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
