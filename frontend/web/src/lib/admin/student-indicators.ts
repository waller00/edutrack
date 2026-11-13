import { formatAbsenceUnits } from '@/lib/libreta/absences'

/**
 * Lo que dibuja Indicadores de estudiantes, derivado de lo que devuelven los endpoints. El backend
 * da conteos; los porcentajes y las filas de las gráficas salen de acá, con tests.
 */

export type AttendanceStudent = {
  studentId: string
  firstName: string
  lastName: string
  courseName: string
}

export type AbsenceStreak = AttendanceStudent & {
  from: string
  to: string
  days: number
  open: boolean
}
export type AbsenceThreshold = AttendanceStudent & { absenceHundredths: number; threshold: number }

export type YearRef = { id: string; code: number; label: string; status: string }

/** Una parte de un total, para las barras segmentadas y su lista. */
export type Part = { key: string; label: string; value: number; color: string; alert?: boolean }

/** Paleta validada de las gráficas: categórica en orden fijo, y un gris para "sin dato". */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'] as const
export const NO_DATA_COLOR = '#cbd5e1'
/** Rampa ordinal (de menos a más) en un solo tono. */
export const ORDINAL_COLORS = ['#86b6ef', '#5598e7', '#256abf', '#104281'] as const
export const ACCENT_COLOR = SERIES_COLORS[0]
export const CONTEXT_COLOR = '#94a3b8'

export function matchesStudent(student: AttendanceStudent, search: string): boolean {
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
  const text = normalize(`${student.lastName} ${student.firstName} ${student.courseName}`)
  return normalize(search)
    .trim()
    .split(/\s+/)
    .every((word) => text.includes(word))
}

// ─── Asistencia en el tiempo ────────────────────────────────────────────────

export type DayCounts = { studentDays: number; absentDays: number; justifiedDays: number; lateDays: number }
export type MonthCounts = DayCounts & { month: string }
export type CourseTrend = {
  courseOfferingId: string
  courseName: string
  level: string | null
  months: MonthCounts[]
  total: DayCounts
}
export type AttendanceTrendResponse = {
  schoolYear: YearRef | null
  months: string[]
  byCourse: CourseTrend[]
  total: DayCounts & { months: MonthCounts[] }
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre']

/** `2026-03` → «marzo». */
export function monthName(month: string): string {
  return MONTHS[Number(month.slice(5, 7)) - 1] ?? month
}

/** `2026-03` → «Mar». */
export function monthLabel(month: string): string {
  const name = monthName(month)
  return name === month ? month : `${name.charAt(0).toUpperCase()}${name.slice(1, 3)}`
}

/** Días en que vino: los días con lista menos los días con falta (llegar tarde es que vino). */
export const presentDays = (counts: DayCounts) => counts.studentDays - counts.absentDays

const rate = (counts: DayCounts | undefined) =>
  counts && counts.studentDays > 0 ? (presentDays(counts) / counts.studentDays) * 100 : null

export type TrendPoint = {
  month: string
  label: string
  /** Asistencia de todo el liceo ese mes (0 a 100), o null sin listas. */
  liceo: number | null
  /** La del curso elegido, si hay uno. */
  course: number | null
  unjustified: number
  justified: number
  studentDays: number
}

/** Una fila por mes para las gráficas; con un curso elegido, también su línea. */
export function attendanceTrendPoints(trend: AttendanceTrendResponse, courseOfferingId?: string | null): TrendPoint[] {
  const course = courseOfferingId ? trend.byCourse.find((row) => row.courseOfferingId === courseOfferingId) : undefined
  return trend.total.months.map((counts) => ({
    month: counts.month,
    label: monthLabel(counts.month),
    liceo: rate(counts),
    course: course ? rate(course.months.find((row) => row.month === counts.month)) : null,
    unjustified: counts.absentDays - counts.justifiedDays,
    justified: counts.justifiedDays,
    studentDays: counts.studentDays,
  }))
}

// ─── Notas bajas por curso y asignatura ─────────────────────────────────────

export type LowGradeRow = {
  courseOfferingId: string
  courseName: string
  orientationName: string | null
  subjectName: string
  graded: number
  low: number
  percent: number | null
  pending: number
}
export type LowGradeCourse = { courseOfferingId: string; courseName: string; graded: number; low: number; percent: number | null }
export type LowGradesResponse = { period: { id?: string; name: string; level?: string | null }; rows: LowGradeRow[]; courses: LowGradeCourse[] }

export type CourseRanking = LowGradeCourse & { subjects: LowGradeRow[]; hidden: number }

const lowShare = (row: Pick<LowGradeRow, 'low' | 'graded'>) => (row.graded > 0 ? row.low / row.graded : -1)

/**
 * Por curso, las asignaturas con más notas bajas en el boletín: primero la mayor proporción, a
 * igual proporción la que más alumnos tiene. Las que no tienen ninguna baja no entran.
 */
export function subjectRanking(data: Pick<LowGradesResponse, 'rows' | 'courses'>, perCourse = 5): CourseRanking[] {
  return data.courses.map((course) => {
    const subjects = data.rows
      .filter((row) => row.courseOfferingId === course.courseOfferingId && row.low > 0)
      .sort((a, b) => lowShare(b) - lowShare(a) || b.low - a.low || a.subjectName.localeCompare(b.subjectName, 'es'))
    return { ...course, subjects: subjects.slice(0, perCourse), hidden: Math.max(0, subjects.length - perCourse) }
  })
}

// ─── Quién necesita atención ────────────────────────────────────────────────

export type RiskReason = 'GRADES' | 'ABSENCES' | 'STREAK' | 'CARRIED'
export type RiskFamily = 'NOTAS' | 'FALTAS'

export type RiskRow = AttendanceStudent & {
  level: string | null
  grades: { lowSubjects: number; subjects: string[]; periodName: string } | null
  absenceHundredths: number
  absenceThreshold: number | null
  streak: { days: number; from: string } | null
  carried: number
  reasons: RiskReason[]
  families: RiskFamily[]
}

export type RiskResponse = {
  schoolYear: YearRef | null
  enrolled: number
  threshold: number | null
  references: { level: string | null; period: { id: string; name: string } | null }[]
  counts: { students: number; grades: number; absences: number; both: number }
  rows: RiskRow[]
}

export type RiskMotive = '' | 'notas' | 'faltas' | 'ambos'

export function parseMotive(value: string | null | undefined): RiskMotive {
  return value === 'notas' || value === 'faltas' || value === 'ambos' ? value : ''
}

function matchesMotive(row: RiskRow, motive: RiskMotive): boolean {
  if (motive === 'notas') return row.families.includes('NOTAS')
  if (motive === 'faltas') return row.families.includes('FALTAS')
  if (motive === 'ambos') return row.families.length === 2
  return true
}

export function filterRisk(rows: readonly RiskRow[], filters: { search: string; course: string; motive: RiskMotive }): RiskRow[] {
  return rows.filter(
    (row) => (!filters.course || row.courseName === filters.course) && matchesMotive(row, filters.motive) && matchesStudent(row, filters.search),
  )
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

/** "Matemática", "Matemática y Física", "Matemática, Física y Biología". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

export type ReasonText = { reason: RiskReason; family: RiskFamily; text: string }

/** Cada motivo dicho con su número, para que el chip no dependa del color (RNF 7.2). */
export function riskReasons(row: RiskRow): ReasonText[] {
  return row.reasons.map((reason) => {
    switch (reason) {
      case 'GRADES': {
        const count = row.grades?.lowSubjects ?? 0
        // Cuáles, no sólo cuántas: es lo que se mira para citar al alumno o hablar con el docente.
        // Con raya y no entre paréntesis: el nombre del boletín ya trae los suyos ("(3.ª Reunión)").
        const subjects = row.grades?.subjects ?? []
        return {
          reason,
          family: 'NOTAS',
          text: `Notas: ${count} ${plural(count, 'materia baja', 'materias bajas')} en ${row.grades?.periodName ?? 'el boletín'}${
            subjects.length > 0 ? ` — ${joinNames(subjects)}` : ''
          }`,
        }
      }
      case 'CARRIED':
        return {
          reason,
          family: 'NOTAS',
          text: `Debe ${row.carried} ${plural(row.carried, 'materia', 'materias')} de años anteriores`,
        }
      case 'ABSENCES':
        return {
          reason,
          family: 'FALTAS',
          text: `Faltas: ${formatAbsenceUnits(row.absenceHundredths)} en el año (pasó las ${(row.absenceThreshold ?? 1800) / 100})`,
        }
      default:
        return {
          reason,
          family: 'FALTAS',
          text: `Faltas seguidas: ${row.streak?.days ?? 0} días, sigue faltando`,
        }
    }
  })
}

// ─── Rendimiento ────────────────────────────────────────────────────────────

export type LowSubjectsHistogram = { graded: number; none: number; one: number; two: number; threeOrMore: number }

/**
 * Estudiantes según cuántas materias tienen bajas en el boletín. `threshold` es la regla
 * "Asignaturas en alerta" del ciclo: desde ahí la reunión los marca en riesgo.
 */
export function lowSubjectsParts(histogram: LowSubjectsHistogram, threshold: number | null): Part[] {
  const atRisk = (count: number) => threshold !== null && count >= threshold
  return [
    { key: 'none', label: 'Ninguna', value: histogram.none, color: ORDINAL_COLORS[0] },
    { key: 'one', label: '1 materia', value: histogram.one, color: ORDINAL_COLORS[1], alert: atRisk(1) },
    { key: 'two', label: '2 materias', value: histogram.two, color: ORDINAL_COLORS[2], alert: atRisk(2) },
    { key: 'threeOrMore', label: '3 o más', value: histogram.threeOrMore, color: ORDINAL_COLORS[3], alert: atRisk(3) },
  ]
}

export type StudentsEvolution = { total: number; improved: number; declined: number; compared: number }

/** Cómo les fue desde el primer boletín: sólo se comparan quienes tienen dos o más con nota. */
export function evolutionParts(students: StudentsEvolution): Part[] {
  return [
    { key: 'improved', label: 'Subieron', value: students.improved, color: SERIES_COLORS[0] },
    { key: 'same', label: 'Igual', value: Math.max(0, students.compared - students.improved - students.declined), color: SERIES_COLORS[2] },
    { key: 'declined', label: 'Bajaron', value: students.declined, color: SERIES_COLORS[1] },
    { key: 'none', label: 'Sin comparación', value: Math.max(0, students.total - students.compared), color: NO_DATA_COLOR },
  ]
}

/** La regla "Asignaturas en alerta" de las que devuelve el tablero; `null` si está apagada. */
export function alertSubjectsRule(rules: readonly { type: string; threshold: number }[] | undefined): number | null {
  return rules?.find((rule) => rule.type === 'ALERT_SUBJECTS')?.threshold ?? null
}
