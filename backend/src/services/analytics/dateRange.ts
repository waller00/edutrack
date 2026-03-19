export function parseYmdToUtcRange(from: string, to: string) {
  // Esperamos YYYY-MM-DD.
  const fromDate = new Date(`${from}T00:00:00.000Z`)
  const toDate = new Date(`${to}T23:59:59.999Z`)
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

export function addDaysUtc(ymd: string, days: number) {
  const base = new Date(`${ymd}T00:00:00.000Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

