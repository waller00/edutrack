/**
 * Las licencias de «Mis licencias», en días civiles (`YYYY-MM-DD`): cuántos días son, si están
 * vigentes hoy, y cuántos caen dentro de un período.
 */

type LicenseDays = { startDate: string; endDate: string }

const DAY_MS = 86_400_000
const dayOf = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00.000Z`).getTime()

/** Días de la licencia, contando el primero y el último. */
export function licenseDays(license: LicenseDays): number {
  return Math.max(0, Math.round((dayOf(license.endDate) - dayOf(license.startDate)) / DAY_MS) + 1)
}

export type LicenseTiming = 'CURRENT' | 'UPCOMING' | 'PAST'

export function licenseTiming(license: LicenseDays, todayYmd: string): LicenseTiming {
  if (license.startDate.slice(0, 10) > todayYmd) return 'UPCOMING'
  if (license.endDate.slice(0, 10) < todayYmd) return 'PAST'
  return 'CURRENT'
}

/** «Vigente hoy», «Empieza el 12/11»: en palabras, al lado del estado. */
export function licenseTimingText(license: LicenseDays, todayYmd: string): string | null {
  const timing = licenseTiming(license, todayYmd)
  if (timing === 'CURRENT') return 'Vigente hoy'
  if (timing === 'UPCOMING') return `Empieza el ${license.startDate.slice(8, 10)}/${license.startDate.slice(5, 7)}`
  return null
}

/** Días de la licencia que caen entre `from` y `to`. */
export function overlapDays(license: LicenseDays, from: string, to: string): number {
  const start = Math.max(dayOf(license.startDate), dayOf(from))
  const end = Math.min(dayOf(license.endDate), dayOf(to))
  return end < start ? 0 : Math.round((end - start) / DAY_MS) + 1
}

const TIMING_ORDER: Record<LicenseTiming, number> = { CURRENT: 0, UPCOMING: 1, PAST: 2 }

/** Primero la vigente, después las que vienen, después las pasadas, la más nueva primero. */
export function sortLicenses<T extends LicenseDays>(licenses: readonly T[], todayYmd: string): T[] {
  return [...licenses].sort(
    (a, b) =>
      TIMING_ORDER[licenseTiming(a, todayYmd)] - TIMING_ORDER[licenseTiming(b, todayYmd)] ||
      b.startDate.localeCompare(a.startDate),
  )
}
