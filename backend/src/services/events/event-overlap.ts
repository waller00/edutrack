import { DateTime } from 'luxon'
import { getAppTimezone, jsWeekdayInUruguay } from '../../config/app-timezone.js'

/**
 * Validación de doble-reserva en eventos (clases/jornadas/reuniones).
 *
 * Un docente no puede quedar asignado a dos ocurrencias que se pisan en horario, y un mismo
 * grupo (solo CLASE) no puede tener dos clases simultáneas. Se comparan ocurrencias teniendo
 * en cuenta recurrencia (daysOfWeek), ventana de vigencia (effectiveFrom/Until) y horario.
 */

const COVERED_TYPES = ['CLASE', 'JORNADA_LABORAL', 'REUNION']

export type EventSchedule = {
  id?: string | null
  type: string
  assignedUserId: string | null
  startTime: Date
  endTime: Date
  startDate: Date
  isRecurring: boolean
  daysOfWeek: number[]
  effectiveFrom?: Date | null
  effectiveUntil?: Date | null
  recurrenceEnd?: Date | null
  schoolYearId: string
  courseOfferingId?: string | null
  courseOrientationId?: string | null
  revisionOf?: string | null
}

export type EventOverlapConflict = {
  eventId: string
  title: string
  kind: 'TEACHER' | 'GROUP'
}

type FetchedSchedule = EventSchedule & { id: string; title: string }

function minutesOfDay(d: Date): number {
  const t = DateTime.fromJSDate(d, { zone: 'utc' }).setZone(getAppTimezone())
  return t.hour * 60 + t.minute
}

function ymdInUruguay(d: Date): string {
  return DateTime.fromJSDate(d, { zone: 'utc' }).setZone(getAppTimezone()).toFormat('yyyy-MM-dd')
}

function timeWindowsOverlap(a: EventSchedule, b: EventSchedule): boolean {
  const aStart = minutesOfDay(a.startTime)
  const aEnd = minutesOfDay(a.endTime)
  const bStart = minutesOfDay(b.startTime)
  const bEnd = minutesOfDay(b.endTime)
  return aStart < bEnd && bStart < aEnd
}

function rangeOf(s: EventSchedule): { fromYmd: string; untilYmd: string | null } {
  const from = s.effectiveFrom ?? s.startDate
  const until = s.effectiveUntil ?? s.recurrenceEnd ?? null
  return { fromYmd: ymdInUruguay(from), untilYmd: until ? ymdInUruguay(until) : null }
}

function dateRangesOverlap(a: EventSchedule, b: EventSchedule): boolean {
  const ra = rangeOf(a)
  const rb = rangeOf(b)
  const aAfterB = rb.untilYmd !== null && ra.fromYmd > rb.untilYmd
  const bAfterA = ra.untilYmd !== null && rb.fromYmd > ra.untilYmd
  return !aAfterB && !bAfterA
}

function daysIntersect(a: number[], b: number[]): boolean {
  return a.some((d) => b.includes(d))
}

function nonRecurringHitsRecurring(single: EventSchedule, rec: EventSchedule): boolean {
  const dayOk = rec.daysOfWeek.includes(jsWeekdayInUruguay(single.startTime))
  if (!dayOk) return false
  const r = rangeOf(rec)
  const dYmd = ymdInUruguay(single.startTime)
  if (dYmd < r.fromYmd) return false
  return r.untilYmd === null || dYmd <= r.untilYmd
}

/** ¿Existe alguna fecha donde ambas ocurrencias caigan, dado que sus horarios ya se solapan? */
function occurrenceDaysOverlap(a: EventSchedule, b: EventSchedule): boolean {
  if (a.isRecurring && b.isRecurring) {
    return daysIntersect(a.daysOfWeek, b.daysOfWeek) && dateRangesOverlap(a, b)
  }
  if (a.isRecurring) return nonRecurringHitsRecurring(b, a)
  if (b.isRecurring) return nonRecurringHitsRecurring(a, b)
  return ymdInUruguay(a.startTime) === ymdInUruguay(b.startTime)
}

function schedulesConflict(a: EventSchedule, b: EventSchedule): boolean {
  return timeWindowsOverlap(a, b) && occurrenceDaysOverlap(a, b)
}

function groupKeyOf(s: EventSchedule): string | null {
  return s.courseOrientationId ?? s.courseOfferingId ?? null
}

/**
 * Tipo de conflicto entre dos agendas (o null si no chocan). Útil para validar colisiones
 * dentro de un mismo lote de importación, donde los eventos aún no están persistidos.
 */
export function conflictKindBetween(a: EventSchedule, b: EventSchedule): 'TEACHER' | 'GROUP' | null {
  if (!schedulesConflict(a, b)) return null
  const bothCovered = COVERED_TYPES.includes(a.type) && COVERED_TYPES.includes(b.type)
  if (bothCovered && a.assignedUserId && b.assignedUserId && a.assignedUserId === b.assignedUserId) {
    return 'TEACHER'
  }
  const groupKey = groupKeyOf(a)
  if (a.type === 'CLASE' && b.type === 'CLASE' && groupKey && groupKey === groupKeyOf(b)) {
    return 'GROUP'
  }
  return null
}

/** Excluye el propio evento y toda su familia de versiones (revisionOf). */
function isSameFamily(candidate: EventSchedule, other: FetchedSchedule): boolean {
  const familyRoot = candidate.revisionOf ?? candidate.id ?? null
  if (!familyRoot) return false
  return other.id === familyRoot || other.revisionOf === familyRoot
}

const scheduleSelect = {
  id: true,
  title: true,
  type: true,
  assignedUserId: true,
  startTime: true,
  endTime: true,
  startDate: true,
  isRecurring: true,
  daysOfWeek: true,
  effectiveFrom: true,
  effectiveUntil: true,
  recurrenceEnd: true,
  schoolYearId: true,
  courseOfferingId: true,
  courseOrientationId: true,
  revisionOf: true,
} as const

async function fetchCandidateSchedules(db: any, where: any): Promise<FetchedSchedule[]> {
  const rows = await db.event.findMany({
    where: {
      ...where,
      status: { not: 'CANCELLED' },
      type: { in: COVERED_TYPES },
      startTime: { not: null },
      endTime: { not: null },
    },
    select: scheduleSelect,
  })
  return rows as FetchedSchedule[]
}

function firstConflict(
  candidate: EventSchedule,
  others: FetchedSchedule[],
  kind: 'TEACHER' | 'GROUP',
): EventOverlapConflict | null {
  for (const other of others) {
    if (isSameFamily(candidate, other)) continue
    if (candidate.id && other.id === candidate.id) continue
    if (schedulesConflict(candidate, other)) {
      return { eventId: other.id, title: other.title, kind }
    }
  }
  return null
}

async function findTeacherOverlap(db: any, candidate: EventSchedule): Promise<EventOverlapConflict | null> {
  if (!candidate.assignedUserId || !COVERED_TYPES.includes(candidate.type)) return null
  const others = await fetchCandidateSchedules(db, {
    assignedUserId: candidate.assignedUserId,
    schoolYearId: candidate.schoolYearId,
  })
  return firstConflict(candidate, others, 'TEACHER')
}

async function findGroupOverlap(db: any, candidate: EventSchedule): Promise<EventOverlapConflict | null> {
  // Solo las clases ocupan un grupo; jornadas y reuniones no aplican.
  if (candidate.type !== 'CLASE') return null
  if (!groupKeyOf(candidate)) return null
  const groupWhere = candidate.courseOrientationId
    ? { courseOrientationId: candidate.courseOrientationId }
    : { courseOfferingId: candidate.courseOfferingId }
  const others = await fetchCandidateSchedules(db, { ...groupWhere, schoolYearId: candidate.schoolYearId })
  return firstConflict(candidate, others, 'GROUP')
}

/** Devuelve el primer conflicto (docente o grupo) o null si la agenda está libre. */
export async function findEventOverlapConflict(db: any, candidate: EventSchedule): Promise<EventOverlapConflict | null> {
  return (await findTeacherOverlap(db, candidate)) ?? (await findGroupOverlap(db, candidate))
}
