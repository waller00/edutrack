import { DateTime } from 'luxon'
import { getAppTimezone, uruguayWallToUtc, uruguayYmdEndOfDayToUtc } from '../../config/app-timezone.js'
import { toYmdUtc } from '../analytics/dateRange.js'

/**
 * Fuente única de verdad para presencia, cobertura y horas por ocurrencia.
 *
 * Modelo de SPAN (reemplaza al modelo de bloque): la jornada de un docente se reconstruye como
 * intervalos de presencia [CHECK_IN, CHECK_OUT] por día. Cada ocurrencia de clase se evalúa de
 * forma independiente contra TODOS los spans del día:
 *  - cubierta si su intervalo se solapa con algún span de presencia;
 *  - las horas pagas son la intersección clase∩span clampeada a la ventana planificada
 *    (las horas de espera entre clases nunca se pagan);
 *  - una clase sin span solapado queda ausente (caso: presente 8-9, falta 11-12, vuelve 14-15).
 */

export type AttendanceRowLite = {
  id: string
  userId: string
  eventId: string | null
  date: Date
  time: Date
  type: string // 'CHECK_IN' | 'CHECK_OUT'
  status: string
  notes: string | null
}

export type PresenceSpan = {
  userId: string
  ymd: string
  checkIn: AttendanceRowLite
  /** null => span abierto: hay entrada pero no salida registrada (se asume permanencia). */
  checkOut: AttendanceRowLite | null
}

export type OccurrenceWindow = {
  userId: string | null
  ymd: string
  plannedStart: Date | null
  plannedEnd: Date | null
}

export type CoverageResult = {
  covered: boolean
  overlapMinutes: number
  span: PresenceSpan | null
}

export type OccurrenceOutcome =
  | 'PRESENT'
  | 'LATE'
  | 'ABSENT_NOT_JUSTIFIED'
  | 'ABSENT_JUSTIFIED'
  | 'SUBSTITUTED'

export type ClassEventSlot = {
  id: string
  title: string
  type: string
  startTime: Date
  endTime: Date
  schoolYearId?: string | null
}

export function userDateKey(userId: string, ymd: string) {
  return `${userId}_${ymd}`
}

/** Ventana (min) antes del inicio de una clase en la que una entrada cuenta como anticipada. */
export function earlyEntryWindowMinutes(bridgeGapMinutes: number): number {
  return Math.min(240, Math.max(90, bridgeGapMinutes))
}

function makeSpan(checkIn: AttendanceRowLite, checkOut: AttendanceRowLite | null): PresenceSpan {
  return { userId: checkIn.userId, ymd: toYmdUtc(checkIn.date), checkIn, checkOut }
}

/** Empareja CHECK_IN→CHECK_OUT del día. Un CHECK_IN sin salida queda como span abierto. */
function pairSpansForDay(rows: AttendanceRowLite[]): PresenceSpan[] {
  const sorted = [...rows].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
  const spans: PresenceSpan[] = []
  let openIn: AttendanceRowLite | null = null
  for (const row of sorted) {
    if (row.type === 'CHECK_IN') {
      if (openIn) spans.push(makeSpan(openIn, null))
      openIn = row
    } else if (row.type === 'CHECK_OUT' && openIn) {
      spans.push(makeSpan(openIn, row))
      openIn = null
    }
  }
  if (openIn) spans.push(makeSpan(openIn, null))
  return spans
}

/** Reconstruye los spans de presencia por usuario+día a partir de las marcaciones. */
export function buildPresenceSpans(rows: AttendanceRowLite[]): Map<string, PresenceSpan[]> {
  const byKey = new Map<string, AttendanceRowLite[]>()
  for (const r of rows) {
    const key = userDateKey(r.userId, toYmdUtc(r.date))
    const existing = byKey.get(key)
    if (existing) existing.push(r)
    else byKey.set(key, [r])
  }
  const spansByKey = new Map<string, PresenceSpan[]>()
  for (const [key, list] of byKey) {
    spansByKey.set(key, pairSpansForDay(list))
  }
  return spansByKey
}

function spanStartMs(span: PresenceSpan) {
  return new Date(span.checkIn.time).getTime()
}

/** Fin efectivo del span: la salida real, o (span abierto) la cota planificada de la ocurrencia. */
function spanEndMs(span: PresenceSpan, fallbackEndMs: number) {
  return span.checkOut ? new Date(span.checkOut.time).getTime() : fallbackEndMs
}

/** Primer span cuyo intervalo se solapa con la ventana planificada de la ocurrencia. */
export function findCoveringSpan(occ: OccurrenceWindow, spans: PresenceSpan[]): PresenceSpan | null {
  if (!occ.plannedStart || !occ.plannedEnd) return null
  const s = occ.plannedStart.getTime()
  const e = occ.plannedEnd.getTime()
  return spans.find((span) => spanStartMs(span) <= e && spanEndMs(span, e) >= s) ?? null
}

function clampNonNegativeMinutes(msDelta: number) {
  return Math.max(0, msDelta / (1000 * 60))
}

/** Minutos efectivos de la intersección presencia∩clase, clampeada a la ventana planificada. */
export function clampedOverlapMinutes(
  actualIn: Date | null,
  actualOut: Date | null,
  plannedStart: Date | null,
  plannedEnd: Date | null,
): number {
  if (!actualIn || !actualOut) return 0
  const start = plannedStart && actualIn < plannedStart ? plannedStart : actualIn
  const end = plannedEnd && actualOut > plannedEnd ? plannedEnd : actualOut
  return clampNonNegativeMinutes(end.getTime() - start.getTime())
}

/** Cobertura (y horas pagas) de una ocurrencia contra el conjunto de spans del día. */
export function coverageForOccurrence(
  occ: OccurrenceWindow,
  spansByKey: Map<string, PresenceSpan[]>,
): CoverageResult {
  if (!occ.userId || !occ.plannedStart || !occ.plannedEnd) {
    return { covered: false, overlapMinutes: 0, span: null }
  }
  const spans = spansByKey.get(userDateKey(occ.userId, occ.ymd)) ?? []
  const span = findCoveringSpan(occ, spans)
  if (!span) return { covered: false, overlapMinutes: 0, span: null }
  const effectiveOut = span.checkOut ? new Date(span.checkOut.time) : occ.plannedEnd
  const overlapMinutes = clampedOverlapMinutes(new Date(span.checkIn.time), effectiveOut, occ.plannedStart, occ.plannedEnd)
  return { covered: true, overlapMinutes, span }
}

function isLateCheckIn(checkInTime: Date, plannedStart: Date | null, toleranceMinutes = 5): boolean {
  if (!plannedStart) return false
  const lateMs = new Date(checkInTime).getTime() - plannedStart.getTime()
  return lateMs > toleranceMinutes * 60 * 1000
}

/**
 * Única decisión de estado por ocurrencia. El no-show es la cara accionable de
 * ABSENT_NOT_JUSTIFIED en una clase ya iniciada.
 */
export function resolveOccurrenceOutcome(
  occ: OccurrenceWindow,
  spansByKey: Map<string, PresenceSpan[]>,
  ctx: { hasSubstitution: boolean; hasLicense: boolean; lateToleranceMinutes?: number },
): OccurrenceOutcome {
  if (ctx.hasSubstitution) return 'SUBSTITUTED'
  const { span } = coverageForOccurrence(occ, spansByKey)
  if (span) {
    return isLateCheckIn(span.checkIn.time, occ.plannedStart, ctx.lateToleranceMinutes) ? 'LATE' : 'PRESENT'
  }
  return ctx.hasLicense ? 'ABSENT_JUSTIFIED' : 'ABSENT_NOT_JUSTIFIED'
}

/**
 * Trae las clases (titulares + suplencias) asignadas a un docente en un día civil de Uruguay.
 * Usado por la ingesta biométrica y la detección de no-show para resolver ocurrencias del día.
 */
export async function fetchTeacherClassSlotsForUruguayDay(tx: any, userId: string, at: Date): Promise<ClassEventSlot[]> {
  const ymd = DateTime.fromJSDate(at, { zone: 'utc' }).setZone(getAppTimezone()).toFormat('yyyy-MM-dd')
  const dayStart = uruguayWallToUtc(ymd, 0, 0)
  const dayEnd = uruguayYmdEndOfDayToUtc(ymd)
  const weekday = DateTime.fromISO(ymd, { zone: getAppTimezone() }).weekday % 7
  const rows = await tx.event.findMany({
    where: {
      assignedUserId: userId,
      type: { in: ['CLASE', 'JORNADA_LABORAL', 'REUNION'] },
      status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      startTime: { not: null },
      endTime: { not: null },
      startDate: { lte: dayEnd },
      OR: [{ endDate: null }, { endDate: { gte: dayStart } }, { recurrenceEnd: { gte: dayStart } }],
    },
    select: {
      id: true,
      title: true,
      type: true,
      startDate: true,
      endDate: true,
      startTime: true,
      endTime: true,
      isRecurring: true,
      daysOfWeek: true,
      recurrenceEnd: true,
      schoolYearId: true,
    },
    orderBy: { startTime: 'asc' },
  })
  const substitutionRows = await tx.$queryRaw<
    { eventId: string; title: string; type: string; startTime: Date; endTime: Date }[]
  >`
    SELECT s."eventId", e."title", e."type"::text AS "type", s."startTime", s."endTime"
    FROM "Substitution" s
    JOIN "Event" e ON e."id" = s."eventId"
    WHERE s."substituteUserId" = ${userId}
      AND s."date" >= ${dayStart}
      AND s."date" <= ${dayEnd}
      AND e."type" IN ('CLASE'::"EventType", 'JORNADA_LABORAL'::"EventType", 'REUNION'::"EventType")
      AND e."status" IN ('SCHEDULED'::"EventStatus", 'IN_PROGRESS'::"EventStatus")
    ORDER BY s."startTime" ASC
  `

  function wallTimeOnDay(stored: Date) {
    const wall = DateTime.fromJSDate(stored, { zone: 'utc' }).setZone(getAppTimezone())
    return uruguayWallToUtc(ymd, wall.hour, wall.minute)
  }

  function eventOccursOnDay(row: {
    startDate: Date
    endDate: Date | null
    recurrenceEnd: Date | null
    isRecurring: boolean
    daysOfWeek: number[]
    startTime: Date
  }) {
    if (row.isRecurring) {
      const recurrenceLimit = row.recurrenceEnd ?? row.endDate
      if (toYmdUtc(row.startDate) > ymd) return false
      if (recurrenceLimit && toYmdUtc(recurrenceLimit) < ymd) return false
      const days = row.daysOfWeek.length ? row.daysOfWeek : [DateTime.fromJSDate(row.startTime, { zone: 'utc' }).setZone(getAppTimezone()).weekday % 7]
      return days.includes(weekday)
    }
    return toYmdUtc(row.startTime) === ymd
  }

  return [
    ...rows
      .filter(eventOccursOnDay)
      .map((r: { id: string; title: string; type: string; startTime: Date; endTime: Date; schoolYearId?: string | null }) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        startTime: wallTimeOnDay(new Date(r.startTime)),
        endTime: wallTimeOnDay(new Date(r.endTime)),
        schoolYearId: r.schoolYearId ?? null,
      })),
    ...substitutionRows.map((r) => ({
      id: r.eventId,
      title: `${r.title} (suplencia)`,
      type: r.type,
      startTime: new Date(r.startTime),
      endTime: new Date(r.endTime),
    })),
  ].sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
}
