/**
 * Qué le falta a cada libreta antes de una reunión de boletín, para el control de administración.
 *
 * El liceo lo describió así: antes de cada reunión general (cada ~2 meses) administración revisa
 * que cada docente haya cargado todo, y si no, le avisa por dentro del sistema. "Todo" es:
 *
 * - las **notas** de los tramos que informa la reunión: cada alumno con al menos una (suelta o de
 *   una evaluación del grupo, o "no rindió"), y cada evaluación **del grupo** con nota para todos.
 *   Una nota suelta es de un alumno: cruzarla contra el grupo entero marcaba atrasado a un docente
 *   que cargaba desde la carta, con "29 notas sin cargar" por cada nota;
 * - el **rendimiento del período (R)**, si el período lo pide, y la **conducta (C)** si además es
 *   reunión;
 * - el **juicio conceptual**, si el período lo pide;
 * - el **informe general del grupo**, en las reuniones de boletín.
 *
 * Después de la reunión sólo queda cerrar el período.
 */

export type GradeBookCompleteness = {
  gradeBookId: string
  subjectName: string
  courseName: string
  /** Orientación del grupo: sin ella, dos libretas "5.º · Matemática" se ven iguales. */
  orientationName?: string | null
  teacherUserId: string | null
  teacherName: string | null
  periodStatus: 'OPEN' | 'CLOSED' | 'REOPENED' | null
  rosterSize: number
  /** Alumnos **del roster** con rendimiento (R) del período. */
  gradedCount: number
  /** ¿El período pide R? Las APE, por ejemplo, no. */
  requiresGrade: boolean
  /** Alumnos del roster con juicio conceptual. */
  judgedCount: number
  requiresJudgement: boolean
  /** Alumnos del roster con conducta (C). */
  conductCount: number
  /** ¿Pide conducta? La piden las reuniones que piden rendimiento. */
  requiresConduct?: boolean
  /** ¿Hay informe general del grupo? */
  hasGroupReport?: boolean
  /** ¿Lo pide? Sólo las reuniones de boletín. */
  requiresGroupReport?: boolean
  /** ¿La reunión informa tramos con evaluaciones? Un diagnóstico, por ejemplo, no. */
  expectsAssessments: boolean
  /** Evaluaciones (no borradas) de esos tramos. */
  assessmentCount: number
  /** Notas sin cargar: por cada evaluación **del grupo**, alumnos del roster sin nota ni "no rindió". */
  missingAssessmentGrades: number
  /** Alumnos del roster sin ninguna nota en esos tramos, sueltas incluidas. */
  studentsWithoutGrades?: number
  /** Último aviso al docente por esta reunión, en cada etapa (ISO). */
  lastRequestedAt?: { before: string | null; after: string | null }
}

export type CompletenessSummary = GradeBookCompleteness & {
  studentsWithoutGrades: number
  missingGrades: number
  missingJudgements: number
  /** Alumnos sin conducta (C), si el período la pide. */
  missingConduct: number
  /** Falta el informe general del grupo y el período lo pide. */
  missingGroupReport: boolean
  /** Después de la reunión: la libreta ya cerró el período. */
  closed: boolean
  /** Se esperaban evaluaciones y no hay ninguna. */
  hasNoAssessments: boolean
  /** ¿Está lista para la reunión? Cerrada también cuenta como completa. */
  complete: boolean
}

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
function loadedStudents(assessment: AssessmentWithGrades): Set<string> {
  return new Set(
    assessment.grades
      .filter((g) => g.isAbsent || g.valueHundredths != null || g.scaleLevelId != null)
      .map((g) => g.studentId),
  )
}

/**
 * Notas que faltan en las evaluaciones **del grupo**, cruzando contra el roster: un alumno dado de
 * baja con nota no tapa a uno del grupo que no la tiene. Las notas sueltas no se cruzan: son de
 * un alumno, no de todos.
 */
export function countMissingAssessmentGrades(
  assessments: readonly AssessmentWithGrades[],
  rosterIds: ReadonlySet<string>,
): number {
  let missing = 0
  for (const assessment of assessments) {
    if (assessment.scope === 'INDIVIDUAL') continue
    const loaded = loadedStudents(assessment)
    for (const studentId of rosterIds) if (!loaded.has(studentId)) missing += 1
  }
  return missing
}

/**
 * Alumnos del roster sin ninguna nota en esas evaluaciones. Sólo cuenta cuando el tramo tiene
 * nada más que notas sueltas: si hay una evaluación del grupo, el alumno sin notas ya falta en
 * ella, y contarlo otra vez repetiría el mismo faltante en el aviso.
 */
export function countStudentsWithoutGrades(
  assessments: readonly AssessmentWithGrades[],
  rosterIds: ReadonlySet<string>,
): number {
  if (assessments.some((assessment) => assessment.scope !== 'INDIVIDUAL')) return 0
  const graded = new Set(assessments.flatMap((assessment) => [...loadedStudents(assessment)]))
  let missing = 0
  for (const studentId of rosterIds) if (!graded.has(studentId)) missing += 1
  return missing
}

export function summarize(row: GradeBookCompleteness): CompletenessSummary {
  const missingGrades = row.requiresGrade ? Math.max(0, row.rosterSize - row.gradedCount) : 0
  // El juicio sólo falta si el período lo exige: en los que no, no es una omisión.
  const missingJudgements = row.requiresJudgement ? Math.max(0, row.rosterSize - row.judgedCount) : 0
  const hasNoAssessments = row.expectsAssessments && row.assessmentCount === 0
  const missingAssessments = row.expectsAssessments ? row.missingAssessmentGrades : 0
  // Sin evaluaciones ya se avisa eso; contar a todos los alumnos además repetiría lo mismo.
  const studentsWithoutGrades = row.expectsAssessments && !hasNoAssessments ? row.studentsWithoutGrades ?? 0 : 0
  const missingConduct = row.requiresConduct ? Math.max(0, row.rosterSize - row.conductCount) : 0
  const missingGroupReport = Boolean(row.requiresGroupReport && !row.hasGroupReport)
  return {
    ...row,
    missingGrades,
    missingJudgements,
    missingConduct,
    missingGroupReport,
    closed: row.periodStatus === 'CLOSED',
    missingAssessmentGrades: missingAssessments,
    studentsWithoutGrades,
    hasNoAssessments,
    complete:
      row.periodStatus === 'CLOSED' ||
      (missingGrades === 0 &&
        missingJudgements === 0 &&
        missingConduct === 0 &&
        !missingGroupReport &&
        missingAssessments === 0 &&
        studentsWithoutGrades === 0 &&
        !hasNoAssessments),
  }
}

function pendingCount(row: CompletenessSummary): number {
  return (
    row.missingGrades +
    row.missingJudgements +
    row.missingConduct +
    (row.missingGroupReport ? 1 : 0) +
    row.missingAssessmentGrades +
    row.studentsWithoutGrades +
    (row.hasNoAssessments ? 1 : 0)
  )
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

/**
 * Las dos etapas del control. **Antes** de la reunión se mira lo que el docente lleva (evaluaciones,
 * R, C, juicio e informe del grupo); **después**, que haya cerrado el período.
 */
export type CompletenessStage = 'before' | 'after'

export function isStageComplete(row: CompletenessSummary, stage: CompletenessStage): boolean {
  return stage === 'after' ? row.closed : row.complete
}

function joinParts(parts: readonly string[]): string {
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}` : parts[0]
}

/** Qué le falta antes de la reunión, en partes: "no hay evaluaciones", "3 sin juicio conceptual". */
export function missingBeforeMeeting(row: CompletenessSummary): string[] {
  const faltantes: string[] = []
  if (row.hasNoAssessments) {
    faltantes.push('no hay evaluaciones cargadas')
  } else {
    if (row.studentsWithoutGrades > 0) {
      faltantes.push(plural(row.studentsWithoutGrades, 'alumno sin notas en el tramo', 'alumnos sin notas en el tramo'))
    }
    if (row.missingAssessmentGrades > 0) {
      faltantes.push(plural(row.missingAssessmentGrades, 'nota de evaluación sin cargar', 'notas de evaluación sin cargar'))
    }
  }
  if (row.missingGrades > 0) {
    faltantes.push(`${row.missingGrades} sin rendimiento (R)`)
  }
  if (row.missingConduct > 0) {
    faltantes.push(`${row.missingConduct} sin conducta (C)`)
  }
  if (row.missingJudgements > 0) {
    faltantes.push(`${row.missingJudgements} sin juicio conceptual`)
  }
  if (row.missingGroupReport) {
    faltantes.push('falta el informe del grupo')
  }
  return faltantes
}

/** Qué le falta después de la reunión: cerrar el período. */
export function missingAfterMeeting(row: CompletenessSummary): string[] {
  return row.closed ? [] : ['falta cerrar el período']
}

/** Lo que falta en la etapa, sin el nombre del período: va dentro de un aviso que agrupa libretas. */
export function stageDetail(row: CompletenessSummary, stage: CompletenessStage): string {
  const parts = stage === 'after' ? missingAfterMeeting(row) : missingBeforeMeeting(row)
  if (parts.length === 0) return stage === 'after' ? 'la libreta está cerrada' : 'la libreta está completa'
  return joinParts(parts)
}

/** Texto del aviso que le llega al docente. Dice qué falta, no "revisá tu libreta". */
export function completionRequestBody(row: CompletenessSummary, periodName: string, stage: CompletenessStage = 'before'): string {
  return `${periodName}: ${stageDetail(row, stage)}.`
}
