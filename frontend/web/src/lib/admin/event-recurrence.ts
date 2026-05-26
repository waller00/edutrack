import type { SchoolYearApiRow } from '@/contexts/AdminSchoolYearContext'

export type RecurrenceRangeMode = 'school_year' | 'custom'

export function isoToYmd(iso: string | null | undefined): string | null {
  if (!iso) return null
  const part = iso.split('T')[0]
  return /^\d{4}-\d{2}-\d{2}$/.test(part) ? part : null
}

export function resolveAdminSchoolYearForEvents(ctx: {
  allYears: boolean
  selectedId: string | null
  activeId: string | null
  years: SchoolYearApiRow[]
} | null): SchoolYearApiRow | null {
  if (!ctx || ctx.allYears) return null
  const id = ctx.selectedId ?? ctx.activeId
  if (!id) return null
  return ctx.years.find((y) => y.id === id) ?? null
}

export function schoolYearEndYmd(year: SchoolYearApiRow | null): string | null {
  return isoToYmd(year?.endsOn)
}

export function schoolYearStartYmd(year: SchoolYearApiRow | null): string | null {
  return isoToYmd(year?.startsOn)
}

export function formatYmdEs(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  if (!y || !m || !d) return ymd
  return `${d}/${m}/${y}`
}

export function schoolYearRangeLabel(year: SchoolYearApiRow | null): string {
  if (!year) return 'año lectivo seleccionado'
  const end = schoolYearEndYmd(year)
  const code = year.code ?? year.label
  if (end) return `año lectivo ${code} (hasta ${formatYmdEs(end)})`
  return `año lectivo ${code}`
}
