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

export type StudentsBlock = {
  total: number
  evaluated: number
  withoutAssessments: number
  atRisk: number
  improved: number
  declined: number
}

export function studentsBlock(
  students: readonly StudentSnapshot[],
  rules: readonly AlertRule[],
  levels: readonly LevelRow[],
): StudentsBlock {
  let evaluated = 0
  let atRisk = 0
  let improved = 0
  let declined = 0

  for (const student of students) {
    if (student.assessmentCount > 0) evaluated++
    if (triggeredAlerts(student, rules, levels).length > 0) atRisk++
    const trend = studentTrend(student.periodValues)
    if (trend === 'IMPROVED') improved++
    if (trend === 'DECLINED') declined++
  }

  return {
    total: students.length,
    evaluated,
    withoutAssessments: students.length - evaluated,
    atRisk,
    improved,
    declined,
  }
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

export type GradeBookState = {
  gradeBookId: string
  /** Estudiantes del grupo con calificación general cargada en el período. */
  gradedStudents: number
  rosterSize: number
  periodStatus: 'OPEN' | 'CLOSED' | 'REOPENED' | null
  endorsed: boolean
  /** El cierre ocurrió pasado el plazo del período. */
  closedLate: boolean
}

export type ManagementBlock = {
  gradeBooks: number
  complete: number
  incomplete: number
  pendingClosures: number
  pendingEndorsements: number
  endorsedPercentage: number
  lateClosures: number
  startedPercentage: number
}

/**
 * Indicadores de gestión de libretas (§5.9).
 *
 * Una libreta está **completa** cuando todos los estudiantes del grupo tienen calificación
 * general. Un grupo vacío cuenta como completo: no hay nada pendiente en él, y contarlo como
 * incompleto inflaría el pendiente con grupos que no existen.
 *
 * El pliego aclara que estos números sirven para gestionar y **no constituyen por sí solos un
 * mecanismo de evaluación del desempeño docente**.
 */
export function managementBlock(states: readonly GradeBookState[]): ManagementBlock {
  const total = states.length
  let complete = 0
  let pendingClosures = 0
  let pendingEndorsements = 0
  let endorsed = 0
  let lateClosures = 0
  let started = 0

  for (const state of states) {
    if (state.gradedStudents >= state.rosterSize) complete++
    if (state.periodStatus !== 'CLOSED') pendingClosures++
    if (state.endorsed) endorsed++
    else if (state.periodStatus === 'CLOSED') pendingEndorsements++
    if (state.closedLate) lateClosures++
    if (state.gradedStudents > 0) started++
  }

  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10)

  return {
    gradeBooks: total,
    complete,
    incomplete: total - complete,
    pendingClosures,
    pendingEndorsements,
    endorsedPercentage: pct(endorsed),
    lateClosures,
    startedPercentage: pct(started),
  }
}

export type ComparisonRow = {
  key: string
  label: string
  averageHundredths: number | null
  medianHundredths: number | null
  gradedCount: number
  studentCount: number
  /** Porcentaje de resultados en tramo de alerta (§5.5). */
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
      alertPercentage: group.values.length === 0 ? 0 : Math.round((inAlert / group.values.length) * 1000) / 10,
    }
  })
}
