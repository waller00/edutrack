/** Consultas/filtros de eventos (lógica pura + expansión recurrente) */

export function applyEventStartDateFilter(where: any, startDate?: unknown, endDate?: unknown) {
  if (!startDate && !endDate) return;
  where.startDate = {};
  if (startDate) where.startDate.gte = new Date(startDate as string);
  if (endDate) where.startDate.lte = new Date(endDate as string);
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

function toYmdUtc(d: Date) {
  return d.toISOString().slice(0, 10)
}

function combineUtcYmdWithHhMm(ymdUtc: string, hh: number, mm: number) {
  const [y, m, day] = ymdUtc.split('-').map((x) => Number(x))
  return new Date(Date.UTC(y, m - 1, day, hh, mm, 0, 0))
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

  const rangeStartYmd = toYmdUtc(startDate)
  const rangeEndYmd = toYmdUtc(endDate)

  const baseStartTime = event.startTime ? new Date(event.startTime) : null
  const baseEndTime = event.endTime ? new Date(event.endTime) : null

  const startHH = baseStartTime ? baseStartTime.getUTCHours() : 0
  const startMM = baseStartTime ? baseStartTime.getUTCMinutes() : 0
  const endHH = baseEndTime ? baseEndTime.getUTCHours() : 0
  const endMM = baseEndTime ? baseEndTime.getUTCMinutes() : 0

  const cursor = new Date(`${rangeStartYmd}T00:00:00.000Z`)
  const final = new Date(`${rangeEndYmd}T00:00:00.000Z`)

  const recurrenceType = event.recurrenceType || (event.isRecurring ? 'WEEKLY' : 'NONE')

  const baseStartDateYmd = event.startDate ? toYmdUtc(new Date(event.startDate)) : rangeStartYmd
  const baseStartDayOfMonth = Number(baseStartDateYmd.slice(8, 10))

  while (cursor <= final) {
    const ymd = toYmdUtc(cursor)
    const dow = cursor.getUTCDay() // 0=Domingo

    const matches =
      recurrenceType === 'DAILY'
        ? true
        : recurrenceType === 'MONTHLY'
          ? Number(ymd.slice(8, 10)) === baseStartDayOfMonth
          : // WEEKLY / fallback
            event.daysOfWeek?.includes(dow)

    if (matches) {
      const occStartAt = combineUtcYmdWithHhMm(ymd, startHH, startMM)
      const occEndAt = combineUtcYmdWithHhMm(ymd, endHH, endMM)

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

    cursor.setUTCDate(cursor.getUTCDate() + 1)
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
