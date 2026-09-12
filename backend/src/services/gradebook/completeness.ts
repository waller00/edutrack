/**
 * Qué le falta a cada libreta en un período, para el control de adscripción.
 *
 * El liceo lo describió así: adscripción entra, mira que estén las notas y las inasistencias, y si
 * falta algo le avisa al docente. Hasta ahora `closureBlockers` respondía esa pregunta **de a una
 * libreta por vez**, y sólo llegando por la ruta del docente; no había forma de ver el centro
 * entero ni de saber a quién reclamarle.
 */

export type GradeBookCompleteness = {
  gradeBookId: string
  subjectName: string
  courseName: string
  teacherUserId: string | null
  teacherName: string | null
  periodStatus: 'OPEN' | 'CLOSED' | 'REOPENED' | null
  rosterSize: number
  /** Estudiantes con calificación general del período. */
  gradedCount: number
  /** Estudiantes con juicio conceptual, cuando el período lo exige. */
  judgedCount: number
  requiresJudgement: boolean
}

export type CompletenessSummary = GradeBookCompleteness & {
  missingGrades: number
  missingJudgements: number
  /** ¿Está lista para cerrar? Cerrada también cuenta como completa. */
  complete: boolean
}

export function summarize(row: GradeBookCompleteness): CompletenessSummary {
  const missingGrades = Math.max(0, row.rosterSize - row.gradedCount)
  // El juicio sólo falta si el período lo exige: en los que no, no es una omisión.
  const missingJudgements = row.requiresJudgement ? Math.max(0, row.rosterSize - row.judgedCount) : 0
  return {
    ...row,
    missingGrades,
    missingJudgements,
    complete: row.periodStatus === 'CLOSED' || (missingGrades === 0 && missingJudgements === 0),
  }
}

/** Primero lo que más falta: es el orden en que adscripción va a reclamar. */
export function sortByUrgency(rows: readonly CompletenessSummary[]): CompletenessSummary[] {
  return [...rows].sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? 1 : -1
    const missingA = a.missingGrades + a.missingJudgements
    const missingB = b.missingGrades + b.missingJudgements
    if (missingA !== missingB) return missingB - missingA
    return a.subjectName.localeCompare(b.subjectName, 'es')
  })
}

/** Texto del aviso que le llega al docente. Dice qué falta, no "revisá tu libreta". */
export function completionRequestBody(row: CompletenessSummary, periodName: string): string {
  const faltantes: string[] = []
  if (row.missingGrades > 0) {
    faltantes.push(`${row.missingGrades} sin calificación`)
  }
  if (row.missingJudgements > 0) {
    faltantes.push(`${row.missingJudgements} sin juicio conceptual`)
  }
  if (faltantes.length === 0) return `${periodName}: la libreta está completa.`
  return `${periodName}: ${faltantes.join(' y ')}.`
}
