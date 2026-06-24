import { DateTime } from 'luxon'
import { getAppTimezone } from '../../config/app-timezone.js'
import { getPlannedInstances } from '../analytics/planInstances.js'
import { resolveAttendanceAndJustification } from '../analytics/resolveInstances.js'
import type { ResolvedAttendanceByInstance } from '../analytics/models.js'
import { resolveEffectiveYmdRange } from './date-range.js'
import { resolveUserIdsFromSearch } from './helpers.js'
import type { LlmIntentPayload, QueryAssistantTableResult } from './schemas.js'
import { schoolYearSummarySuffix, type QueryAssistantScope } from './scope.js'

const MAX_LIST_ROWS = 200

/**
 * Estados resueltos que cuentan como falta a un evento asignado. Mismo criterio que
 * el listado admin de asistencias (ABSENCE_RESOLVED_STATUSES en routes/attendance.ts).
 */
const ABSENT_RESOLVED = new Set(['ABSENT_NOT_JUSTIFIED', 'ABSENT_JUSTIFIED', 'SUBSTITUTED'])

const STATUS_LABEL: Record<string, string> = {
  ABSENT_NOT_JUSTIFIED: 'Ausente (no justificada)',
  ABSENT_JUSTIFIED: 'Ausente (justificada)',
  SUBSTITUTED: 'Ausente (clase suplida)',
}

function ymdToDdMmYyyy(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${y}`
}

function clockUy(at: Date | null): string {
  if (!at) return '—'
  return DateTime.fromJSDate(new Date(at), { zone: 'utc' }).setZone(getAppTimezone()).toFormat('HH:mm')
}

/**
 * Faltas a eventos asignados, derivadas del horario planificado + marcas registradas
 * (la misma resolución que usa el listado admin). Las ausencias en EduTrack pueden no
 * existir como filas de "Attendance" hasta que un admin las materializa, así que un
 * SQL directo sobre esa tabla las subcuenta: este informe las calcula igual que la UI.
 */
/** Conteo de faltas por persona (ranking), con límite opcional a los N primeros. */
function buildCountByUser(
  absences: ResolvedAttendanceByInstance[],
  opts: { reply: string; baseSummary: string; topN?: number },
): QueryAssistantTableResult {
  type Acc = { persona: string; rol: string; total: number; noJustificadas: number; justificadas: number }
  const byUser = new Map<string, Acc>()
  for (const row of absences) {
    const uid = row.planned.userIdRequired as string
    const acc = byUser.get(uid) ?? {
      persona: row.userDisplayName,
      rol: row.userRole,
      total: 0,
      noJustificadas: 0,
      justificadas: 0,
    }
    acc.total += 1
    // Una ausencia "suplida" (SUBSTITUTED) es el titular que no asistió y fue cubierto. Cuenta
    // como justificada SOLO si tiene una licencia que cubra esa fecha; si no, es no justificada.
    const esJustificada =
      row.checkInStatusResolved === 'ABSENT_JUSTIFIED' ||
      (row.checkInStatusResolved === 'SUBSTITUTED' && row.isJustifiedAbsence)
    if (esJustificada) acc.justificadas += 1
    else acc.noJustificadas += 1
    byUser.set(uid, acc)
  }

  const ranked = [...byUser.values()].sort((a, b) => b.total - a.total)
  const { topN } = opts
  const rows = (topN ? ranked.slice(0, topN) : ranked).map((acc) => ({
    persona: acc.persona,
    rol: acc.rol,
    faltas: acc.total,
    no_justificadas: acc.noJustificadas,
    justificadas: acc.justificadas,
  }))

  let topNote = ''
  if (topN === 1) topNote = ' Se muestra quien más faltó.'
  else if (topN) topNote = ` Se muestran los ${topN} con más faltas.`

  return {
    intent: 'ABSENCES_SUMMARY',
    summary: opts.reply || `${opts.baseSummary} Conteo por persona (${absences.length} faltas en total).${topNote}`,
    columns: [
      { key: 'persona', label: 'Persona' },
      { key: 'rol', label: 'Rol' },
      { key: 'faltas', label: 'Faltas' },
      { key: 'no_justificadas', label: 'No justificadas' },
      { key: 'justificadas', label: 'Justificadas' },
    ],
    rows,
  }
}

export async function executeAbsencesSummary(
  payload: LlmIntentPayload,
  scope?: QueryAssistantScope,
): Promise<QueryAssistantTableResult> {
  const range = resolveEffectiveYmdRange(payload.params, scope)
  if (!range) {
    return {
      intent: 'ABSENCES_SUMMARY',
      summary: payload.reply || 'Indicá el mes (ej.: junio) o un rango de fechas para listar las faltas.',
      columns: [],
      rows: [],
    }
  }

  const { from, to } = range
  const userIds = await resolveUserIdsFromSearch(payload.params.userSearch)
  if (userIds !== null && userIds.length === 0) {
    return {
      intent: 'ABSENCES_SUMMARY',
      summary: 'No encontré usuarios que coincidan con el nombre o texto indicado.',
      columns: [],
      rows: [],
    }
  }

  const planned = await getPlannedInstances({
    from,
    to,
    ...(userIds ? { userIds } : {}),
    ...(scope?.schoolYearId && !scope.allYears ? { schoolYearId: scope.schoolYearId } : {}),
  })

  // Solo ocurrencias ya finalizadas: una clase futura sin marca todavía no es una falta.
  const now = Date.now()
  const finished = planned.filter(
    (p) => p.userIdRequired && p.plannedEndTime && new Date(p.plannedEndTime).getTime() <= now,
  )

  const resolved = await resolveAttendanceAndJustification({ plannedInstances: finished })

  const roleScope = payload.params.personRoleScope
  const absences = resolved.filter((row) => {
    if (!ABSENT_RESOLVED.has(row.checkInStatusResolved)) return false
    if (roleScope && row.userRole !== roleScope) return false
    return true
  })

  const periodText = `entre ${from} y ${to}${schoolYearSummarySuffix(scope)}`
  const baseSummary =
    `Faltas a eventos asignados ${periodText}, derivadas del horario planificado y las marcas registradas ` +
    '(incluye ausencias aún no materializadas en el listado de asistencias).'

  if (payload.params.incidentViewMode === 'COUNT_BY_USER') {
    return buildCountByUser(absences, { reply: payload.reply, baseSummary, topN: payload.params.topN })
  }

  const rows = [...absences]
    .sort((a, b) => b.planned.plannedDate.localeCompare(a.planned.plannedDate))
    .slice(0, MAX_LIST_ROWS)
    .map((row) => ({
      persona: row.userDisplayName,
      rol: row.userRole,
      fecha: ymdToDdMmYyyy(row.planned.plannedDate),
      evento: row.planned.subjectLabel
        ? `${row.planned.eventTitle} (${row.planned.subjectLabel})`
        : row.planned.eventTitle,
      horario: `${clockUy(row.planned.plannedStartTime)}–${clockUy(row.planned.plannedEndTime)}`,
      estado: STATUS_LABEL[row.checkInStatusResolved] ?? row.checkInStatusResolved,
    }))

  const truncatedNote = absences.length > MAX_LIST_ROWS ? ` Se muestran las primeras ${MAX_LIST_ROWS}.` : ''
  return {
    intent: 'ABSENCES_SUMMARY',
    summary: payload.reply || `${baseSummary} ${absences.length} faltas encontradas.${truncatedNote}`,
    columns: [
      { key: 'persona', label: 'Persona' },
      { key: 'rol', label: 'Rol' },
      { key: 'fecha', label: 'Fecha' },
      { key: 'evento', label: 'Evento' },
      { key: 'horario', label: 'Horario' },
      { key: 'estado', label: 'Estado' },
    ],
    rows,
  }
}
