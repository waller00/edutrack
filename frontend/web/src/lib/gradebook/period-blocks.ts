/**
 * Bloques de la carta del alumno, con la forma de la planilla del liceo:
 *
 * - **Tramo** (Marzo–Abril, Mayo–Junio…): Or · Otras · Ev · [Prueba] · C · R.
 * - **Entrega** (1.ª a 4.ª reunión): informe de actuación · C · R.
 * - **Diagnóstico** (reunión de trayectorias): sólo el texto.
 *
 * C es la calificación que pone el docente y R la que queda después de la reunión. Las columnas
 * Or/Otras/Ev muestran las notas sueltas, nunca un promedio.
 */
import { ACTIVITY_CATEGORY_ORDER, type ActivityCategory } from './activity-category'

export type PeriodKind = 'DIAGNOSTICO' | 'TRAMO' | 'ENTREGA'

export type LibretaPeriod = {
  id: string
  code: string
  name: string
  kind?: PeriodKind
  startsOn?: string | null
  endsOn?: string | null
  requiresGeneralGrade?: boolean
  requiresConceptualJudgement?: boolean
  isMeeting?: boolean
  judgementLabel?: string | null
}

/** C, R y el texto de un alumno en un período. */
export type PeriodGradeValues = {
  valueHundredths: number | null
  meetingValueHundredths: number | null
  conceptualJudgement: string | null
}

export function periodKind(period: Pick<LibretaPeriod, 'kind'>): PeriodKind {
  return period.kind ?? 'TRAMO'
}

/** Sólo en los tramos se cargan notas sueltas. */
export function gradablePeriods<T extends Pick<LibretaPeriod, 'kind'>>(periods: readonly T[]): T[] {
  return periods.filter((period) => periodKind(period) === 'TRAMO')
}

/** Nombre del texto del período, con el rótulo de la planilla si la configuración no trae uno. */
export function judgementLabelOf(period: Pick<LibretaPeriod, 'kind' | 'judgementLabel'>): string {
  if (period.judgementLabel) return period.judgementLabel
  const kind = periodKind(period)
  if (kind === 'DIAGNOSTICO') return 'Diagnóstico'
  if (kind === 'ENTREGA') return 'Informe de actuación'
  return 'Juicio conceptual'
}

/** Columnas de notas de un tramo: Or · Otras · Ev siempre, y Prueba sólo si hubo alguna. */
export function blockCategories(grades: ReadonlyArray<{ category: ActivityCategory }>): ActivityCategory[] {
  const hasTest = grades.some((grade) => grade.category === 'test')
  return ACTIVITY_CATEGORY_ORDER.filter((category) => category !== 'test' || hasTest)
}

export function gradesByCategory<T extends { category: ActivityCategory }>(
  grades: readonly T[],
): Record<ActivityCategory, T[]> {
  const buckets: Record<ActivityCategory, T[]> = { oral: [], other: [], written: [], test: [] }
  for (const grade of grades) buckets[grade.category].push(grade)
  return buckets
}

/**
 * Tramo en el que cae un día: el que lo contiene; si ninguno (vacaciones), el último que ya
 * empezó; y si todavía no empezó ninguno, el primero. Es el período que el formulario propone.
 */
export function tramoForDate<T extends LibretaPeriod>(periods: readonly T[], ymd: string): T | null {
  const tramos = gradablePeriods(periods)
  const containing = tramos.find(
    (p) => (!p.startsOn || p.startsOn <= ymd) && (!p.endsOn || ymd <= p.endsOn),
  )
  if (containing) return containing
  const started = tramos.filter((p) => p.startsOn && p.startsOn <= ymd)
  return started.at(-1) ?? tramos[0] ?? null
}

export type StoredPeriodGrade = PeriodGradeValues & { periodId: string; studentId: string }

/**
 * Aplica a la lista local lo que se acaba de guardar, sin recargar la carta entera: el guardado
 * es parcial, así que sólo cambian los campos que vinieron.
 */
export function mergePeriodGrade(
  list: readonly StoredPeriodGrade[],
  periodId: string,
  studentId: string,
  patch: Partial<PeriodGradeValues>,
): StoredPeriodGrade[] {
  const index = list.findIndex((g) => g.periodId === periodId && g.studentId === studentId)
  if (index < 0) {
    return [
      ...list,
      { periodId, studentId, valueHundredths: null, meetingValueHundredths: null, conceptualJudgement: null, ...patch },
    ]
  }
  return list.map((g, i) => (i === index ? { ...g, ...patch } : g))
}

/** Notas sueltas de una celda, como las escribe el docente en la planilla: "7 · 9 · Aus". */
export function formatGradeList(
  grades: ReadonlyArray<{ valueHundredths: number | null; isAbsent: boolean }>,
  decimals = 0,
): string {
  const parts = grades
    .map((g) => {
      if (g.isAbsent) return 'Aus'
      if (g.valueHundredths == null) return null
      return (g.valueHundredths / 100).toFixed(Math.max(0, Math.min(2, decimals))).replace('.', ',')
    })
    .filter((v): v is string => v != null)
  return parts.length > 0 ? parts.join(' · ') : '—'
}
