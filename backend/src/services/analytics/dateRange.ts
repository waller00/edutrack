import { DateTime } from 'luxon'
import { getAppTimezone, uruguayWallToUtc, uruguayYmdEndOfDayToUtc } from '../../config/app-timezone.js'

export function parseYmdToUtcRange(from: string, to: string) {
  // Esperamos YYYY-MM-DD del día civil operativo de Uruguay.
  const fromDate = uruguayWallToUtc(from, 0, 0)
  const toDate = uruguayYmdEndOfDayToUtc(to)
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new Error('INVALID_DATE_RANGE')
  }
  return { fromDate, toDate }
}

export function toYmdUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10)
}

export function toYmdInUruguay(d: Date) {
  return DateTime.fromJSDate(d, { zone: 'utc' }).setZone(getAppTimezone()).toFormat('yyyy-MM-dd')
}

export function addDaysUtc(ymd: string, days: number) {
  const base = new Date(`${ymd}T00:00:00.000Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}
