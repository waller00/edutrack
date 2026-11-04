import { closureBlockers, isReportCardPeriod, type ClosureBlocker, type PeriodRules, type StudentPeriodRow } from './period-closure.js'

/**
 * Qué falta para cerrar una reunión: la **misma** cuenta para el docente (el cierre y su panel) y
 * para el control de administración (el aviso de «falta completar»). Antes el cierre no miraba las
 * evaluaciones del grupo y el control sí: el docente veía «Lista para cerrar» y le llegaba un aviso
 * de que le faltaban notas.
 *
 * En una reunión de boletín, además de R, C, juicio e informe del grupo, cuentan las evaluaciones de
 * los tramos que informa: cada alumno con alguna nota (o «no rindió») y cada evaluación del grupo
 * con nota para todos.
 */

export type AssessmentWithGrades = {
  /** `INDIVIDUAL` es una nota suelta de un alumno; sin dato, es del grupo. */
  scope?: 'GROUP' | 'INDIVIDUAL'
  grades: readonly {
    studentId: string
    valueHundredths: number | null
    scaleLevelId?: string | null
    isAbsent: boolean
  }[]
}

/** Alumnos con algo cargado en la evaluación. "No rindió" cuenta como cargado. */
export function loadedStudents(assessment: AssessmentWithGrades): Set<string> {
  return new Set(
    assessment.grades
      .filter((g) => g.isAbsent || g.valueHundredths != null || g.scaleLevelId != null)
      .map((g) => g.studentId),
  )
}

/**
 * Por alumno del roster, cuántas notas le faltan en las evaluaciones **del grupo**. Un alumno dado
 * de baja con nota no tapa a uno del grupo que no la tiene, y las notas sueltas no se cruzan: son de
 * un alumno, no de todos.
 */
export function missingAssessmentSlots(
  assessments: readonly AssessmentWithGrades[],
  rosterIds: ReadonlySet<string>,
): Map<string, number> {
  const missing = new Map<string, number>()
  for (const assessment of assessments) {
    if (assessment.scope === 'INDIVIDUAL') continue
    const loaded = loadedStudents(assessment)
    for (const studentId of rosterIds) {
      if (!loaded.has(studentId)) missing.set(studentId, (missing.get(studentId) ?? 0) + 1)
    }
  }
  return missing
}

export function countMissingAssessmentGrades(
  assessments: readonly AssessmentWithGrades[],
  rosterIds: ReadonlySet<string>,
): number {
  let total = 0
  for (const slots of missingAssessmentSlots(assessments, rosterIds).values()) total += slots
  return total
}

/**
 * Alumnos del roster sin ninguna nota en esas evaluaciones. Sólo cuenta cuando el tramo tiene nada
 * más que notas sueltas: si hay una evaluación del grupo, el alumno sin notas ya falta en ella, y
 * contarlo otra vez repetiría el mismo faltante en el aviso.
 */
export function studentsWithoutGrades(
  assessments: readonly AssessmentWithGrades[],
  rosterIds: ReadonlySet<string>,
): string[] {
  if (assessments.some((assessment) => assessment.scope !== 'INDIVIDUAL')) return []
  const graded = new Set(assessments.flatMap((assessment) => [...loadedStudents(assessment)]))
  return [...rosterIds].filter((studentId) => !graded.has(studentId))
}

export function countStudentsWithoutGrades(
  assessments: readonly AssessmentWithGrades[],
  rosterIds: ReadonlySet<string>,
): number {
  return studentsWithoutGrades(assessments, rosterIds).length
}

/** Lo que falta de las evaluaciones de los tramos, en el orden en que se avisa. */
function assessmentBlockers(assessments: readonly AssessmentWithGrades[], rosterIds: ReadonlySet<string>): ClosureBlocker[] {
  if (assessments.length === 0) return [{ code: 'NO_ASSESSMENTS', studentIds: [] }]
  const blockers: ClosureBlocker[] = []
  const withoutGrades = studentsWithoutGrades(assessments, rosterIds)
  if (withoutGrades.length > 0) blockers.push({ code: 'STUDENTS_WITHOUT_GRADES', studentIds: withoutGrades })
  const slots = missingAssessmentSlots(assessments, rosterIds)
  if (slots.size > 0) {
    blockers.push({
      code: 'MISSING_ASSESSMENT_GRADES',
      studentIds: [...slots.keys()],
      slots: [...slots.values()].reduce((acc, n) => acc + n, 0),
    })
  }
  return blockers
}

/**
 * Todo lo que impide cerrar, junto (la pantalla marca todas las filas de una vez).
 *
 * `assessments` son las evaluaciones de los tramos que informa la reunión: `undefined` cuando la
 * reunión no informa ninguno o no se cargaron (no se evalúan), y `[]` cuando se esperaban y no hay.
 * Sólo cuentan en las reuniones de boletín: una APE o un examen no piden evaluaciones.
 */
export function meetingReadiness(input: {
  rules: PeriodRules
  students: readonly StudentPeriodRow[]
  groupReport?: string | null
  assessments?: readonly AssessmentWithGrades[]
}): ClosureBlocker[] {
  const reportCard = isReportCardPeriod({
    isMeeting: input.rules.isMeeting ?? false,
    requiresGeneralGrade: input.rules.requiresGeneralGrade,
    requiresConceptualJudgement: input.rules.requiresConceptualJudgement,
  })
  const fromAssessments =
    reportCard && input.assessments !== undefined
      ? assessmentBlockers(input.assessments, new Set(input.students.map((s) => s.studentId)))
      : []
  return [...fromAssessments, ...closureBlockers(input.students, input.rules, input.groupReport)]
}
