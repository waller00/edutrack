/**
 * Qué pasó con las materias que los estudiantes quedaron debiendo al cerrar el año: si las salvaron
 * en la APE de diciembre, en la de febrero, más tarde como previa (en general en el período de
 * julio), o si todavía las deben. Más quiénes, en el ciclo que se mira, deben materias de años
 * anteriores.
 */

export type ApeOutcome = 'DECEMBER' | 'FEBRUARY' | 'PREVIA' | 'OWED'

export type PendingRow = {
  studentId: string
  subjectId: string
  subjectName: string
  apeDecember: string | null
  apeFebruary: string | null
  resolvedAt: Date | null
}

export function apeOutcome(row: Pick<PendingRow, 'apeDecember' | 'apeFebruary' | 'resolvedAt'>): ApeOutcome {
  if (row.apeDecember === 'PASSED') return 'DECEMBER'
  if (row.apeFebruary === 'PASSED') return 'FEBRUARY'
  if (row.resolvedAt) return 'PREVIA'
  return 'OWED'
}

type ApeResults = { apeDecember?: string | null; apeFebruary?: string | null }

const passedApe = (row: ApeResults) => row.apeDecember === 'PASSED' || row.apeFebruary === 'PASSED'

/**
 * La fecha en que se salvó una materia al editarla. `undefined` es "dejarla como está": cambiar una
 * nota o la observación no puede borrar que la salvó como previa en julio, porque `apeOutcome` la
 * cuenta por esa fecha. Aprobar una APE conserva la fecha que ya tenía; deshacer ese aprobado la
 * vuelve a abrir. `passedAsPrevia` la marca salvada (o la reabre) a propósito.
 */
export function pendingResolvedAt(
  input: ApeResults & { passedAsPrevia?: boolean },
  current: (ApeResults & { resolvedAt: Date | null }) | null,
  now: Date,
): Date | null | undefined {
  if (input.passedAsPrevia === false) return null
  if (input.passedAsPrevia === true || passedApe(input)) return current?.resolvedAt ?? now
  if (!current) return null
  return passedApe(current) ? null : undefined
}

export type OutcomeCounts = { referred: number; december: number; february: number; previa: number; owed: number }

const emptyOutcomes = (): OutcomeCounts => ({ referred: 0, december: 0, february: 0, previa: 0, owed: 0 })

const OUTCOME_KEY: Record<ApeOutcome, keyof Omit<OutcomeCounts, 'referred'>> = {
  DECEMBER: 'december',
  FEBRUARY: 'february',
  PREVIA: 'previa',
  OWED: 'owed',
}

function addOutcome(counts: OutcomeCounts, outcome: ApeOutcome): void {
  counts.referred++
  counts[OUTCOME_KEY[outcome]]++
}

export type ApeCourse = { courseId: string; courseName: string; position: number }

export type SubjectsApe = {
  students: { referred: number; clearedByFebruary: number; clearedLater: number; stillOwing: number }
  byCourse: (ApeCourse & OutcomeCounts & { studentsReferred: number })[]
  rows: (ApeCourse & OutcomeCounts & { subjectId: string; subjectName: string })[]
}

type StudentSummary = { byFebruary: boolean; later: boolean; owing: boolean }

/** Cada estudiante se cuenta una vez: salvó todo antes de marzo, lo salvó después, o sigue debiendo. */
function summarizeStudents(rows: readonly PendingRow[]): SubjectsApe['students'] {
  const byStudent = new Map<string, StudentSummary>()
  for (const row of rows) {
    const outcome = apeOutcome(row)
    const summary = byStudent.get(row.studentId) ?? { byFebruary: true, later: false, owing: false }
    if (outcome === 'PREVIA') {
      summary.byFebruary = false
      summary.later = true
    }
    if (outcome === 'OWED') {
      summary.byFebruary = false
      summary.owing = true
    }
    byStudent.set(row.studentId, summary)
  }
  const students = { referred: byStudent.size, clearedByFebruary: 0, clearedLater: 0, stillOwing: 0 }
  for (const summary of byStudent.values()) {
    if (summary.owing) students.stillOwing++
    else if (summary.later) students.clearedLater++
    else students.clearedByFebruary++
  }
  return students
}

/**
 * `courseOf` dice en qué curso estaba cada estudiante el año en que perdió la materia: las materias
 * de 7.º se cuentan en 7.º aunque el alumno ya esté en 8.º.
 */
export function summarizeApe(rows: readonly PendingRow[], courseOf: ReadonlyMap<string, ApeCourse>): SubjectsApe {
  const byCourse = new Map<string, OutcomeCounts & { students: Set<string> }>()
  const bySubject = new Map<string, OutcomeCounts & { subjectId: string; subjectName: string; courseId: string }>()
  for (const row of rows) {
    const course = courseOf.get(row.studentId)
    if (!course) continue
    const outcome = apeOutcome(row)
    const courseCounts = byCourse.get(course.courseId) ?? { ...emptyOutcomes(), students: new Set<string>() }
    addOutcome(courseCounts, outcome)
    courseCounts.students.add(row.studentId)
    byCourse.set(course.courseId, courseCounts)
    const key = `${course.courseId}|${row.subjectId}`
    const subjectCounts = bySubject.get(key) ?? { ...emptyOutcomes(), subjectId: row.subjectId, subjectName: row.subjectName, courseId: course.courseId }
    addOutcome(subjectCounts, outcome)
    bySubject.set(key, subjectCounts)
  }
  const courses = new Map([...courseOf.values()].map((course) => [course.courseId, course]))
  const byPosition = (a: { position: number; courseName: string }, b: { position: number; courseName: string }) =>
    a.position - b.position || a.courseName.localeCompare(b.courseName, 'es')
  return {
    students: summarizeStudents(rows.filter((row) => courseOf.has(row.studentId))),
    byCourse: [...byCourse]
      .map(([courseId, { students, ...counts }]) => ({ ...courses.get(courseId)!, ...counts, studentsReferred: students.size }))
      .sort(byPosition),
    rows: [...bySubject.values()]
      .map(({ courseId, ...counts }) => ({ ...courses.get(courseId)!, ...counts }))
      .sort((a, b) => byPosition(a, b) || b.referred - a.referred || a.subjectName.localeCompare(b.subjectName, 'es')),
  }
}

/** El ciclo cuyas APE se miran: el pedido si ya tiene materias perdidas; si no, el último anterior que sí. */
export function apeFocusYear<T extends { id: string; code: number }>(
  years: readonly T[],
  requestedId: string,
  failedByYear: ReadonlyMap<string, number>,
): T | null {
  const requested = years.find((year) => year.id === requestedId)
  if (requested && (failedByYear.get(requested.id) ?? 0) > 0) return requested
  const earlier = years
    .filter((year) => (!requested || year.code < requested.code) && (failedByYear.get(year.id) ?? 0) > 0)
    .sort((a, b) => b.code - a.code)
  return earlier[0] ?? null
}
