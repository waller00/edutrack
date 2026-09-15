import { prisma } from '../../db/prisma.js'
import { uruguayWallToUtc } from '../../config/app-timezone.js'
import { classifyOccurrence, isOccurrenceOk } from '../student-attendance/occurrence.js'
import { findNonWorkingDayForDate } from '../non-working-days.js'

const EVENT_INCLUDE = {
  subject: { select: { id: true, name: true, code: true } },
  orientation: { select: { id: true, name: true, code: true } },
  courseOrientation: {
    select: { id: true, orientation: { select: { id: true, name: true, code: true } } },
  },
  courseOffering: { select: { id: true, course: { select: { id: true, name: true, code: true } } } },
  assignedUser: { select: { id: true, name: true, username: true } },
  childEvents: true,
} as const

export type GradeBookScope = {
  schoolYearId: string
  courseOfferingId: string
  subjectId: string
  orientationId: string | null
  courseOrientationId: string | null
}

/**
 * Eventos de CLASE del mismo alcance académico que la libreta (misma clave Moodle/scope).
 * Incluye `childEvents` para que `classifyOccurrence` detecte suspensiones.
 */
export async function findClassEventsForGradeBook(scope: GradeBookScope) {
  return prisma.event.findMany({
    where: {
      type: 'CLASE',
      status: { not: 'CANCELLED' },
      parentEventId: null,
      schoolYearId: scope.schoolYearId,
      courseOfferingId: scope.courseOfferingId,
      subjectId: scope.subjectId,
      orientationId: scope.orientationId,
      courseOrientationId: scope.courseOrientationId,
    },
    include: EVENT_INCLUDE,
    orderBy: { startDate: 'asc' },
  })
}

type GradeBookEvent = Awaited<ReturnType<typeof findClassEventsForGradeBook>>[number]

export type DayOccurrence =
  | { kind: 'non_working'; label: string; anchorEvent: GradeBookEvent | null }
  | { kind: 'no_class'; anchorEvent: GradeBookEvent | null }
  | {
      kind: 'class'
      event: GradeBookEvent
      startAt: Date
      endAt: Date
      /** Si hay más de una hora ese día, se usa la más temprana para marcar. */
      occurrenceCount: number
    }

/**
 * ¿Hay clase de esta libreta el día civil `ymd`?
 * Usa `classifyOccurrence` (no `new Date(ymd)`).
 * Si no hay ocurrencia pero existe algún evento del scope, `anchorEvent` permite marcar igual
 * (modo “S/H” del Libro del Profesor).
 */
export async function resolveGradeBookDayOccurrence(
  scope: GradeBookScope,
  ymd: string,
): Promise<DayOccurrence> {
  const events = await findClassEventsForGradeBook(scope)
  const anchorEvent = events[0] ?? null

  const nwd = await findNonWorkingDayForDate(new Date(`${ymd}T00:00:00.000Z`))
  if (nwd) {
    return {
      kind: 'non_working',
      label: nwd.reason || nwd.type || 'Día no laborable',
      anchorEvent,
    }
  }

  const ok = events
    .map((event) => {
      const occurrence = classifyOccurrence(event as any, ymd)
      if (!isOccurrenceOk(occurrence)) return null
      return { event, startAt: occurrence.startAt, endAt: occurrence.endAt }
    })
    .filter((row): row is NonNullable<typeof row> => row != null)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())

  if (ok.length === 0) return { kind: 'no_class', anchorEvent }

  return {
    kind: 'class',
    event: ok[0].event,
    startAt: ok[0].startAt,
    endAt: ok[0].endAt,
    occurrenceCount: ok.length,
  }
}

/**
 * Evento + ventana horaria donde persistir la marca del día.
 * En modo S/H (sin ocurrencia de clase) ancla al primer evento del scope
 * con una ventana civil fija, igual que el Libro del Profesor permite marcar.
 * Días no laborables no admiten marca.
 */
export function resolveMarkTarget(
  day: DayOccurrence,
  ymd: string,
): { event: GradeBookEvent; startAt: Date; endAt: Date } | null {
  if (day.kind === 'non_working') return null
  if (day.kind === 'class') {
    return { event: day.event, startAt: day.startAt, endAt: day.endAt }
  }
  if (!day.anchorEvent) return null
  return {
    event: day.anchorEvent,
    startAt: uruguayWallToUtc(ymd, 8, 0),
    endAt: uruguayWallToUtc(ymd, 9, 0),
  }
}
