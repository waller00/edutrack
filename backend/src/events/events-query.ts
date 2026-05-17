/** Consultas/filtros de eventos (lógica pura + expansión recurrente) */

import { DateTime } from 'luxon'
import { APP_TIMEZONE } from '../config/app-timezone.js'

export function applyEventStartDateFilter(where: any, startDate?: unknown, endDate?: unknown) {
  if (!startDate && !endDate) return;
  const start = startDate ? new Date(startDate as string) : null;
  const end = endDate ? new Date(endDate as string) : null;
  const singleEventDateFilter: any = { isRecurring: false };
  singleEventDateFilter.startDate = {};
  if (start) singleEventDateFilter.startDate.gte = start;
  if (end) singleEventDateFilter.startDate.lte = end;

  const recurringEventFilter: any = { isRecurring: true };
  if (end) recurringEventFilter.startDate = { lte: end };
  if (start) recurringEventFilter.OR = [{ recurrenceEnd: null }, { recurrenceEnd: { gte: start } }];

  const previousAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  where.AND = [...previousAnd, { OR: [singleEventDateFilter, recurringEventFilter] }];
}

export function buildMyEventsBaseFilter(userId: string) {
  return { OR: [{ userId }, { assignedUserId: userId }] };
}

export function applyMyEventsDateFilter(
  where: any,
  userId: string,
  startDate?: unknown,
  endDate?: unknown
) {
  if (!startDate && !endDate) return;
  const start = startDate ? new Date(startDate as string) : null;
  const end = endDate ? new Date(endDate as string) : null;
  const singleEventDateFilter: any = { isRecurring: false };
  if (start || end) {
    singleEventDateFilter.startDate = {};
    if (start) singleEventDateFilter.startDate.gte = start;
    if (end) singleEventDateFilter.startDate.lte = end;
  }
  const recurringEventFilter: any = { isRecurring: true };
  if (end) recurringEventFilter.startDate = { lte: end };
  if (start) {
    recurringEventFilter.OR = [{ recurrenceEnd: null }, { recurrenceEnd: { gte: start } }];
  }
  where.AND = [buildMyEventsBaseFilter(userId), { OR: [singleEventDateFilter, recurringEventFilter] }];
  delete where.OR;
}

export function resolveRecurringRangeEnd(event: any, endDate?: unknown) {
  if (endDate) return new Date(endDate as string);
  if (event.recurrenceEnd) return new Date(event.recurrenceEnd);
  return new Date(Math.max(Date.now(), new Date(event.startDate).getTime()));
}

function deriveOccurrenceStatus(baseStatus: any, occStartAt: Date, occEndAt: Date) {
  if (baseStatus === 'CANCELLED') return 'CANCELLED'
  if (baseStatus === 'EXPIRED') return 'EXPIRED'
  const now = new Date()
  if (occEndAt <= now) return 'COMPLETED'
  if (occStartAt <= now && now < occEndAt) return 'IN_PROGRESS'
  return 'SCHEDULED'
}

export function generateRecurringInstances(event: any, startDate: Date, endDate: Date) {
  const instances: any[] = []

  const baseStartTime = event.startTime ? new Date(event.startTime) : null
  const baseEndTime = event.endTime ? new Date(event.endTime) : null

  const wallStart = baseStartTime
    ? DateTime.fromJSDate(baseStartTime, { zone: 'utc' }).setZone(APP_TIMEZONE)
    : null
  const wallEnd = baseEndTime
    ? DateTime.fromJSDate(baseEndTime, { zone: 'utc' }).setZone(APP_TIMEZONE)
    : null

  const startHH = wallStart ? wallStart.hour : 0
  const startMM = wallStart ? wallStart.minute : 0
  const endHH = wallEnd ? wallEnd.hour : 0
  const endMM = wallEnd ? wallEnd.minute : 0

  let cursor = DateTime.fromJSDate(startDate, { zone: 'utc' }).setZone(APP_TIMEZONE).startOf('day')
  const final = DateTime.fromJSDate(endDate, { zone: 'utc' }).setZone(APP_TIMEZONE).endOf('day')

  const recurrenceType = event.recurrenceType || (event.isRecurring ? 'WEEKLY' : 'NONE')

  const baseStartAtUy = event.startDate
    ? DateTime.fromJSDate(new Date(event.startDate), { zone: 'utc' }).setZone(APP_TIMEZONE)
    : cursor
  const baseStartDayOfMonth = baseStartAtUy.day

  while (cursor <= final) {
    const dow = cursor.weekday % 7

    const matches =
      recurrenceType === 'DAILY'
        ? true
        : recurrenceType === 'MONTHLY'
          ? cursor.day === baseStartDayOfMonth
          : event.daysOfWeek?.includes(dow)

    if (matches) {
      const occStartAt = DateTime.fromObject(
        {
          year: cursor.year,
          month: cursor.month,
          day: cursor.day,
          hour: startHH,
          minute: startMM,
          second: 0,
          millisecond: 0,
        },
        { zone: APP_TIMEZONE },
      )
        .toUTC()
        .toJSDate()
      const occEndAt = DateTime.fromObject(
        {
          year: cursor.year,
          month: cursor.month,
          day: cursor.day,
          hour: endHH,
          minute: endMM,
          second: 0,
          millisecond: 0,
        },
        { zone: APP_TIMEZONE },
      )
        .toUTC()
        .toJSDate()

      const ymd = cursor.toFormat('yyyy-MM-dd')

      instances.push({
        ...event,
        id: `${event.id}_${ymd}`,
        startDate: occStartAt,
        startTime: occStartAt,
        endTime: occEndAt,
        endDate: null,
        isInstance: true,
        originalEventId: event.id,
      })
    }

    cursor = cursor.plus({ days: 1 })
  }

  return instances
}

export function expandRecurringEvent(event: any, startDate?: unknown, endDate?: unknown) {
  const hasRange = Boolean(startDate || endDate);
  if (!hasRange) return [event]

  const isRecurring = Boolean(event.isRecurring) && event.recurrenceType !== 'NONE'
  if (!isRecurring) {
    // Evento único: derivamos estado por ocurrencia.
    const occStartAt = event.startTime ? new Date(event.startTime) : new Date(event.startDate)
    const occEndAt = event.endTime ? new Date(event.endTime) : occStartAt
    return [
      {
        ...event,
        status: deriveOccurrenceStatus(event.status, occStartAt, occEndAt),
      },
    ]
  }

  const rangeStart = startDate ? new Date(startDate as string) : new Date(event.startDate)
  const rangeEnd = resolveRecurringRangeEnd(event, endDate)
  // Evitar “ocurrencias fantasma” antes de la fecha base real.
  const baseStartAt = event.startDate ? new Date(event.startDate) : rangeStart
  const cappedRangeStart = baseStartAt.getTime() > rangeStart.getTime() ? baseStartAt : rangeStart

  const expanded = generateRecurringInstances(event, cappedRangeStart, rangeEnd)

  // Aplicar excepciones: childEvents (usamos parentEventId ya existente).
  const children = Array.isArray(event.childEvents) ? event.childEvents : []
  const byStartDateIso = new Map<string, any>()
  for (const c of children) {
    if (!c.startDate) continue
    byStartDateIso.set(new Date(c.startDate).toISOString(), c)
  }

  const filtered: any[] = []
  for (const occ of expanded) {
    const occKey = new Date(occ.startDate).toISOString()
    const ex = byStartDateIso.get(occKey)
    if (ex) {
      if (ex.status === 'CANCELLED') continue
      filtered.push({
        ...occ,
        title: ex.title ?? occ.title,
        description: ex.description ?? occ.description,
        type: ex.type ?? occ.type,
        courseId: ex.courseId ?? occ.courseId,
        subjectId: ex.subjectId ?? occ.subjectId,
        course: ex.course ?? occ.course,
        subject: ex.subject ?? occ.subject,
        // Override de horario si existiera
        startDate: ex.startTime ? new Date(ex.startTime) : occ.startDate,
        startTime: ex.startTime ? new Date(ex.startTime) : occ.startTime,
        endTime: ex.endTime ? new Date(ex.endTime) : occ.endTime,
        status: deriveOccurrenceStatus(ex.status ?? occ.status, new Date(occ.startDate), new Date(occ.endTime)),
        isInstance: true,
        originalEventId: event.id,
      })
      continue
    }

    const occStartAt = new Date(occ.startDate)
    const occEndAt = occ.endTime ? new Date(occ.endTime) : occStartAt
    filtered.push({
      ...occ,
      status: deriveOccurrenceStatus(event.status, occStartAt, occEndAt),
    })
  }

  return filtered
}
