import { DateTime } from 'luxon'
import type { LlmIntentPayload } from './schemas.js'

export function ymdRangeForCalendarMonth(year: number, month: number) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** Límites UTC inclusivos para consultas por día civil YYYY-MM-DD. */
export function ymdBoundsUtc(fromYmd: string, toYmd: string): { start: Date; end: Date } {
  const start = new Date(`${fromYmd}T00:00:00.000Z`)
  const end = new Date(`${toYmd}T23:59:59.999Z`)
  return { start, end }
}

/**
 * Prioridad: dateFrom+dateTo válidos → mes calendario (year+month, año actual si falta year).
 */
export function resolveYmdRangeFromPayload(params: LlmIntentPayload['params']): { from: string; to: string } | null {
  const df = params.dateFrom?.trim()
  const dt = params.dateTo?.trim()
  if (df && dt && YMD.test(df) && YMD.test(dt) && df <= dt) {
    return { from: df, to: dt }
  }

  let year = params.year
  const month = params.month
  if (month != null && month >= 1 && month <= 12 && year == null) {
    year = DateTime.utc().year
  }
  if (year != null && month != null && month >= 1 && month <= 12) {
    return ymdRangeForCalendarMonth(year, month)
  }
  return null
}
