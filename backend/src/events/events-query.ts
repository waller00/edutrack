/** Consultas/filtros de eventos (lógica pura + expansión recurrente) */

import { DateTime } from 'luxon'
import { APP_TIMEZONE } from '../config/app-timezone.js'
import { effectiveWindowIncludesYmd, ymdInUruguay } from '../services/events/event-versioning.js'

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

  let previousAnd: unknown[] = [];
  if (Array.isArray(where.AND)) previousAnd = where.AND;
  else if (where.AND) previousAnd = [where.AND];
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

export function deriveOccurrenceStatus(baseStatus: any, occStartAt: Date, occEndAt: Date) {
  if (baseStatus === 'CANCELLED') return 'CANCELLED'
  if (baseStatus === 'EXPIRED') return 'EXPIRED'
  const now = new Date()
  if (occEndAt <= now) return 'COMPLETED'
  if (occStartAt <= now && now < occEndAt) return 'IN_PROGRESS'
  return 'SCHEDULED'
}

function wallHourMinute(time: Date | null) {
  if (!time) return { hh: 0, mm: 0 }
  const wall = DateTime.fromJSDate(time, { zone: 'utc' }).setZone(APP_TIMEZONE)
  return { hh: wall.hour, mm: wall.minute }
}

function cursorAtTimeUtc(cursor: DateTime, hh: number, mm: number) {
  return DateTime.fromObject(
    { year: cursor.year, month: cursor.month, day: cursor.day, hour: hh, minute: mm, second: 0, millisecond: 0 },
    { zone: APP_TIMEZONE },
  )
    .toUTC()
    .toJSDate()
}

function matchesRecurrencePattern(
  recurrenceType: string,
  cursor: DateTime,
  baseStartDayOfMonth: number,
  daysOfWeek: number[] | undefined,
) {
  if (recurrenceType === 'DAILY') return true
  if (recurrenceType === 'MONTHLY') return cursor.day === baseStartDayOfMonth
  return Boolean(daysOfWeek?.includes(cursor.weekday % 7))
}

export function generateRecurringInstances(event: any, startDate: Date, endDate: Date) {
  const instances: any[] = []
  const start = wallHourMinute(event.startTime ? new Date(event.startTime) : null)
  const end = wallHourMinute(event.endTime ? new Date(event.endTime) : null)

  let cursor = DateTime.fromJSDate(startDate, { zone: 'utc' }).setZone(APP_TIMEZONE).startOf('day')
  const final = DateTime.fromJSDate(endDate, { zone: 'utc' }).setZone(APP_TIMEZONE).endOf('day')

  const recurrenceType = event.recurrenceType || (event.isRecurring ? 'WEEKLY' : 'NONE')
  const baseStartAtUy = event.startDate
    ? DateTime.fromJSDate(new Date(event.startDate), { zone: 'utc' }).setZone(APP_TIMEZONE)
    : cursor
  const baseStartDayOfMonth = baseStartAtUy.day

  while (cursor <= final) {
    const ymd = cursor.toFormat('yyyy-MM-dd')
    const matches =
      matchesRecurrencePattern(recurrenceType, cursor, baseStartDayOfMonth, event.daysOfWeek) &&
      effectiveWindowIncludesYmd(event.effectiveFrom, event.effectiveUntil, ymd)

    if (matches) {
      const occStartAt = cursorAtTimeUtc(cursor, start.hh, start.mm)
      const occEndAt = cursorAtTimeUtc(cursor, end.hh, end.mm)
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
    // Respeta la ventana de vigencia: una versión cerrada por edición (split) no debe
    // producir ocurrencia fuera de su período (evita duplicados con la versión vigente).
    if (!effectiveWindowIncludesYmd(event.effectiveFrom, event.effectiveUntil, ymdInUruguay(occStartAt))) {
      return []
    }
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
  return applyRecurrenceExceptions(event, expanded)
}

/** Indexa las excepciones puntuales (childEvents) por fecha de inicio ISO. */
function indexExceptionsByStartDate(children: any[]): Map<string, any> {
  const byStartDateIso = new Map<string, any>()
  for (const c of children) {
    if (!c.startDate) continue
    byStartDateIso.set(new Date(c.startDate).toISOString(), c)
  }
  return byStartDateIso
}

/** Fusiona una ocurrencia con su excepción puntual (override de campos/horario). */
function mergeOccurrenceWithException(occ: any, ex: any, eventId: string) {
  return {
    ...occ,
    title: ex.title ?? occ.title,
    description: ex.description ?? occ.description,
    type: ex.type ?? occ.type,
    courseOfferingId: ex.courseOfferingId ?? occ.courseOfferingId,
    orientationId: ex.orientationId ?? occ.orientationId,
    courseOrientationId: ex.courseOrientationId ?? occ.courseOrientationId,
    subjectId: ex.subjectId ?? occ.subjectId,
    courseOffering: ex.courseOffering ?? occ.courseOffering,
    orientation: ex.orientation ?? occ.orientation,
    subject: ex.subject ?? occ.subject,
    startDate: ex.startTime ? new Date(ex.startTime) : occ.startDate,
    startTime: ex.startTime ? new Date(ex.startTime) : occ.startTime,
    endTime: ex.endTime ? new Date(ex.endTime) : occ.endTime,
    status: deriveOccurrenceStatus(ex.status ?? occ.status, new Date(occ.startDate), new Date(occ.endTime)),
    isInstance: true,
    originalEventId: eventId,
  }
}

function applyRecurrenceExceptions(event: any, expanded: any[]): any[] {
  const byStartDateIso = indexExceptionsByStartDate(Array.isArray(event.childEvents) ? event.childEvents : [])
  const filtered: any[] = []
  for (const occ of expanded) {
    const ex = byStartDateIso.get(new Date(occ.startDate).toISOString())
    if (ex) {
      if (ex.status === 'CANCELLED') continue
      filtered.push(mergeOccurrenceWithException(occ, ex, event.id))
      continue
    }
    const occStartAt = new Date(occ.startDate)
    const occEndAt = occ.endTime ? new Date(occ.endTime) : occStartAt
    filtered.push({ ...occ, status: deriveOccurrenceStatus(event.status, occStartAt, occEndAt) })
  }
  return filtered
}
