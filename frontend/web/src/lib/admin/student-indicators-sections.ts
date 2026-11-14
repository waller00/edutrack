import { hasPermission, type WithPermissions } from '@/lib/auth/permissions'

/**
 * Las secciones de Indicadores de estudiantes (`/admin/student-indicators?seccion=`). Cada una pide
 * el permiso de donde salen sus números: las notas y la trayectoria son de los indicadores
 * académicos; las faltas, las materias y quién necesita atención, de los reportes de estudiantes.
 * Adscripción, que tiene sólo los reportes, ve esas secciones y nada más.
 */

export const ANALYTICS_PERMISSION = 'academic-analytics.read'
export const REPORTS_PERMISSION = 'student-reports.read'

export type IndicatorSectionId = 'resumen' | 'rendimiento' | 'materias' | 'asistencia' | 'trayectoria' | 'riesgo'

export type IndicatorSection = {
  id: IndicatorSectionId
  label: string
  /** Alcanza con uno: el Resumen muestra cada mosaico según el permiso de su fuente. */
  permissions: readonly string[]
  /** Se calcula sobre un boletín: la pantalla ofrece elegirlo. */
  usesReportCard: boolean
}

export const INDICATOR_SECTIONS: readonly IndicatorSection[] = [
  { id: 'resumen', label: 'Resumen', permissions: [ANALYTICS_PERMISSION, REPORTS_PERMISSION], usesReportCard: true },
  { id: 'rendimiento', label: 'Rendimiento', permissions: [ANALYTICS_PERMISSION], usesReportCard: true },
  { id: 'materias', label: 'Materias y APE', permissions: [REPORTS_PERMISSION], usesReportCard: true },
  { id: 'asistencia', label: 'Asistencia', permissions: [REPORTS_PERMISSION], usesReportCard: false },
  { id: 'trayectoria', label: 'Trayectoria', permissions: [ANALYTICS_PERMISSION], usesReportCard: false },
  { id: 'riesgo', label: 'Quién necesita atención', permissions: [REPORTS_PERMISSION], usesReportCard: true },
]

export type IndicatorAccess = { analytics: boolean; reports: boolean }

/** Los indicadores son del centro entero: sólo cuentan los permisos con alcance `all`. */
export function indicatorAccess(me: WithPermissions): IndicatorAccess {
  return {
    analytics: hasPermission(me, ANALYTICS_PERMISSION, 'all'),
    reports: hasPermission(me, REPORTS_PERMISSION, 'all'),
  }
}

export function visibleSections(access: IndicatorAccess): IndicatorSection[] {
  const granted = (permission: string) =>
    permission === ANALYTICS_PERMISSION ? access.analytics : permission === REPORTS_PERMISSION && access.reports
  return INDICATOR_SECTIONS.filter((section) => section.permissions.some(granted))
}

/** La pedida en la URL si existe y se puede ver; si no, la primera visible. */
export function resolveSection(
  requested: string | null | undefined,
  visible: readonly IndicatorSection[],
): IndicatorSection | null {
  return visible.find((section) => section.id === requested) ?? visible[0] ?? null
}

// ─── De dónde sale cada número ──────────────────────────────────────────────

export type ComparisonDimension = 'SUBJECT' | 'COURSE' | 'YEAR'

export type PathInput = {
  /** `schoolYearId=…` del selector del menú. */
  query: string
  /** El ciclo ya se resolvió (el selector terminó de cargar). */
  yearReady: boolean
  /** Ya se sabe qué boletines tiene el ciclo. */
  periodsReady: boolean
  period: { id: string; level: string | null } | null
}

const withYear = (path: string, query: string) => (query ? `${path}${path.includes('?') ? '&' : '?'}${query}` : path)

/** `level` y `periodId` del boletín, como los piden el tablero y la comparación. */
function periodFilters(period: PathInput['period']): URLSearchParams {
  const filters = new URLSearchParams()
  if (period?.level) filters.set('level', period.level)
  if (period) filters.set('periodId', period.id)
  return filters
}

/** Entre años se compara el mismo boletín en cada ciclo del selector. */
function comparisonQuery(filters: URLSearchParams, dimension: ComparisonDimension, schoolYearIds: string): URLSearchParams {
  const query = new URLSearchParams(filters)
  query.set('dimension', dimension)
  if (dimension === 'YEAR' && schoolYearIds) query.set('schoolYearIds', schoolYearIds)
  return query
}

/** Las direcciones de cada sección; `null` mientras falta saber el ciclo o el boletín. */
export function indicatorPaths(input: PathInput) {
  const year = (path: string) => (input.yearReady ? withYear(path, input.query) : null)
  const onPeriod = (path: string) => (input.periodsReady ? withYear(path, input.query) : null)
  const periodId = input.period ? `?periodId=${input.period.id}` : ''
  const periodOnly = (path: string) => (input.periodsReady && periodId ? `${path}${periodId}` : null)
  const filters = periodFilters(input.period)
  const suffix = filters.size > 0 ? `?${filters}` : ''
  return {
    trend: year('/admin/student-reports/attendance-trend'),
    streaks: year('/admin/student-reports/absence-streaks'),
    thresholds: year('/admin/student-reports/absence-thresholds'),
    trajectory: year('/admin/academic-analytics/trajectory'),
    subjectsApe: year('/admin/student-reports/subjects-ape'),
    risk: onPeriod(`/admin/student-reports/risk${periodId}`),
    dashboard: onPeriod(`/admin/academic-analytics/dashboard${suffix}`),
    comparison: (dimension: ComparisonDimension, schoolYearIds: string) =>
      onPeriod(`/admin/academic-analytics/comparison?${comparisonQuery(filters, dimension, schoolYearIds)}`),
    lowGrades: periodOnly('/admin/student-reports/low-grades'),
    drops: periodOnly('/admin/student-reports/grade-drops'),
  }
}

/**
 * El informe (PDF o Excel) de lo que se está mirando: el ciclo del menú y el boletín elegido. Trae
 * las secciones que quien lo baja puede ver; las decide el servidor con los mismos permisos.
 */
export function indicatorReportPath(input: { query: string; period: { id: string } | null }, format: 'pdf' | 'xlsx'): string {
  const params = new URLSearchParams({ format })
  if (input.period) params.set('periodId', input.period.id)
  return withYear(`/admin/student-indicators/report?${params.toString()}`, input.query)
}

/** La URL con esos cambios: `null` saca el parámetro, el resto queda como estaba. */
export function nextQuery(current: string, changes: Record<string, string | null>): string {
  const next = new URLSearchParams(current)
  for (const [name, value] of Object.entries(changes)) {
    if (value) next.set(name, value)
    else next.delete(name)
  }
  return next.toString()
}
