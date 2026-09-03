import { DateTime } from 'luxon'
import { getAppTimezone } from '../../config/app-timezone.js'
import { expandRecurringEvent } from '../../events/events-query.js'

/** Desplaza un día civil `YYYY-MM-DD` en `days` días. */
export function shiftYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Día civil (zona institucional) de un instante UTC. */
export function occurrenceYmdOf(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: 'utc' }).setZone(getAppTimezone()).toFormat('yyyy-MM-dd')
}

/**
 * Resuelve el instante UTC de la ocurrencia de un evento recurrente en el día civil `ymd`.
 *
 * Expande con una ventana de ±1 día porque un `YYYY-MM-DD` interpretado como UTC cae en el
 * día civil anterior en Uruguay; el emparejamiento final se hace por la fecha civil real de
 * cada ocurrencia. `opts.applyExceptions` decide si se tienen en cuenta los `childEvents`
 * (suspensiones y reprogramaciones puntuales): pasar `false` da la ocurrencia "de la serie",
 * que es lo que permite distinguir *suspendida* de *inexistente*.
 */
export function resolveOccurrenceInstant(
  parent: any,
  ymd: string,
  opts: { applyExceptions?: boolean } = {},
): { startAt: Date; endAt: Date } | null {
  if (!parent.isRecurring) return null
  const source = opts.applyExceptions ? parent : { ...parent, childEvents: [] }
  const instances = expandRecurringEvent(source, shiftYmd(ymd, -1), shiftYmd(ymd, 1)) as any[]
  const match = instances.find((occ) => occurrenceYmdOf(new Date(occ.startDate)) === ymd)
  if (!match) return null
  return {
    startAt: new Date(match.startTime ?? match.startDate),
    endAt: new Date(match.endTime ?? match.startDate),
  }
}
