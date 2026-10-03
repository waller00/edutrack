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
