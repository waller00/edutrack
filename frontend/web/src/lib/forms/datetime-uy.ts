/** Zona horaria única del producto (Uruguay, sin DST). */
export const APP_TIMEZONE = 'America/Montevideo'

function parseHhMmString(t: string): { h: string; m: string } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t.trim())
  if (!match) return null
  return { h: match[1].padStart(2, '0'), m: match[2].padStart(2, '0') }
}

/** Fecha civil en Uruguay (para listados). */
export function formatDateInUruguay(iso: string | Date): string {
  return new Intl.DateTimeFormat('es-UY', {
    timeZone: APP_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso))
}

/** Fecha + hora civil en Uruguay (dd/mm/yyyy, HH:MM 24 h). */
export function formatDateTimeInUruguay(
  iso: string | Date,
  options: { seconds?: boolean } = {},
): string {
  return new Intl.DateTimeFormat('es-UY', {
    timeZone: APP_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(options.seconds ? { second: '2-digit' } : {}),
    hour12: false,
    hourCycle: 'h23',
  }).format(new Date(iso))
}

/** Hora 24 h civil en Uruguay. */
export function formatTimeInUruguay(iso: string | Date): string {
  return new Intl.DateTimeFormat('es-UY', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).format(new Date(iso))
}

/** YYYY-MM-DD del “hoy” en Uruguay (p. ej. valor por defecto en `<input type="date">`). */
export function getTodayYmdInUruguay(reference = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(reference)
}

/** Compara fecha civil + HH:MM (Uruguay) contra `reference` (instante real). */
export function isUruguayWallDateTimeInPast(ymd: string, hhmm: string, reference = new Date()): boolean {
  const parts = parseHhMmString(hhmm)
  if (!parts || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false
  const wallIso = `${ymd}T${parts.h}:${parts.m}:00-03:00`
  const startMs = new Date(wallIso).getTime()
  if (Number.isNaN(startMs)) return false
  return startMs < reference.getTime()
}

/**
 * Para rellenar selects HH:MM al editar: si viene ISO del API, proyecta a Uruguay;
 * si ya es "HH:MM", lo devuelve normalizado.
 */
export function formatClockHhMmInUruguayFromIso(isoOrHhmm: string | undefined): string {
  if (!isoOrHhmm) return '09:00'
  if (!isoOrHhmm.includes('T')) {
    const p = parseHhMmString(isoOrHhmm)
    return p ? `${p.h}:${p.m}` : '09:00'
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(new Date(isoOrHhmm))
  const hh = parts.find((x) => x.type === 'hour')?.value ?? '09'
  const mm = parts.find((x) => x.type === 'minute')?.value ?? '00'
  return `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`
}
