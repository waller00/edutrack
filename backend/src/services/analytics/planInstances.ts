import { prisma } from '../../db/prisma.js'
import type { EventStatus, EventType } from '@prisma/client'
import type { PlannedInstance } from './models.js'
import { parseYmdToUtcRange, toYmdUtc } from './dateRange.js'

function combineDateWithUtcTime(plannedDateYmd: string, time: Date | null | undefined) {
  if (!time) return null
  const base = new Date(`${plannedDateYmd}T00:00:00.000Z`)
  // `time` se persiste en DB como DateTime; usamos componentes UTC para evitar drift.
  return new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate(),
      time.getUTCHours(),
      time.getUTCMinutes(),
      time.getUTCSeconds(),
      time.getUTCMilliseconds(),
    ),
  )
}

function dateRangeToYmd(fromDate: Date, toDate: Date) {
  return { fromYmd: toYmdUtc(fromDate), toYmd: toYmdUtc(toDate) }
}

export async function getPlannedInstances(params: {
  from: string
  to: string
  userId?: string
  userIds?: string[]
  eventType?: EventType
  schoolYearId?: string
}) {
  const { fromDate, toDate } = parseYmdToUtcRange(params.from, params.to)
  const { fromYmd, toYmd } = dateRangeToYmd(fromDate, toDate)

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
      assignedUserId: true,
    },
  })

  const instances: PlannedInstance[] = []

  for (const ev of events) {
    const evStartYmd = toYmdUtc(ev.startDate)
    if (!ev.isRecurring || !ev.daysOfWeek || ev.daysOfWeek.length === 0) {
      // Evento único: solo se incluye si cae dentro del rango.
      if (evStartYmd < fromYmd || evStartYmd > toYmd) continue
      const plannedStartTime = combineDateWithUtcTime(evStartYmd, ev.startTime)
      const plannedEndTime = combineDateWithUtcTime(evStartYmd, ev.endTime)
      instances.push({
        plannedInstanceId: `${ev.id}_${evStartYmd}`,
        eventId: ev.id,
        eventTitle: ev.title,
        eventType: ev.type,
        eventStatus: ev.status,
        isRecurringInstance: false,
        plannedDate: evStartYmd,
        plannedStartTime,
        plannedEndTime,
        userIdRequired: ev.assignedUserId,
      })
      continue
    }

    // Recurrente: expandimos por días de la semana.
    const recurrenceEndDate = ev.recurrenceEnd ? new Date(ev.recurrenceEnd) : toDate
    const rangeStartYmd = evStartYmd > fromYmd ? evStartYmd : fromYmd
    const rangeEndYmd = toYmd < toYmdUtc(recurrenceEndDate) ? toYmd : toYmdUtc(recurrenceEndDate)

    // Iteración día a día en UTC.
    let cursor = new Date(`${rangeStartYmd}T00:00:00.000Z`)
    const final = new Date(`${rangeEndYmd}T00:00:00.000Z`)
    while (cursor <= final) {
      const ymd = toYmdUtc(cursor)
      const dow = cursor.getUTCDay() // 0=Domingo
      if (ev.daysOfWeek.includes(dow)) {
        const plannedStartTime = combineDateWithUtcTime(ymd, ev.startTime)
        const plannedEndTime = combineDateWithUtcTime(ymd, ev.endTime)
        instances.push({
          plannedInstanceId: `${ev.id}_${ymd}`,
          eventId: ev.id,
          eventTitle: ev.title,
          eventType: ev.type,
          eventStatus: ev.status,
          isRecurringInstance: true,
          plannedDate: ymd,
          plannedStartTime,
          plannedEndTime,
          userIdRequired: ev.assignedUserId,
        })
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  }

  // Orden determinístico para export.
  instances.sort((a, b) => {
    if (a.plannedDate !== b.plannedDate) return a.plannedDate.localeCompare(b.plannedDate)
    return a.eventId.localeCompare(b.eventId)
  })

  return instances
}
