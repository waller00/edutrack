import type { TuitionMonthState } from './students-display'

export const STUDENT_PAGE_SIZE = 20
export const TUITION_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

function isValidYear(value: string): boolean {
  return /^\d{4}$/.test(value.trim())
}

export type StudentListQueryParams = {
  page: number
  pageSize?: number
  q: string
  courseId: string
  orientationId: string
  status: string
  /** Año del que se previsualizan las cuotas en la tabla. */
  tuitionYear: string
  tuitionMonth: string
  tuitionPaid: string
  includeMoodle?: boolean
}

/**
 * Query string del listado de estudiantes.
 *
 * `tuitionYear` cumple dos papeles distintos: siempre define el año de la previsualización
 * de cuotas, y solo se convierte en FILTRO cuando además hay mes o estado de pago elegidos.
 */
export function buildStudentListQuery(params: StudentListQueryParams): string {
  const sp = new URLSearchParams()
  sp.set('page', String(params.page))
  sp.set('pageSize', String(params.pageSize ?? STUDENT_PAGE_SIZE))

  const year = params.tuitionYear.trim()
  if (isValidYear(year)) sp.set('tuitionPreviewYear', year)
  if (params.q.trim()) sp.set('q', params.q.trim())
  if (params.courseId) sp.set('courseId', params.courseId)
  if (params.orientationId) sp.set('orientationId', params.orientationId)
  if (params.status) sp.set('status', params.status)

  if ((params.tuitionMonth || params.tuitionPaid) && isValidYear(year)) {
    sp.set('tuitionYear', year)
    if (params.tuitionMonth) sp.set('tuitionMonth', params.tuitionMonth)
    if (params.tuitionPaid === 'true' || params.tuitionPaid === 'false') {
      sp.set('tuitionPaid', params.tuitionPaid)
    }
  }
  // El estado Moodle exige una llamada al web service: solo se pide bajo demanda.
  if (params.includeMoodle) sp.set('includeMoodle', '1')

  return sp.toString()
}

export type MonthCell = { month: number; paid: boolean; status: TuitionMonthState }

/** Los 12 meses del año con su estado: pagado, pendiente o sin registrar. */
export function monthsForYear(
  rows: readonly { year: number; month: number; paid: boolean }[],
  year: number,
): MonthCell[] {
  const byMonth = new Map(rows.filter((t) => t.year === year).map((t) => [t.month, t.paid]))
  return TUITION_MONTHS.map((month) => {
    const paid = byMonth.get(month)
    const status: TuitionMonthState = paid === true ? 'paid' : paid === false ? 'pending' : 'none'
    return { month, paid: paid === true, status }
  })
}

export function tuitionSummaryText(months: readonly MonthCell[]): string {
  const paid = months.filter((m) => m.status === 'paid').length
  const pending = months.filter((m) => m.status === 'pending').length
  return `${paid} pagos · ${pending} pendientes · ${months.length - paid - pending} sin estado`
}

/**
 * Ciclo del que se muestran las cuotas de una fila. En modo "todos los ciclos" cada fila es
 * una matrícula y manda su propio año; si no, manda el año elegido en el filtro.
 */
export function tuitionYearForRow(
  row: { schoolYearCode?: number | null },
  filterYear: string,
  fallbackYear: number,
): number {
  if (row.schoolYearCode) return row.schoolYearCode
  return Number(filterYear) || fallbackYear
}

export type TuitionMonthRow = {
  id?: string
  year: number
  month: number
  paid: boolean
  paidAt: string | null
  amountCents: number | null
  notes: string | null
}

/**
 * Ciclo de tres estados al tocar un mes: sin registrar → pagado → pendiente → sin registrar.
 * Devuelve la lista completa para que el llamador no mute el estado.
 */
export function cycleTuitionMonth(
  rows: readonly TuitionMonthRow[],
  year: number,
  month: number,
  now: () => string = () => new Date().toISOString(),
): TuitionMonthRow[] {
  const existing = rows.find((t) => t.year === year && t.month === month)
  if (!existing) {
    return [...rows, { id: '', year, month, paid: true, paidAt: now(), amountCents: null, notes: null }]
  }
  if (!existing.paid) return rows.filter((t) => !(t.year === year && t.month === month))
  return rows.map((t) =>
    t.year === year && t.month === month ? { ...t, paid: false, paidAt: null, amountCents: null } : t,
  )
}
