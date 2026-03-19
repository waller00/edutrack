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

export function generateRecurringInstances(event: any, startDate: Date, endDate: Date) {
  const instances: any[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    const dayOfWeek = current.getDay();
    if (event.daysOfWeek.includes(dayOfWeek)) {
      instances.push({
        ...event,
        id: `${event.id}_${current.toISOString().split("T")[0]}`,
        startDate: new Date(current),
        startTime: event.startTime
          ? new Date(
              `${current.toISOString().split("T")[0]}T${new Date(event.startTime).toTimeString().split(" ")[0]}`
            )
          : null,
        endTime: event.endTime
          ? new Date(
              `${current.toISOString().split("T")[0]}T${new Date(event.endTime).toTimeString().split(" ")[0]}`
            )
          : null,
        isInstance: true,
        originalEventId: event.id,
      });
    }
    current.setDate(current.getDate() + 1);
  }
  return instances;
}

export function expandRecurringEvent(event: any, startDate?: unknown, endDate?: unknown) {
  const hasRange = Boolean(startDate || endDate);
  const hasRecurringDays = event.isRecurring && event.daysOfWeek?.length > 0;
  if (!hasRecurringDays || !hasRange) return [event];
  const rangeStart = startDate ? new Date(startDate as string) : new Date(event.startDate);
  const rangeEnd = resolveRecurringRangeEnd(event, endDate);
  return generateRecurringInstances(event, rangeStart, rangeEnd);
}
