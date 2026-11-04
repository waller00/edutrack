/**
 * A dónde fue cada pantalla vieja de indicadores de estudiantes. Todo está ahora en Indicadores de
 * estudiantes (`/admin/student-indicators`), una sección por tema. Los avisos ya guardados, los
 * accesos directos y los marcadores siguen apuntando a las rutas viejas:
 *
 * - `/admin/reportes?tab=` (los primeros Reportes de estudiantes);
 * - `/admin/student-attendance/indicadores?tab=` (Indicadores de asistencia de estudiantes);
 * - `/libreta/indicadores?view=` (Rendimiento académico).
 *
 * El ciclo elegido (`schoolYearId`) pasa con el enlace.
 */

export const STUDENT_INDICATORS_PATH = '/admin/student-indicators'

type Params = Pick<URLSearchParams, 'get'>

const KEPT = ['schoolYearId'] as const

function indicatorsHref(target: Record<string, string>, params?: Params): string {
  const next = new URLSearchParams(target)
  for (const key of KEPT) {
    const value = params?.get(key)
    if (value) next.set(key, value)
  }
  const query = next.toString()
  return query ? `${STUDENT_INDICATORS_PATH}?${query}` : STUDENT_INDICATORS_PATH
}

/** Las dos listas de Asistencia: faltas seguidas y 18 y 25 faltas. */
function attendanceList(tab: string | null): Record<string, string> {
  return { seccion: 'asistencia', lista: tab === 'faltas' ? 'faltas' : 'seguidas' }
}

/** `/admin/reportes?tab=`: las faltas a Asistencia, las notas a Materias. */
export function legacyReportsTarget(params?: Params): string {
  const tab = params?.get('tab') ?? null
  if (tab === 'notas' || tab === 'bajas') return indicatorsHref({ seccion: 'materias' }, params)
  // "seguidas", "faltas", "alertas" (las alertas que avisan son de faltas) o sin pestaña.
  return indicatorsHref(attendanceList(tab), params)
}

/** `/admin/student-attendance/indicadores?tab=`: «Prioridad de seguimiento» pasó a Quién necesita atención. */
export function legacyAttendanceIndicatorsTarget(params?: Params): string {
  const tab = params?.get('tab') ?? null
  if (tab === 'prioridad') return indicatorsHref({ seccion: 'riesgo', motivo: 'faltas' }, params)
  if (tab === 'seguidas' || tab === 'faltas') return indicatorsHref(attendanceList(tab), params)
  return indicatorsHref({ seccion: 'asistencia' }, params)
}

const ACADEMIC_VIEWS: Record<string, string> = {
  seguimiento: 'materias',
  asistencia: 'asistencia',
  rendimiento: 'rendimiento',
}

/** `/libreta/indicadores?view=`: el seguimiento de notas está en Materias; sin vista, el Resumen. */
export function legacyAcademicTarget(params?: Params): string {
  const section = ACADEMIC_VIEWS[params?.get('view') ?? '']
  return indicatorsHref(section ? { seccion: section } : {}, params)
}

/** Los `searchParams` de una página del servidor, para leerlos como en el navegador. */
export function searchParamsOf(record: Record<string, string | string[] | undefined> | undefined): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(record ?? {})) {
    const first = Array.isArray(value) ? value[0] : value
    if (first !== undefined) params.set(key, first)
  }
  return params
}
