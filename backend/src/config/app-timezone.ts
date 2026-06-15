import { DateTime } from 'luxon'
import { getInstitutionTimezone } from './institution-timezone.js'

/** Zona horaria institucional activa (cacheada desde SystemSettings). */
export function getAppTimezone(): string {
  return getInstitutionTimezone()
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** YYYY-MM-DD + hora civil local → instante UTC para persistir. */
export function uruguayWallToUtc(ymd: string, hh: number, mm: number): Date {
  const dt = DateTime.fromISO(`${ymd}T${pad2(hh)}:${pad2(mm)}:00`, { zone: getAppTimezone() })
  if (!dt.isValid) {
    throw new Error(`Fecha/hora inválida (${getAppTimezone()}): ${ymd} ${hh}:${mm}`)
  }
  return dt.toUTC().toJSDate()
}

/** Fin inclusive del día civil local. */
export function uruguayYmdEndOfDayToUtc(ymd: string): Date {
  const dt = DateTime.fromISO(`${ymd}T23:59:59.999`, { zone: getAppTimezone() })
  if (!dt.isValid) {
    throw new Error(`Fecha inválida: ${ymd}`)
  }
  return dt.toUTC().toJSDate()
}

/** Acepta YYYY-MM-DD o ISO; devuelve el día civil local (YYYY-MM-DD). */
export function parseStartDateToUruguayYmd(s: string): string | null {
  if (isYmdDateString(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return DateTime.fromJSDate(d, { zone: 'utc' }).setZone(getAppTimezone()).toFormat('yyyy-MM-dd')
}

export function isYmdDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

/**
 * HH:MM (hora civil local) o ISO datetime: devuelve hh/mm en hora civil institucional.
 * Para ISO se toma el instante y se proyecta a la zona configurada.
 */
export function parseEventTimeToUruguayHhMm(s: string): { hh: number; mm: number } | null {
  const trimmed = s.trim()
  const hhmm = /^([01]?\d|2[0-3]):([0-5]\d)$/
  const m = hhmm.exec(trimmed)
  if (m) {
    const hh = Number(m[1])
    const mm = Number(m[2])
    if (hh < 0 || hh > 23) return null
    return { hh, mm }
  }
  const d = new Date(trimmed)
  if (Number.isNaN(d.getTime())) return null
  const wall = DateTime.fromJSDate(d, { zone: 'utc' }).setZone(getAppTimezone())
  return { hh: wall.hour, mm: wall.minute }
}

/** Día de semana JS (0=dom … 6=sáb) del instante visto en la zona institucional. */
export function jsWeekdayInUruguay(d: Date): number {
  return DateTime.fromJSDate(d, { zone: 'utc' }).setZone(getAppTimezone()).weekday % 7
}

/** Inicio del día civil local (00:00) como instante UTC; para columnas `Attendance.date`. */
export function uruguayStartOfDayFromInstant(at: Date): Date {
  const ymd = DateTime.fromJSDate(at, { zone: 'utc' }).setZone(getAppTimezone()).toFormat('yyyy-MM-dd')
  return uruguayWallToUtc(ymd, 0, 0)
}
