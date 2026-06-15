import { APP_TIMEZONE, formatClockHhMmInUruguayFromIso } from '@/lib/forms/datetime-uy'

/**
 * Resolución de ocurrencias de eventos en el cliente (zona horaria de Uruguay),
 * teniendo en cuenta las **excepciones por día** (`childEvents`): una ocurrencia con
 * excepción `CANCELLED` se marca `suspended`; una con override toma su título/horario.
 *
 * Fuente única para la tira "Próximos 7 días", el calendario y la lista admin.
 */

export type OccurrenceChild = {
  startDate: string
  status?: string | null
  title?: string | null
  description?: string | null
  startTime?: string | null
  endTime?: string | null
}

export type OccurrenceEvent = {
  id: string
  title: string
  startDate: string
  startTime?: string | null
  endTime?: string | null
  isRecurring: boolean
  recurrenceType: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'
  daysOfWeek: number[]
  recurrenceEnd?: string | null
  status?: string
  childEvents?: OccurrenceChild[]
}

export function weekdayNumberInUruguay(value?: string | null): number | null {
  if (!value) return null
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (ymd) return new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))).getUTCDay()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const y = Number(parts.find((p) => p.type === 'year')?.value)
  const m = Number(parts.find((p) => p.type === 'month')?.value)
  const d = Number(parts.find((p) => p.type === 'day')?.value)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function uniqueSortedDays(days: number[]): number[] {
  return Array.from(new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b)
}

/** YYYY-MM-DD (día civil en Uruguay), comparable lexicográficamente. */
export function ymdInUruguay(value?: string | null): string | null {
  if (!value) return null
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const d = parts.find((p) => p.type === 'day')?.value
  return y && m && d ? `${y}-${m}-${d}` : null
}

/** Suma `n` días a un YYYY-MM-DD (aritmética de calendario, sin TZ). */
export function addDaysToYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function eventAssignedWeekdays(
  event: Pick<OccurrenceEvent, 'isRecurring' | 'recurrenceType' | 'daysOfWeek' | 'startDate'>,
): number[] {
  if (event.isRecurring && event.recurrenceType === 'DAILY') return [0, 1, 2, 3, 4, 5, 6]
  if (event.isRecurring && event.recurrenceType === 'WEEKLY' && event.daysOfWeek.length > 0) {
    return uniqueSortedDays(event.daysOfWeek)
  }
  const day = weekdayNumberInUruguay(event.startDate)
  return day === null ? [] : [day]
}

/** ¿El evento ocurre en una fecha concreta (YYYY-MM-DD)? Resuelve la recurrencia (sin excepciones). */
export function eventOccursOnYmd(event: OccurrenceEvent, ymd: string): boolean {
  const startYmd = ymdInUruguay(event.startDate)
  if (!startYmd) return false

  if (!event.isRecurring || event.recurrenceType === 'NONE') {
    return ymd === startYmd
  }

  const endYmd = ymdInUruguay(event.recurrenceEnd)
  if (ymd < startYmd || (endYmd && ymd > endYmd)) return false

  if (event.recurrenceType === 'DAILY') return true
  if (event.recurrenceType === 'WEEKLY') {
    const wd = weekdayNumberInUruguay(ymd)
    if (wd === null) return false
    const fallback = weekdayNumberInUruguay(event.startDate)
    const days = event.daysOfWeek.length > 0 ? event.daysOfWeek : fallback === null ? [] : [fallback]
    return days.includes(wd)
  }
  if (event.recurrenceType === 'MONTHLY') {
    return ymd.slice(8, 10) === startYmd.slice(8, 10)
  }
  return false
}

/** Excepción puntual (childEvent) que aplica a esa fecha civil, si existe. */
export function findExceptionForYmd(event: OccurrenceEvent, ymd: string): OccurrenceChild | undefined {
  return (event.childEvents ?? []).find((child) => ymdInUruguay(child.startDate) === ymd)
}

export type EventOccurrence<E extends OccurrenceEvent = OccurrenceEvent> = {
  event: E
  ymd: string
  title: string
  startTime?: string | null
  endTime?: string | null
  status?: string
  /** Ocurrencia cancelada solo ese día (excepción CANCELLED). */
  suspended: boolean
  /** Ocurrencia modificada solo ese día (excepción con override). */
  overridden: boolean
}

function occurrenceStartMinutes(occ: { startTime?: string | null }): number {
  if (!occ.startTime) return 0
  const hhmm = formatClockHhMmInUruguayFromIso(occ.startTime)
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}

/** Ocurrencias (con excepciones aplicadas) para una fecha, ordenadas por hora y título. */
export function getOccurrencesForYmd<E extends OccurrenceEvent>(events: E[], ymd: string): EventOccurrence<E>[] {
  const out: EventOccurrence<E>[] = []
  for (const event of events) {
    if (!eventOccursOnYmd(event, ymd)) continue
    const ex = findExceptionForYmd(event, ymd)
    if (ex) {
      out.push({
        event,
        ymd,
        title: ex.title ?? event.title,
        startTime: ex.startTime ?? event.startTime,
        endTime: ex.endTime ?? event.endTime,
        status: ex.status ?? event.status,
        suspended: ex.status === 'CANCELLED',
        overridden: true,
      })
    } else {
      out.push({
        event,
        ymd,
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        status: event.status,
        suspended: false,
        overridden: false,
      })
    }
  }
  return out.sort((a, b) => {
    const am = occurrenceStartMinutes(a)
    const bm = occurrenceStartMinutes(b)
    if (am !== bm) return am - bm
    return a.title.localeCompare(b.title)
  })
}

/** Compat: eventos crudos que ocurren en una fecha (sin marcar excepciones). */
export function getEventsForYmd<E extends OccurrenceEvent>(events: E[], ymd: string): E[] {
  return getOccurrencesForYmd(events, ymd).map((occ) => occ.event)
}
