/**
 * Qué le falta a cada libreta antes de una reunión de boletín, para el control de administración.
 *
 * El liceo lo describió así: antes de cada reunión general (cada ~2 meses) administración revisa
 * que cada docente haya cargado todo, y si no, le avisa por dentro del sistema. "Todo" es:
 *
 * - las **evaluaciones** de los tramos que informa la reunión, con nota para cada alumno;
 * - la **calificación del período (C)**, si el período la pide;
 * - el **juicio conceptual**, si el período lo pide.
 *
 * La **R no cuenta**: se pone en la reunión misma, así que antes no puede estar. Se informa sólo
 * para ver qué reuniones ya se cerraron.
 */

export type GradeBookCompleteness = {
  gradeBookId: string
  subjectName: string
  courseName: string
  teacherUserId: string | null
  teacherName: string | null
  periodStatus: 'OPEN' | 'CLOSED' | 'REOPENED' | null
  rosterSize: number
  /** Alumnos **del roster** con calificación (C) del período. */
  gradedCount: number
  /** ¿El período pide C? Las APE, por ejemplo, no. */
  requiresGrade: boolean
  /** Alumnos del roster con juicio conceptual. */
  judgedCount: number
  requiresJudgement: boolean
  /** Alumnos del roster con R. Informativo: la R se pone en la reunión. */
  meetingGradedCount: number
  /** ¿La reunión informa tramos con evaluaciones? Un diagnóstico, por ejemplo, no. */
  expectsAssessments: boolean
  /** Evaluaciones (no borradas) de esos tramos. */
  assessmentCount: number
  /** Notas de evaluación sin cargar: por cada evaluación, alumnos del roster sin nota ni "no rindió". */
  missingAssessmentGrades: number
}

export type CompletenessSummary = GradeBookCompleteness & {
  missingGrades: number
  missingJudgements: number
  /** Se esperaban evaluaciones y no hay ninguna. */
  hasNoAssessments: boolean
  /** ¿Está lista para la reunión? Cerrada también cuenta como completa. */
  complete: boolean
}

export type AssessmentWithGrades = {
  grades: readonly {
    studentId: string
    valueHundredths: number | null
    scaleLevelId?: string | null
    isAbsent: boolean
  }[]
}

/**
 * Notas de evaluación que faltan, cruzando contra el roster: un alumno dado de baja con nota no
 * tapa a uno del grupo que no la tiene. "No rindió" cuenta como cargado.
 */
export function countMissingAssessmentGrades(
  assessments: readonly AssessmentWithGrades[],
  rosterIds: ReadonlySet<string>,
): number {
  let missing = 0
  for (const assessment of assessments) {
    const loaded = new Set(
      assessment.grades
        .filter((g) => g.isAbsent || g.valueHundredths != null || g.scaleLevelId != null)
        .map((g) => g.studentId),
    )
    for (const studentId of rosterIds) if (!loaded.has(studentId)) missing += 1
  }
  return missing
}

export function summarize(row: GradeBookCompleteness): CompletenessSummary {
  const missingGrades = row.requiresGrade ? Math.max(0, row.rosterSize - row.gradedCount) : 0
  // El juicio sólo falta si el período lo exige: en los que no, no es una omisión.
  const missingJudgements = row.requiresJudgement ? Math.max(0, row.rosterSize - row.judgedCount) : 0
  const hasNoAssessments = row.expectsAssessments && row.assessmentCount === 0
  const missingAssessments = row.expectsAssessments ? row.missingAssessmentGrades : 0
  return {
    ...row,
    missingGrades,
    missingJudgements,
    missingAssessmentGrades: missingAssessments,
    hasNoAssessments,
    complete:
      row.periodStatus === 'CLOSED' ||
      (missingGrades === 0 && missingJudgements === 0 && missingAssessments === 0 && !hasNoAssessments),
  }
}

function pendingCount(row: CompletenessSummary): number {
  return row.missingGrades + row.missingJudgements + row.missingAssessmentGrades + (row.hasNoAssessments ? 1 : 0)
}

/** Primero lo que más falta: es el orden en que administración va a reclamar. */
export function sortByUrgency(rows: readonly CompletenessSummary[]): CompletenessSummary[] {
  return [...rows].sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? 1 : -1
    const missingA = pendingCount(a)
    const missingB = pendingCount(b)
    if (missingA !== missingB) return missingB - missingA
    return a.subjectName.localeCompare(b.subjectName, 'es')
  })
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

/** Texto del aviso que le llega al docente. Dice qué falta, no "revisá tu libreta". */
export function completionRequestBody(row: CompletenessSummary, periodName: string): string {
  const faltantes: string[] = []
  if (row.hasNoAssessments) {
    faltantes.push('no hay evaluaciones cargadas')
  } else if (row.missingAssessmentGrades > 0) {
    faltantes.push(plural(row.missingAssessmentGrades, 'nota de evaluación sin cargar', 'notas de evaluación sin cargar'))
  }
  if (row.missingGrades > 0) {
    faltantes.push(`${row.missingGrades} sin calificación del período`)
  }
  if (row.missingJudgements > 0) {
    faltantes.push(`${row.missingJudgements} sin juicio conceptual`)
  }
  if (faltantes.length === 0) return `${periodName}: la libreta está completa.`
  const list = faltantes.length > 1 ? `${faltantes.slice(0, -1).join(', ')} y ${faltantes.at(-1)}` : faltantes[0]
  return `${periodName}: ${list}.`
}
