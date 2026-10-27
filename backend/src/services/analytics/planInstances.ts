import { prisma } from '../../db/prisma.js'
import type { EventStatus, EventType } from '@prisma/client'
import type { PlannedInstance } from './models.js'
import { DateTime } from 'luxon'
import { getAppTimezone, uruguayWallToUtc } from '../../config/app-timezone.js'
import { parseYmdToUtcRange, toYmdInUruguay } from './dateRange.js'

const DAY_MS = 86_400_000

type WallClock = { hour: number; minute: number }

/** Hora civil de un horario guardado: una serie guarda la fecha-hora de su primer día. */
function wallClockOf(time: Date | null | undefined): WallClock | null {
  if (!time) return null
  const wall = DateTime.fromJSDate(time, { zone: 'utc' }).setZone(getAppTimezone())
  return { hour: wall.hour, minute: wall.minute }
}

type WallToUtc = (ymd: string, clock: WallClock | null) => Date | null

/**
 * `uruguayWallToUtc` memorizado durante una expansión. Las clases comparten horarios: la misma hora
 * del mismo día se convierte una sola vez, y cada ocurrencia recibe su propio `Date`.
 */
function wallToUtcMemo(): WallToUtc {
  const cache = new Map<string, number>()
  return (ymd, clock) => {
    if (!clock) return null
    const key = `${ymd} ${clock.hour}:${clock.minute}`
    let ms = cache.get(key)
    if (ms === undefined) {
      ms = uruguayWallToUtc(ymd, clock.hour, clock.minute).getTime()
      cache.set(key, ms)
    }
    return new Date(ms)
  }
}

type EventRow = {
  id: string
  title: string
  type: EventType
  status: EventStatus
  startDate: Date
  startTime: Date | null
  endTime: Date | null
  isRecurring: boolean
  recurrenceEnd: Date | null
  daysOfWeek: number[]
  effectiveFrom: Date | null
  effectiveUntil: Date | null
  assignedUserId: string | null
  courseOfferingId: string | null
  courseOffering: { id: string; course: { name: string; code: string | null } } | null
  subject: { name: string } | null
  createdAt?: Date | null
  revisionOf?: string | null
  assignedUser?: { createdAt: Date | null } | null
}

/**
 * Desde cuándo las ocurrencias de un evento son un compromiso del docente: no antes de que se
 * cargara la clase ni de que existiera su cuenta.
 *
 * Una serie semanal se puede crear con fecha de inicio pasada (o hoy, con la clase de la mañana ya
 * dada), y una clase se puede asignar a un docente nuevo: sin este límite, esas ocurrencias que
 * nadie pudo cumplir aparecían como ausencias. Una versión nueva de la serie (`revisionOf`) hereda
 * la historia de la anterior, así que para ella sólo cuenta el docente.
 */
export function commitmentStartOf(ev: Pick<EventRow, 'createdAt' | 'revisionOf' | 'assignedUser'>): Date | null {
  const times = [ev.revisionOf ? null : ev.createdAt, ev.assignedUser?.createdAt]
    .filter((value): value is Date => value != null)
    .map((value) => new Date(value).getTime())
    .filter((ms) => !Number.isNaN(ms))
  return times.length > 0 ? new Date(Math.max(...times)) : null
}

type AcademicContext = Pick<PlannedInstance, 'courseOfferingId' | 'courseLabel' | 'subjectLabel'>

function academicContextOf(ev: EventRow): AcademicContext {
  const course = ev.courseOffering?.course
  return {
    courseOfferingId: ev.courseOfferingId ?? null,
    courseLabel: course ? course.name || course.code || null : null,
    subjectLabel: ev.subject?.name ?? null,
  }
}

/** Lo que comparten todas las ocurrencias de un evento: se calcula una vez, no por día. */
type EventPlan = {
  academic: AcademicContext
  start: WallClock | null
  end: WallClock | null
  commitmentStart: Date | null
}

function buildInstance(
  ev: EventRow,
  plan: EventPlan,
  ymd: string,
  isRecurringInstance: boolean,
  wallToUtc: WallToUtc,
): PlannedInstance {
  return {
    plannedInstanceId: `${ev.id}_${ymd}`,
    eventId: ev.id,
    eventTitle: ev.title,
    eventType: ev.type,
    eventStatus: ev.status,
    isRecurringInstance,
    plannedDate: ymd,
    plannedStartTime: wallToUtc(ymd, plan.start),
    plannedEndTime: wallToUtc(ymd, plan.end),
    userIdRequired: ev.assignedUserId,
    commitmentStart: plan.commitmentStart,
    ...plan.academic,
  }
}

/**
 * Días del rango pedido en que la versión del evento está vigente, con los dos extremos inclusive
 * (lo mismo que `effectiveWindowIncludesYmd`, pero calculado una vez y no en cada día).
 */
function effectiveRangeOf(ev: EventRow, fromYmd: string, toYmd: string) {
  const effectiveFromYmd = ev.effectiveFrom ? toYmdInUruguay(ev.effectiveFrom) : null
  const effectiveUntilYmd = ev.effectiveUntil ? toYmdInUruguay(ev.effectiveUntil) : null
  return {
    firstYmd: effectiveFromYmd && effectiveFromYmd > fromYmd ? effectiveFromYmd : fromYmd,
    lastYmd: effectiveUntilYmd && effectiveUntilYmd < toYmd ? effectiveUntilYmd : toYmd,
  }
}

/**
 * Expande un evento (único o recurrente) a sus instancias dentro del rango [fromYmd, toYmd].
 *
 * Corre sobre todo el ciclo en cada carga de Asistencia del personal: nada de conversiones de zona
 * horaria por día. El día de la semana de una fecha civil no depende de la zona, así que sale de la
 * fecha en UTC (0 = domingo, como `daysOfWeek`).
 */
function expandEventInstances(ev: EventRow, fromYmd: string, toYmd: string, wallToUtc: WallToUtc): PlannedInstance[] {
  const plan: EventPlan = {
    academic: academicContextOf(ev),
    start: wallClockOf(ev.startTime),
    end: wallClockOf(ev.endTime),
    commitmentStart: commitmentStartOf(ev),
  }
  const evStartYmd = toYmdInUruguay(ev.startDate)
  const { firstYmd, lastYmd } = effectiveRangeOf(ev, fromYmd, toYmd)

  if (!ev.isRecurring || !ev.daysOfWeek || ev.daysOfWeek.length === 0) {
    if (evStartYmd < firstYmd || evStartYmd > lastYmd) return []
    return [buildInstance(ev, plan, evStartYmd, false, wallToUtc)]
  }

  const recurrenceEndYmd = ev.recurrenceEnd ? toYmdInUruguay(new Date(ev.recurrenceEnd)) : lastYmd
  const startYmd = evStartYmd > firstYmd ? evStartYmd : firstYmd
  const endYmd = recurrenceEndYmd < lastYmd ? recurrenceEndYmd : lastYmd

  const days = new Set(ev.daysOfWeek)
  const out: PlannedInstance[] = []
  const endMs = Date.parse(`${endYmd}T00:00:00.000Z`)
  for (let ms = Date.parse(`${startYmd}T00:00:00.000Z`); ms <= endMs; ms += DAY_MS) {
    const day = new Date(ms)
    if (days.has(day.getUTCDay())) {
      out.push(buildInstance(ev, plan, day.toISOString().slice(0, 10), true, wallToUtc))
    }
  }
  return out
}

function compareText(a: string, b: string) {
  if (a === b) return 0
  return a < b ? -1 : 1
}

export async function getPlannedInstances(params: {
  from: string
  to: string
  userId?: string
  userIds?: string[]
  eventType?: EventType
  schoolYearId?: string
}) {
  const { toDate } = parseYmdToUtcRange(params.from, params.to)
  const fromYmd = params.from
  const toYmd = params.to

  const events = await prisma.event.findMany({
    where: {
      assignedUserId: { not: null },
      status: { not: 'CANCELLED' as EventStatus },
      startDate: { lte: toDate },
      ...(params.userIds ? { assignedUserId: { in: params.userIds } } : null),
      ...(!params.userIds && params.userId ? { assignedUserId: params.userId } : null),
      ...(params.eventType ? { type: params.eventType } : null),
      ...(params.schoolYearId ? { schoolYearId: params.schoolYearId } : null),
    },
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      startDate: true,
      startTime: true,
      endTime: true,
      isRecurring: true,
      recurrenceEnd: true,
      daysOfWeek: true,
      effectiveFrom: true,
      effectiveUntil: true,
      assignedUserId: true,
      courseOfferingId: true,
      courseOffering: { select: { id: true, course: { select: { name: true, code: true } } } },
      subject: { select: { name: true } },
      createdAt: true,
      revisionOf: true,
      assignedUser: { select: { createdAt: true } },
    },
  })

  const wallToUtc = wallToUtcMemo()
  const instances: PlannedInstance[] = []
  for (const ev of events) {
    instances.push(...expandEventInstances(ev, fromYmd, toYmd, wallToUtc))
  }

  // Orden determinístico para export (y `resolveAttendanceAndJustification` toma la primera y la
  // última como rango de fechas). Fechas ISO e ids: alcanza con comparar los textos.
  instances.sort((a, b) => compareText(a.plannedDate, b.plannedDate) || compareText(a.eventId, b.eventId))

  return instances
}
