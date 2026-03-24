import { DateTime } from 'luxon'

/** Zona única del producto: hora civil de Uruguay (sin DST). */
export const APP_TIMEZONE = 'America/Montevideo'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** YYYY-MM-DD + hora civil en Uruguay → instante UTC para persistir. */
export function uruguayWallToUtc(ymd: string, hh: number, mm: number): Date {
  const dt = DateTime.fromISO(`${ymd}T${pad2(hh)}:${pad2(mm)}:00`, { zone: APP_TIMEZONE })
  if (!dt.isValid) {
    throw new Error(`Fecha/hora inválida en Uruguay: ${ymd} ${hh}:${mm}`)
  }
  return dt.toUTC().toJSDate()
}

/** Fin inclusive del día civil en Uruguay. */
export function uruguayYmdEndOfDayToUtc(ymd: string): Date {
  const dt = DateTime.fromISO(`${ymd}T23:59:59.999`, { zone: APP_TIMEZONE })
  if (!dt.isValid) {
    throw new Error(`Fecha inválida: ${ymd}`)
  }
  return dt.toUTC().toJSDate()
}

/** Acepta YYYY-MM-DD o ISO; devuelve el día civil en Uruguay (YYYY-MM-DD). */
export function parseStartDateToUruguayYmd(s: string): string | null {
  if (isYmdDateString(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return DateTime.fromJSDate(d, { zone: 'utc' }).setZone(APP_TIMEZONE).toFormat('yyyy-MM-dd')
}

export function isYmdDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

/**
 * HH:MM (hora civil Uruguay) o ISO datetime: devuelve hh/mm en hora civil Uruguay.
 * Para ISO se toma el instante y se proyecta a Montevideo.
 */
export function parseEventTimeToUruguayHhMm(s: string): { hh: number; mm: number } | null {
  const trimmed = s.trim()
  const hhmm = /^([01]?\d|2[0-3]):([0-5]\d)$/
  const m = trimmed.match(hhmm)
  if (m) {
    const hh = Number(m[1])
    const mm = Number(m[2])
    if (hh < 0 || hh > 23) return null
    return { hh, mm }
  }
  const d = new Date(trimmed)
  if (Number.isNaN(d.getTime())) return null
  const wall = DateTime.fromJSDate(d, { zone: 'utc' }).setZone(APP_TIMEZONE)
  return { hh: wall.hour, mm: wall.minute }
}

/** Día de semana JS (0=dom … 6=sáb) del instante visto en Uruguay. */
export function jsWeekdayInUruguay(d: Date): number {
  return DateTime.fromJSDate(d, { zone: 'utc' }).setZone(APP_TIMEZONE).weekday % 7
}
