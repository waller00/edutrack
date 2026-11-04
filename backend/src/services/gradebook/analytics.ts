import { resolveLevel } from '../academic-config/grade-value.js'

/**
 * Indicadores del backoffice académico (§5).
 *
 * Todo derivado al leer, sin repositorio analítico aparte: a escala de un liceo la separación que
 * recomienda §5.10 no compensa, y un agregado persistido se desactualiza sin que nadie se entere.
 * Acá vive sólo la aritmética; las consultas están en la ruta.
 */

export type LevelRow = {
  id: string
  label: string
  minValueHundredths: number
  maxValueHundredths: number
  colorToken: string | null
  iconToken: string | null
  isPassing: boolean
  isAlert: boolean
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return Math.round(values.reduce((acc, v) => acc + v, 0) / values.length)
}

/**
 * Mediana. Con cantidad par promedia los dos centrales.
 *
 * Va junto al promedio y no en su lugar: el pliego pide las dos porque una distribución con pocos
 * resultados muy bajos mueve el promedio y no la mediana, y esa diferencia es justamente la señal.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

export type DistributionBucket = {
  levelId: string
  label: string
  colorToken: string | null
  iconToken: string | null
  isAlert: boolean
  count: number
  /** Porcentaje sobre el total de resultados con nota, con un decimal. */
  percentage: number
}

/**
 * Distribución por tramo de la escala (§5.1).
 *
 * Devuelve **todos** los tramos, incluso los vacíos: un histograma al que le faltan las barras en
 * cero miente sobre la forma de la distribución.
 */
export function distributionByLevel(
  values: readonly number[],
  levels: readonly LevelRow[],
): DistributionBucket[] {
  const counts = new Map<string, number>()
  let classified = 0
  for (const value of values) {
    const level = resolveLevel(value, levels)
    if (!level) continue
    counts.set(level.id, (counts.get(level.id) ?? 0) + 1)
    classified++
  }
  return levels.map((level) => {
    const count = counts.get(level.id) ?? 0
    return {
      levelId: level.id,
      label: level.label,
      colorToken: level.colorToken,
      iconToken: level.iconToken,
      isAlert: level.isAlert,
      count,
      percentage: classified === 0 ? 0 : Math.round((count / classified) * 1000) / 10,
    }
  })
}

export type Trend = 'IMPROVED' | 'DECLINED' | 'STABLE' | 'NO_DATA'

/**
 * Tendencia entre el primer y el último período con nota (§5.1).
 *
 * Se compara punta a punta y no período a período: lo que el pliego pregunta es "cuántos mejoraron
 * entre dos períodos", no cuántos tuvieron una oscilación. Hace falta al menos dos puntos.
 */
export function studentTrend(points: ReadonlyArray<number | null>, toleranceHundredths = 0): Trend {
  const values = points.filter((v): v is number => v != null)
  if (values.length < 2) return 'NO_DATA'
  const delta = values[values.length - 1] - values[0]
  if (delta > toleranceHundredths) return 'IMPROVED'
  if (delta < -toleranceHundredths) return 'DECLINED'
  return 'STABLE'
}

/** Caída máxima entre dos períodos consecutivos, para la regla `SCORE_DROP` (§5.7). */
export function maxDrop(points: ReadonlyArray<number | null>): number {
  const values = points.filter((v): v is number => v != null)
  let worst = 0
  for (let i = 1; i < values.length; i++) {
    worst = Math.max(worst, values[i - 1] - values[i])
  }
  return worst
}

export type AlertRule = { type: 'ALERT_SUBJECTS' | 'SCORE_DROP' | 'NO_ASSESSMENTS'; threshold: number }

export type StudentSnapshot = {
  studentId: string
  lastName: string
  firstName: string
  /** Una nota por asignatura en el período analizado. */
  subjectValues: ReadonlyArray<number | null>
  /** Serie del estudiante a lo largo de los períodos, para tendencia y caídas. */
  periodValues: ReadonlyArray<number | null>
  assessmentCount: number
}

export type TriggeredAlert = { type: AlertRule['type']; detail: number }

/**
 * Qué reglas dispara un estudiante.
 *
 * **Informativo y de apoyo a la intervención** (§5.7): el pliego prohíbe expresamente que estas
 * alertas generen por sí solas promociones, repeticiones o sanciones. Por eso se devuelve la lista
 * de lo que se disparó, no un veredicto.
 */
export function triggeredAlerts(
  student: StudentSnapshot,
  rules: readonly AlertRule[],
  levels: readonly LevelRow[],
): TriggeredAlert[] {
  const fired: TriggeredAlert[] = []

  for (const rule of rules) {
    if (rule.type === 'ALERT_SUBJECTS') {
      const inAlert = student.subjectValues.filter(
        (value) => value != null && resolveLevel(value, levels)?.isAlert,
      ).length
      if (inAlert >= rule.threshold) fired.push({ type: rule.type, detail: inAlert })
    }
    if (rule.type === 'SCORE_DROP') {
      const drop = maxDrop(student.periodValues)
      if (drop >= rule.threshold) fired.push({ type: rule.type, detail: drop })
    }
    if (rule.type === 'NO_ASSESSMENTS' && student.assessmentCount === 0) {
      fired.push({ type: rule.type, detail: 0 })
    }
  }

  return fired
}

/**
 * Estudiantes con nota de reunión hasta la de referencia: cuántos disparan alguna regla y cómo
 * evolucionó su promedio. Ya no cuenta "evaluados": un estudiante contaba como evaluado sólo porque
 * su libreta tenía una actividad, y daba casi siempre 100 %.
 */
export type StudentsBlock = {
  total: number
  atRisk: number
  improved: number
  declined: number
  /** Con dos o más reuniones con nota para comparar (los demás no mejoran ni bajan). */
  compared: number
}

export function studentsBlock(
  students: readonly StudentSnapshot[],
  rules: readonly AlertRule[],
  levels: readonly LevelRow[],
): StudentsBlock {
  let atRisk = 0
  let improved = 0
  let declined = 0
  let compared = 0

  for (const student of students) {
    if (triggeredAlerts(student, rules, levels).length > 0) atRisk++
    const trend = studentTrend(student.periodValues)
    if (trend !== 'NO_DATA') compared++
    if (trend === 'IMPROVED') improved++
    if (trend === 'DECLINED') declined++
  }

  return { total: students.length, atRisk, improved, declined, compared }
}

/** Estudiantes según cuántas materias tienen en tramo de alerta en la reunión de referencia. */
export type LowSubjectsHistogram = {
  /** Con al menos una R en la reunión: es el total sobre el que se cuenta. */
  graded: number
  none: number
  one: number
  two: number
  threeOrMore: number
}

export function lowSubjectsHistogram(students: readonly StudentSnapshot[], levels: readonly LevelRow[]): LowSubjectsHistogram {
  const histogram: LowSubjectsHistogram = { graded: 0, none: 0, one: 0, two: 0, threeOrMore: 0 }
  for (const student of students) {
    const graded = student.subjectValues.filter((value): value is number => value != null)
    if (graded.length === 0) continue
    histogram.graded++
    const low = graded.filter((value) => resolveLevel(value, levels)?.isAlert).length
    if (low === 0) histogram.none++
    else if (low === 1) histogram.one++
    else if (low === 2) histogram.two++
    else histogram.threeOrMore++
  }
  return histogram
}

export type PerformanceBlock = {
  averageHundredths: number | null
  medianHundredths: number | null
  distribution: DistributionBucket[]
  gradedCount: number
}

export function performanceBlock(
  values: readonly number[],
  levels: readonly LevelRow[],
): PerformanceBlock {
  return {
    averageHundredths: mean(values),
    medianHundredths: median(values),
    distribution: distributionByLevel(values, levels),
    gradedCount: values.length,
  }
}

export type ComparisonRow = {
  key: string
  label: string
  averageHundredths: number | null
  medianHundredths: number | null
  gradedCount: number
  studentCount: number
  /** Resultados en tramo de alerta (§5.5), y su porcentaje sobre `gradedCount`. */
  alertCount: number
  alertPercentage: number
}

/** Comparativa por dimensión: año, curso o asignatura (§5.3, §5.4, §5.5). */
export function buildComparison(
  groups: ReadonlyArray<{ key: string; label: string; values: readonly number[]; studentCount: number }>,
  levels: readonly LevelRow[],
): ComparisonRow[] {
  return groups.map((group) => {
    const inAlert = group.values.filter((value) => resolveLevel(value, levels)?.isAlert).length
    return {
      key: group.key,
      label: group.label,
      averageHundredths: mean(group.values),
      medianHundredths: median(group.values),
      gradedCount: group.values.length,
      studentCount: group.studentCount,
      alertCount: inAlert,
      alertPercentage: group.values.length === 0 ? 0 : Math.round((inAlert / group.values.length) * 1000) / 10,
    }
  })
}

// ─── Instantánea por reunión ────────────────────────────────────────────────

/** `reportCard`: es una reunión de boletín (entrega, semestre), no una de APE o exámenes. */
export type AnalyticsPeriod = { id: string; name: string; sortOrder: number; reportCard?: boolean }

/** Un período de una libreta, ya con la nota oficial (R) resuelta. */
export type AnalyticsState = {
  gradeBookId: string
  period: AnalyticsPeriod
  grades: ReadonlyArray<{ studentId: string; lastName: string; firstName: string; value: number | null }>
}

/**
 * Reunión de referencia: la elegida, o el último boletín que ya tiene alguna nota de reunión.
 *
 * Sin una reunión de referencia los indicadores mezclaban todas las del año (el promedio juntaba
 * el diagnóstico con febrero) y "materias en alerta" tomaba la nota de una reunión cualquiera. Y la
 * última con nota de un año cerrado es la APE de febrero, donde sólo tienen nota los que fueron:
 * por eso se prefiere un boletín.
 */
export function referencePeriod(states: readonly AnalyticsState[], periodId?: string | null): AnalyticsPeriod | null {
  const periods = new Map(states.map((state) => [state.period.id, state.period]))
  if (periodId) return periods.get(periodId) ?? null
  const graded = states.filter((state) => state.grades.some((g) => g.value != null)).map((state) => state.period)
  const candidates = [graded.filter((p) => p.reportCard), graded, [...periods.values()].filter((p) => p.reportCard), [...periods.values()]]
  const pool = candidates.find((list) => list.length > 0) ?? []
  return pool.reduce<AnalyticsPeriod | null>((best, p) => (!best || p.sortOrder > best.sortOrder ? p : best), null)
}

type StudentAccumulator = {
  lastName: string
  firstName: string
  gradeBooks: Set<string>
  bySubject: Map<string, number | null>
  byPeriod: Map<string, { sortOrder: number; values: number[] }>
}

/**
 * Una fila por estudiante: su nota en cada asignatura en la reunión de referencia, y la serie de su
 * **promedio por reunión** hasta esa reunión.
 *
 * La serie antes guardaba, por reunión, la nota de la última materia que se recorría: "mejoró" o
 * "bajó" comparaba Matemática de una entrega con Dibujo de otra. El promedio de sus materias en
 * cada reunión sí dice si el estudiante subió o bajó.
 */
export function studentSnapshots(params: {
  states: readonly AnalyticsState[]
  subjectOf: ReadonlyMap<string, string>
  reference: AnalyticsPeriod | null
  assessmentsOf: (gradeBookIds: ReadonlySet<string>) => number
}): StudentSnapshot[] {
  const { states, subjectOf, reference } = params
  const students = new Map<string, StudentAccumulator>()

  for (const state of states) {
    // La serie llega hasta la reunión de referencia: lo posterior todavía no "pasó" para ella.
    if (reference && state.period.sortOrder > reference.sortOrder) continue
    const subjectId = subjectOf.get(state.gradeBookId)
    const atReference = reference != null && state.period.id === reference.id
    for (const grade of state.grades) {
      const acc = students.get(grade.studentId) ?? {
        lastName: grade.lastName,
        firstName: grade.firstName,
        gradeBooks: new Set<string>(),
        bySubject: new Map<string, number | null>(),
        byPeriod: new Map<string, { sortOrder: number; values: number[] }>(),
      }
      acc.gradeBooks.add(state.gradeBookId)
      if (atReference && subjectId) acc.bySubject.set(subjectId, grade.value)
      if (grade.value != null) {
        const bucket = acc.byPeriod.get(state.period.id) ?? { sortOrder: state.period.sortOrder, values: [] }
        bucket.values.push(grade.value)
        acc.byPeriod.set(state.period.id, bucket)
      }
      students.set(grade.studentId, acc)
    }
  }

  return [...students.entries()].map(([studentId, acc]) => ({
    studentId,
    lastName: acc.lastName,
    firstName: acc.firstName,
    subjectValues: [...acc.bySubject.values()],
    periodValues: [...acc.byPeriod.values()].sort((a, b) => a.sortOrder - b.sortOrder).map((bucket) => mean(bucket.values)),
    assessmentCount: params.assessmentsOf(acc.gradeBooks),
  }))
}

/** Las notas de la reunión de referencia, para promedio, mediana y distribución. */
export function valuesAt(states: readonly AnalyticsState[], reference: AnalyticsPeriod | null): number[] {
  if (!reference) return []
  return states
    .filter((state) => state.period.id === reference.id)
    .flatMap((state) => state.grades.map((g) => g.value))
    .filter((value): value is number => value != null)
}
