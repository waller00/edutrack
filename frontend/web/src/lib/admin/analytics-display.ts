/** Badge del puntaje de prioridad (riesgo) de una persona: rojo / ámbar / verde. */
export function getRiskScoreBadgeClass(score: number): string {
  if (score > 8) return 'bg-red-50 text-red-800'
  if (score > 3) return 'bg-amber-50 text-amber-900'
  return 'bg-emerald-50 text-emerald-900'
}

export type SchoolYearDateRangeInput = {
  startsOn: string | null
  endsOn: string | null
}

/**
 * Rango de fechas (YYYY-MM-DD) a aplicar en indicadores cuando se selecciona un
 * ciclo lectivo. Acota el fin a "hoy" para no pedir fechas futuras. Devuelve null
 * si el ciclo no tiene fecha de inicio (no hay rango con qué reemplazar el actual).
 */
export function resolveSchoolYearDateRange(
  year: SchoolYearDateRangeInput | null | undefined,
  todayYmd: string,
): { from: string; to: string } | null {
  if (!year?.startsOn) return null
  const startsOn = year.startsOn.slice(0, 10)
  const endsOn = year.endsOn ? year.endsOn.slice(0, 10) : todayYmd
  const to = endsOn > todayYmd ? todayYmd : endsOn
  const from = startsOn > to ? to : startsOn
  return { from, to }
}

/** Lo que se está mirando en Indicadores del personal: el tablero y su informe piden lo mismo. */
export type StaffIndicatorFilters = {
  from: string
  to: string
  granularity: string
  /** Una persona manda sobre el rol. */
  userId?: string
  role?: string
  eventType?: string
  /** "Todos los ciclos" manda sobre el ciclo elegido. */
  allYears?: boolean
  schoolYearId?: string | null
}

export function staffIndicatorParams(filters: StaffIndicatorFilters): URLSearchParams {
  const params = new URLSearchParams({ from: filters.from, to: filters.to, granularity: filters.granularity })
  if (filters.userId) params.set('userId', filters.userId)
  else if (filters.role) params.set('role', filters.role)
  if (filters.eventType) params.set('eventType', filters.eventType)
  if (filters.allYears) params.set('allYears', '1')
  else if (filters.schoolYearId) params.set('schoolYearId', filters.schoolYearId)
  return params
}

/** El informe (PDF o Excel) de lo que se está mirando. */
export function staffReportPath(filters: StaffIndicatorFilters, format: 'pdf' | 'xlsx'): string {
  const params = staffIndicatorParams(filters)
  params.set('format', format)
  return `/analytics/report?${params.toString()}`
}
