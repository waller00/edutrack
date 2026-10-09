import { prisma } from '../../db/prisma.js'
import { getStudentRollCallSettings } from '../../config/system-settings.js'
import { findNonWorkingDayForDate } from '../non-working-days.js'
import { findApprovedLicenseCoveringEventTime } from '../medicalLeaveReconciliation.js'
import { classifyOccurrence, isOccurrenceOk } from './occurrence.js'
import { resolveRollCallPermissions, type RollCallBlockReason } from './edit-window.js'
import { occurrenceDateOf } from './roll-call.js'
import { PERSON_SELECT, personRef, type PersonRef } from './person.js'

/** Lo que una clase necesita para mostrarse y para resolver su cohorte. */
export const CLASS_EVENT_INCLUDE = {
  subject: { select: { id: true, name: true, code: true } },
  orientation: { select: { id: true, name: true, code: true } },
  courseOrientation: { select: { id: true, orientation: { select: { id: true, name: true, code: true } } } },
  courseOffering: { select: { id: true, course: { select: { id: true, name: true, code: true } } } },
  assignedUser: { select: PERSON_SELECT },
  childEvents: true,
} as const

export function courseLabelOf(event: any): string | null {
  return event.courseOffering?.course?.name ?? null
}

export function orientationLabelOf(event: any): string | null {
  return event.courseOrientation?.orientation?.name ?? event.orientation?.name ?? null
}

export type DayClassRow = {
  eventId: string
  ymd: string
  title: string
  subject: string | null
  course: string | null
  orientation: string | null
  startAt: Date
  endAt: Date
  /** Titular de la clase. */
  teacher: PersonRef | null
  /** Quien la cubre ese día, si hay suplencia. */
  substitute: PersonRef | null
  /** Quien pide es el suplente, no el titular. */
  isSubstitution: boolean
  nonWorkingDay: string | null
  rollCall: {
    sessionId: string | null
    status: string
    takenAt: Date | null
    /** Quién pasó la lista (puede ser el suplente o administración). */
    takenBy: string | null
    rosterSize: number | null
    canEdit: boolean
    blockedReason: RollCallBlockReason | null
    opensAt: Date
    editableUntil: Date
  }
}

type SubstitutionRow = { eventId: string; substituteUserId: string; substitute: Parameters<typeof personRef>[0] }

/**
 * Clases de un día con el estado de su pase de lista.
 *
 * Con alcance `own` son las del titular y las que cubre como suplente; con `all`, todas las del
 * liceo. Cada fila dice quién es el titular y quién lo suple ese día: así nadie duda de quién pasa
 * la lista. Devuelve `eventId` y `ymd` por separado: el id compuesto `uuid_ymd` de la expansión de
 * recurrencia nunca llega al cliente.
 */
export async function loadClassesForDay(params: {
  userId: string
  scope: 'own' | 'all'
  ymd: string
  now?: Date
}): Promise<DayClassRow[]> {
  const { userId, scope, ymd } = params
  // Las suplencias de un día son pocas: una consulta sirve para saber qué cubre quien pide y
  // quién cubre cada clase.
  const substitutions: SubstitutionRow[] = await (prisma as any).substitution.findMany({
    where: { date: occurrenceDateOf(ymd) },
    select: { eventId: true, substituteUserId: true, substitute: { select: PERSON_SELECT } },
  })
  const substitutionByEvent = new Map(substitutions.map((s) => [s.eventId, s]))
  const coveredByMe = substitutions.filter((s) => s.substituteUserId === userId).map((s) => s.eventId)

  const events = await prisma.event.findMany({
    where: {
      type: 'CLASE',
      status: { not: 'CANCELLED' },
      parentEventId: null,
      ...(scope === 'all' ? {} : { OR: [{ assignedUserId: userId }, { id: { in: coveredByMe } }] }),
    },
    include: CLASS_EVENT_INCLUDE,
    orderBy: { startTime: 'asc' },
  })

  const occurrences = events.flatMap((event) => {
    const occurrence = classifyOccurrence(event as any, ymd)
    return isOccurrenceOk(occurrence) ? [{ event: event as any, startAt: occurrence.startAt, endAt: occurrence.endAt }] : []
  })

  const [settings, nonWorking, sessions] = await Promise.all([
    getStudentRollCallSettings(),
    findNonWorkingDayForDate(new Date(`${ymd}T00:00:00.000Z`)),
    prisma.studentAttendanceSession.findMany({
      where: { occurrenceYmd: ymd, eventId: { in: occurrences.map((o) => o.event.id) } },
      include: { takenBy: { select: PERSON_SELECT } },
    }),
  ])
  const sessionByEvent = new Map<string, any>(sessions.map((s) => [s.eventId, s]))

  return occurrences
    .map(({ event, startAt, endAt }) => {
      const session = sessionByEvent.get(event.id) ?? null
      const substitution = substitutionByEvent.get(event.id) ?? null
      const isSubstitution = event.assignedUserId !== userId && substitution?.substituteUserId === userId
      const permissions = resolveRollCallPermissions({
        scope,
        isAssignedTeacher: event.assignedUserId === userId || isSubstitution,
        occurrenceStartAt: startAt,
        occurrenceEndAt: endAt,
        takenAt: session?.takenAt ?? null,
        lockedAt: session?.lockedAt ?? null,
        windowHours: settings.editWindowHours,
        now: params.now,
      })
      return {
        eventId: event.id,
        ymd,
        title: event.title,
        subject: event.subject?.name ?? null,
        course: courseLabelOf(event),
        orientation: orientationLabelOf(event),
        startAt,
        endAt,
        teacher: personRef(event.assignedUser),
        substitute: personRef(substitution?.substitute),
        isSubstitution,
        nonWorkingDay: nonWorking ? nonWorking.reason : null,
        rollCall: {
          sessionId: session?.id ?? null,
          status: session?.status ?? 'PENDING',
          takenAt: session?.takenAt ?? null,
          takenBy: personRef(session?.takenBy)?.name ?? null,
          rosterSize: session?.rosterSize ?? null,
          canEdit: permissions.canEdit,
          blockedReason: permissions.blockedReason,
          opensAt: permissions.opensAt,
          editableUntil: permissions.editableUntil,
        },
      }
    })
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
}

/** ¿Le toca a quien pide pasar esta lista hoy? */
function isMineToTake(row: DayClassRow, userId: string): boolean {
  if (row.nonWorkingDay) return false
  if (row.rollCall.status === 'TAKEN') return false
  // La lista la pasa el suplente: al titular cubierto no se le recuerda.
  if (row.substitute && row.substitute.id !== userId) return false
  // Cerrada o vencida: el recordatorio no le sirve de nada.
  return row.rollCall.blockedReason === null || row.rollCall.blockedReason === 'NOT_STARTED'
}

/**
 * Listas que quien pide tiene que pasar hoy: las suyas sin pasar, incluidas las que todavía no
 * abrieron. El cliente decide por la hora cuál mostrar, así no pregunta a cada minuto.
 *
 * Deja afuera la clase del titular que tiene licencia ese día: no está para pasarla.
 */
export async function loadRollCallReminders(params: { userId: string; ymd: string; now?: Date }): Promise<DayClassRow[]> {
  const rows = await loadClassesForDay({ userId: params.userId, scope: 'own', ymd: params.ymd, now: params.now })
  const candidates = rows.filter((row) => isMineToTake(row, params.userId))
  const onLicense = await Promise.all(
    candidates.map((row) =>
      row.isSubstitution ? null : findApprovedLicenseCoveringEventTime(params.userId, row.startAt, row.endAt),
    ),
  )
  return candidates.filter((_, index) => !onLicense[index])
}
