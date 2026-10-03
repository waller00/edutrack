/**
 * Reglas de los reportes de estudiantes, sin base de datos.
 *
 * Todo se deriva al leer: las notas oficiales son las R (`officialPeriodValue`), las faltas salen
 * del pase de lista con la misma regla que la libreta (`absenceHundredthsFor`). Lo único que se
 * persiste es qué alertas ya se avisaron (`StudentAlert`).
 */

// ─── 18 y 25 faltas ─────────────────────────────────────────────────────────

/**
 * Umbrales de faltas que disparan alerta, en centésimos. El liceo avisa a las 18 y vuelve a
 * avisar a las 25: cada uno es una alerta propia.
 */
export const ABSENCE_THRESHOLDS = [1800, 2500] as const

/** Umbrales alcanzados, del menor al mayor. `1900` → `[1800]`. */
export function thresholdsReached(absenceHundredths: number): number[] {
  return ABSENCE_THRESHOLDS.filter((threshold) => absenceHundredths >= threshold)
}

/** `1800` → `"18"`: la clave de la alerta y lo que se muestra. */
export function thresholdKey(threshold: number): string {
  return String(threshold / 100)
}

// ─── Faltas seguidas ────────────────────────────────────────────────────────

/** Días seguidos que disparan la alerta. */
export const ABSENCE_STREAK_MIN_DAYS = 3

export type AbsenceStreak = {
  from: string
  to: string
  days: number
  /** La racha llega hasta el último día de clase con lista: todavía no se cortó. */
  open: boolean
}

/**
 * Rachas de días de clase seguidos con falta entera sin justificar.
 *
 * `classDays` son los días de clase del grupo (con lista tomada), ordenados: entre ellos no hay
 * fines de semana ni feriados, así que esos días no cortan la racha. Cualquier día de clase sin
 * falta entera sí la corta.
 */
export function findAbsenceStreaks(
  classDays: readonly string[],
  fullAbsenceDays: ReadonlySet<string>,
  minDays = ABSENCE_STREAK_MIN_DAYS,
): AbsenceStreak[] {
  const streaks: AbsenceStreak[] = []
  let run: string[] = []
  const close = (open: boolean) => {
    if (run.length >= minDays) streaks.push({ from: run[0], to: run[run.length - 1], days: run.length, open })
    run = []
  }
  for (const day of classDays) {
    if (fullAbsenceDays.has(day)) run.push(day)
    else close(false)
  }
  close(true)
  return streaks
}

// ─── Notas bajas ────────────────────────────────────────────────────────────

export type LowGradeBook = {
  courseOfferingId: string
  courseName: string
  orientationName: string | null
  subjectName: string
  rosterSize: number
  /** R de cada alumno del grupo que ya la tiene. */
  officialValues: readonly { studentId: string; valueHundredths: number }[]
}

export type LowGradeRow = {
  courseOfferingId: string
  courseName: string
  orientationName: string | null
  subjectName: string
  /** Alumnos con R. */
  graded: number
  /** De esos, con nota baja. */
  low: number
  /** % sobre los que tienen R, con un decimal. `null` si nadie tiene R todavía. */
  percent: number | null
  /** Alumnos del grupo todavía sin R. */
  pending: number
}

export type LowGradeCourseTotal = {
  courseOfferingId: string
  courseName: string
  /** Alumnos distintos con alguna R. */
  graded: number
  /** Alumnos distintos con al menos una materia baja. */
  low: number
  percent: number | null
}

const percentOf = (part: number, total: number) => (total === 0 ? null : Math.round((part / total) * 1000) / 10)

/** % de alumnos con nota baja por materia y curso, más el total de cada curso. */
export function summarizeLowGrades(
  books: readonly LowGradeBook[],
  isLow: (valueHundredths: number) => boolean,
): { rows: LowGradeRow[]; courses: LowGradeCourseTotal[] } {
  const rows: LowGradeRow[] = []
  const courses = new Map<string, { courseName: string; graded: Set<string>; low: Set<string> }>()
  for (const book of books) {
    const lowStudents = book.officialValues.filter((v) => isLow(v.valueHundredths))
    rows.push({
      courseOfferingId: book.courseOfferingId,
      courseName: book.courseName,
      orientationName: book.orientationName,
      subjectName: book.subjectName,
      graded: book.officialValues.length,
      low: lowStudents.length,
      percent: percentOf(lowStudents.length, book.officialValues.length),
      pending: Math.max(0, book.rosterSize - book.officialValues.length),
    })
    const course = courses.get(book.courseOfferingId) ?? { courseName: book.courseName, graded: new Set(), low: new Set() }
    for (const v of book.officialValues) course.graded.add(v.studentId)
    for (const v of lowStudents) course.low.add(v.studentId)
    courses.set(book.courseOfferingId, course)
  }
  rows.sort(
    (a, b) =>
      a.courseName.localeCompare(b.courseName, 'es') ||
      (a.orientationName ?? '').localeCompare(b.orientationName ?? '', 'es') ||
      a.subjectName.localeCompare(b.subjectName, 'es'),
  )
  return {
    rows,
    courses: [...courses]
      .map(([courseOfferingId, c]) => ({
        courseOfferingId,
        courseName: c.courseName,
        graded: c.graded.size,
        low: c.low.size,
        percent: percentOf(c.low.size, c.graded.size),
      }))
      .sort((a, b) => a.courseName.localeCompare(b.courseName, 'es')),
  }
}

// ─── Bajó de boletín ────────────────────────────────────────────────────────

export type GradeDropInput = {
  studentId: string
  subjectId: string
  previous: number | null
  current: number | null
}

/** Materias en las que la R del boletín es menor que la del anterior. Sin alguna de las dos, no. */
export function isGradeDrop(entry: Pick<GradeDropInput, 'previous' | 'current'>): boolean {
  return entry.previous != null && entry.current != null && entry.current < entry.previous
}
