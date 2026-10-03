import { prisma } from '../../db/prisma.js'
import type { EventStatus, EventType } from '@prisma/client'
import type { PlannedInstance } from './models.js'
import { DateTime } from 'luxon'
import { getAppTimezone, uruguayWallToUtc } from '../../config/app-timezone.js'
import { addDaysUtc, parseYmdToUtcRange, toYmdInUruguay } from './dateRange.js'
import { effectiveWindowIncludesYmd } from '../events/event-versioning.js'

function combineDateWithUtcTime(plannedDateYmd: string, time: Date | null | undefined) {
  if (!time) return null
  const wall = DateTime.fromJSDate(time, { zone: 'utc' }).setZone(getAppTimezone())
  return uruguayWallToUtc(plannedDateYmd, wall.hour, wall.minute)
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

function buildInstance(ev: EventRow, ymd: string, isRecurringInstance: boolean, academic: AcademicContext): PlannedInstance {
  return {
    plannedInstanceId: `${ev.id}_${ymd}`,
    eventId: ev.id,
    eventTitle: ev.title,
    eventType: ev.type,
    eventStatus: ev.status,
    isRecurringInstance,
    plannedDate: ymd,
    plannedStartTime: combineDateWithUtcTime(ymd, ev.startTime),
    plannedEndTime: combineDateWithUtcTime(ymd, ev.endTime),
    userIdRequired: ev.assignedUserId,
    ...academic,
  }
}

/** Expande un evento (único o recurrente) a sus instancias dentro del rango [fromYmd, toYmd]. */
function expandEventInstances(ev: EventRow, fromYmd: string, toYmd: string, toDate: Date): PlannedInstance[] {
  const academic = academicContextOf(ev)
  const evStartYmd = toYmdInUruguay(ev.startDate)
  const inWindow = (ymd: string) => effectiveWindowIncludesYmd(ev.effectiveFrom, ev.effectiveUntil, ymd)

  if (!ev.isRecurring || !ev.daysOfWeek || ev.daysOfWeek.length === 0) {
    if (evStartYmd < fromYmd || evStartYmd > toYmd || !inWindow(evStartYmd)) return []
    return [buildInstance(ev, evStartYmd, false, academic)]
  }

  const recurrenceEndDate = ev.recurrenceEnd ? new Date(ev.recurrenceEnd) : toDate
  const rangeStartYmd = evStartYmd > fromYmd ? evStartYmd : fromYmd
  const recurrenceEndYmd = toYmdInUruguay(recurrenceEndDate)
  const rangeEndYmd = toYmd < recurrenceEndYmd ? toYmd : recurrenceEndYmd

  const out: PlannedInstance[] = []
  let cursorYmd = rangeStartYmd
  while (cursorYmd <= rangeEndYmd) {
    const weekday = DateTime.fromISO(cursorYmd, { zone: getAppTimezone() }).weekday % 7
    if (ev.daysOfWeek.includes(weekday) && inWindow(cursorYmd)) {
      out.push(buildInstance(ev, cursorYmd, true, academic))
    }
    cursorYmd = addDaysUtc(cursorYmd, 1)
  }
  return out
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
    },
  })

  const instances: PlannedInstance[] = []
  for (const ev of events) {
    instances.push(...expandEventInstances(ev, fromYmd, toYmd, toDate))
  }

  // Orden determinístico para export.
  instances.sort((a, b) => {
    if (a.plannedDate !== b.plannedDate) return a.plannedDate.localeCompare(b.plannedDate)
    return a.eventId.localeCompare(b.eventId)
  })

  return instances
}
