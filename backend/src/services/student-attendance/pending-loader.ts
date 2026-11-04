import { prisma } from '../../db/prisma.js'
import { applyEventStartDateFilter, expandRecurringEvent } from '../../events/events-query.js'
import { occurrenceYmdOf } from '../events/occurrence-instant.js'
import { selectPendingOccurrences, sessionKey, type ExpandedOccurrence, type PendingRow } from './pending.js'

/**
 * Las listas de clase ya terminadas que nadie pasó, en un rango. Lo usan "Listas sin pasar" de
 * administración (todo el liceo, o un docente) y el Inicio del docente (lo suyo). Antes vivía
 * dentro de la ruta de administración, y el docente no tenía cómo ver una lista atrasada de ayer.
 */

export type PendingFilters = {
  schoolYearId: string
  from: string
  to: string
  /** Sólo las listas de las que es responsable: como titular, o el día que cubrió. */
  teacherUserId?: string
  courseOfferingId?: string
  subjectId?: string
  now?: Date
}

type Person = { id: string; name: string | null; username: string | null }

const dayRange = (from: string, to: string) => ({ gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T23:59:59.999Z`) })

/** Las clases del rango: las del docente como titular y las que cubrió como suplente. */
async function loadClassEvents(filters: PendingFilters) {
  const { teacherUserId } = filters
  const covered = teacherUserId
    ? await prisma.substitution.findMany({
        where: { substituteUserId: teacherUserId, date: dayRange(filters.from, filters.to) },
        select: { eventId: true },
      })
    : []
  const where: Record<string, unknown> = {
    type: 'CLASE',
    status: { not: 'CANCELLED' },
    parentEventId: null,
    schoolYearId: filters.schoolYearId,
    ...(filters.courseOfferingId ? { courseOfferingId: filters.courseOfferingId } : {}),
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    ...(teacherUserId ? { OR: [{ assignedUserId: teacherUserId }, { id: { in: covered.map((row) => row.eventId) } }] } : {}),
  }
  applyEventStartDateFilter(where, filters.from, filters.to)
  return prisma.event.findMany({
    where: where as never,
    include: {
      subject: { select: { name: true } },
      orientation: { select: { name: true } },
      courseOrientation: { select: { orientation: { select: { name: true } } } },
      courseOffering: { select: { course: { select: { name: true } } } },
      assignedUser: { select: { id: true, name: true, username: true } },
      childEvents: true,
    },
    orderBy: { startTime: 'asc' },
  })
}

/** Quién cubrió cada ocurrencia: ese día la lista es del suplente. */
async function substitutesByOccurrence(eventIds: readonly string[], from: string, to: string): Promise<Map<string, Person>> {
  if (eventIds.length === 0) return new Map()
  const rows = await prisma.substitution.findMany({
    where: { eventId: { in: [...eventIds] }, date: dayRange(from, to) },
    select: { eventId: true, date: true, substitute: { select: { id: true, name: true, username: true } } },
  })
  return new Map(rows.map((row) => [sessionKey(row.eventId, occurrenceYmdOf(row.date)), row.substitute]))
}

/**
 * El día civil a mediodía UTC (09:00 en Uruguay). Expandir con `YYYY-MM-DD` lo leía como la
 * medianoche UTC, que en Uruguay es todavía el día anterior: el último día del rango quedaba afuera
 * y "Listas sin pasar" de hoy mostraba las de ayer.
 */
const civilNoon = (ymd: string) => `${ymd}T12:00:00.000Z`

function expandOccurrences(events: any[], substitutes: ReadonlyMap<string, Person>, from: string, to: string): ExpandedOccurrence[] {
  return events.flatMap((event) =>
    (expandRecurringEvent(event, civilNoon(from), civilNoon(to)) as any[]).map((occ) => {
      const startAt = new Date(occ.startTime ?? occ.startDate)
      const ymd = occurrenceYmdOf(startAt)
      const substitute = substitutes.get(sessionKey(event.id, ymd))
      // Responsable de la lista: el suplente del día, si lo hubo; si no, el titular.
      const responsible: Person | null = substitute ?? event.assignedUser ?? null
      return {
        eventId: event.id,
        ymd,
        startAt,
        endAt: new Date(occ.endTime ?? occ.startDate),
        title: event.title,
        subject: event.subject?.name ?? null,
        course: event.courseOffering?.course?.name ?? null,
        orientation: event.courseOrientation?.orientation?.name ?? event.orientation?.name ?? null,
        teacher: responsible ? { id: responsible.id, name: responsible.name, username: responsible.username } : null,
        titular: event.assignedUser ? { id: event.assignedUser.id, name: event.assignedUser.name, username: event.assignedUser.username } : null,
        covered: Boolean(substitute),
      }
    }),
  )
}

async function sessionsAndHolidays(eventIds: readonly string[], from: string, to: string) {
  const [nonWorkingRows, sessionRows] = await Promise.all([
    (prisma as any).nonWorkingDay.findMany({
      where: { date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) } },
      select: { date: true },
    }),
    prisma.studentAttendanceSession.findMany({
      where: { occurrenceYmd: { gte: from, lte: to }, eventId: { in: [...eventIds] } },
      select: { id: true, eventId: true, occurrenceYmd: true, status: true, lockedAt: true },
    }),
  ])
  return {
    nonWorkingYmds: new Set<string>(nonWorkingRows.map((row: { date: Date }) => new Date(row.date).toISOString().slice(0, 10))),
    sessions: new Map(
      sessionRows.map((s) => [sessionKey(s.eventId, s.occurrenceYmd), { id: s.id, status: s.status as string, lockedAt: s.lockedAt }]),
    ),
  }
}

export async function loadPendingOccurrences(filters: PendingFilters): Promise<PendingRow[]> {
  const events = await loadClassEvents(filters)
  const eventIds = events.map((event) => event.id)
  const substitutes = await substitutesByOccurrence(eventIds, filters.from, filters.to)
  const occurrences = expandOccurrences(events, substitutes, filters.from, filters.to)
    // Con filtro por docente, sólo las listas de las que es responsable: no las que cubrió otro.
    .filter((occurrence) => !filters.teacherUserId || occurrence.teacher?.id === filters.teacherUserId)
  const { nonWorkingYmds, sessions } = await sessionsAndHolidays(eventIds, filters.from, filters.to)
  return selectPendingOccurrences({ occurrences, sessions, nonWorkingYmds, now: filters.now ?? new Date() })
}
