import { resolveLevel } from '../academic-config/grade-value.js'

/**
 * Vistas institucionales de la libreta (RF-031, RF-060, RF-061).
 *
 * Todo derivado al leer: no hay contadores ni promedios persistidos. La misma decisión que tomó
 * el pase de lista con la consolidación de faltas — un agregado guardado se desactualiza sin que
 * nadie se entere, y acá encima cambiaría el sentido de una libreta ya cerrada.
 */

/** Espeja `RosterScope`: la orientación tiene dos formas y hay que contemplar las dos. */
export type MatrixScope = {
  courseOfferingId: string
  orientationId: string | null
  courseOrientationId: string | null
}

export type GradeBookRef = {
  id: string
  subjectId: string
  courseOfferingId: string
  courseOrientationId: string | null
  orientationId: string | null
}

/**
 * ¿Qué libretas cursa un grupo?
 *
 * Las de su orientación **más las de tronco común**. Es la contracara exacta del roster: si el
 * grupo es "3.º EMS – Ciencias de la Vida", sus alumnos cursan Biología Humana (de la orientación)
 * y también Idioma Español (común a todo el curso). Quedarse sólo con las de la orientación
 * dejaría la matriz sin la mitad de las asignaturas.
 */
export function gradeBooksForGroup<T extends GradeBookRef>(
  gradeBooks: readonly T[],
  scope: MatrixScope,
): T[] {
  return gradeBooks.filter((gb) => {
    if (gb.courseOfferingId !== scope.courseOfferingId) return false
    // Tronco común: sin orientación en ninguna de sus dos formas.
    if (gb.courseOrientationId == null && gb.orientationId == null) return true
    // Con orientación: tiene que coincidir en la MISMA forma en que está expresada. Comparar sólo
    // `courseOrientationId` haría que una libreta guardada con `orientationId` del catálogo
    // apareciera en cualquier grupo sin orientación, porque ahí ambos lados son null.
    if (gb.courseOrientationId != null) return gb.courseOrientationId === scope.courseOrientationId
    return gb.orientationId === scope.orientationId
  })
}

export type ScaleLevelRow = {
  id: string
  label: string
  descriptor: string | null
  minValueHundredths: number
  maxValueHundredths: number
  colorToken: string | null
  iconToken: string | null
  isPassing: boolean
  isAlert: boolean
}

export type MatrixCell = {
  gradeBookId: string
  subjectId: string
  valueHundredths: number | null
  conceptualJudgement: string | null
  descriptor: ReturnType<typeof describeCell>
  /** Estado del período en esa libreta; `null` si nadie lo abrió todavía. */
  periodStatus: 'OPEN' | 'CLOSED' | 'REOPENED' | null
  /** No hay calificación cargada para este estudiante en esta asignatura. */
  pending: boolean
}

function describeCell(valueHundredths: number | null, levels: readonly ScaleLevelRow[]) {
  const level = resolveLevel(valueHundredths, levels)
  if (!level) return null
  return {
    label: level.label,
    descriptor: level.descriptor,
    colorToken: level.colorToken,
    iconToken: level.iconToken,
    isPassing: level.isPassing,
    isAlert: level.isAlert,
  }
}

export { describeCell }

export type MatrixRow = {
  studentId: string
  lastName: string
  firstName: string
  cells: MatrixCell[]
  /** Indicador automático (RF-061): promedio transversal de las asignaturas calificadas. */
  averageHundredths: number | null
  /** Asignaturas sin calificación del período. */
  pendingCount: number
  /** Asignaturas cuyo resultado cae en un tramo marcado como alerta. */
  alertCount: number
}

/**
 * Promedio transversal de las asignaturas (RF-061).
 *
 * **Indicador automático, no una calificación.** Sólo promedia lo que está calificado: una
 * asignatura pendiente no arrastra el promedio hacia abajo, porque "todavía no tiene nota" no es
 * lo mismo que "sacó poco".
 */
export function transversalAverage(cells: readonly MatrixCell[]): number | null {
  const values = cells.map((c) => c.valueHundredths).filter((v): v is number => v != null)
  if (values.length === 0) return null
  return Math.round(values.reduce((acc, v) => acc + v, 0) / values.length)
}

export function buildMatrixRow(params: {
  student: { studentId: string; lastName: string; firstName: string }
  cells: MatrixCell[]
}): MatrixRow {
  const { cells } = params
  return {
    ...params.student,
    cells,
    averageHundredths: transversalAverage(cells),
    pendingCount: cells.filter((c) => c.pending).length,
    alertCount: cells.filter((c) => c.descriptor?.isAlert).length,
  }
}

export type RiskRule = {
  /** Cantidad de asignaturas en alerta a partir de la cual el estudiante se destaca. */
  alertSubjectsThreshold: number
}

export const DEFAULT_RISK_RULE: RiskRule = { alertSubjectsThreshold: 3 }

/**
 * ¿El estudiante entra en situación de alerta?
 *
 * El umbral es configurable (§5.7 pide que no esté programado de forma rígida) y por ahora vive
 * como default explícito. **La alerta es informativa**: el pliego prohíbe que dispare sola
 * decisiones administrativas, promociones o sanciones.
 */
export function isAtRisk(row: Pick<MatrixRow, 'alertCount'>, rule: RiskRule = DEFAULT_RISK_RULE): boolean {
  return row.alertCount >= rule.alertSubjectsThreshold
}

export type StudentHistoryEntry = {
  schoolYearCode: number
  schoolYearLabel: string
  courseName: string
  orientationName: string | null
  periodCode: string
  periodName: string
  periodSortOrder: number
  subjectName: string
  valueHundredths: number | null
  conceptualJudgement: string | null
}

export type SubjectEvolution = {
  subjectName: string
  points: Array<{ periodCode: string; periodName: string; valueHundredths: number | null }>
}

/**
 * Evolución por asignatura a lo largo de los períodos (§5.6).
 *
 * Se conserva el punto sin nota como `null` en vez de omitirlo: un hueco en la serie es
 * información —"este período no tiene datos"— y borrarlo haría que dos períodos separados
 * parecieran consecutivos.
 */
export function buildSubjectEvolution(entries: readonly StudentHistoryEntry[]): SubjectEvolution[] {
  const periods = [...new Map(entries.map((e) => [e.periodCode, e])).values()].sort(
    (a, b) => a.periodSortOrder - b.periodSortOrder,
  )
  const bySubject = new Map<string, Map<string, number | null>>()

  for (const entry of entries) {
    const subject = bySubject.get(entry.subjectName) ?? new Map<string, number | null>()
    subject.set(entry.periodCode, entry.valueHundredths)
    bySubject.set(entry.subjectName, subject)
  }

  return [...bySubject.entries()]
    .map(([subjectName, byPeriod]) => ({
      subjectName,
      points: periods.map((p) => ({
        periodCode: p.periodCode,
        periodName: p.periodName,
        valueHundredths: byPeriod.has(p.periodCode) ? (byPeriod.get(p.periodCode) ?? null) : null,
      })),
    }))
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'es'))
}

/**
 * ¿La serie muestra un descenso sostenido? (§5.7)
 *
 * Exige al menos tres puntos con nota y que cada uno baje respecto del anterior. Dos puntos no
 * alcanzan: una sola baja es ruido, no una tendencia.
 */
export function hasSustainedDecline(points: ReadonlyArray<{ valueHundredths: number | null }>): boolean {
  const values = points.map((p) => p.valueHundredths).filter((v): v is number => v != null)
  if (values.length < 3) return false
  const last = values.slice(-3)
  return last[0] > last[1] && last[1] > last[2]
}
