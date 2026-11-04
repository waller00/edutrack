import { absenceCounts, countsByDay } from '../student-attendance/absence-weight.js'

/**
 * Asistencia de los estudiantes en el tiempo: por mes y por curso.
 *
 * Se cuenta **por día**, igual que el boletín: en ciclo básico y bachillerato faltar a una clase es
 * faltar el día, y el día va a la columna de su peor marca (`absenceCounts`). Llegar tarde es que
 * vino. Un "día con lista" es un día en que el alumno figura en alguna lista pasada de su grupo. En
 * un curso sin nivel se cuenta por clase, como hace él con sus faltas.
 */

export type TrendMark = { studentId: string; courseOfferingId: string | null; ymd: string; status: string }

export type TrendCourse = { courseOfferingId: string; courseName: string; level: string | null }

export type DayCounts = {
  /** Días con lista (en un curso sin nivel, clases con lista). */
  studentDays: number
  /** Días con falta: sin justificar más justificadas. */
  absentDays: number
  justifiedDays: number
  /** Días cuya peor marca fue llegar tarde. */
  lateDays: number
}

export type MonthCounts = DayCounts & { month: string }

export type CourseTrend = TrendCourse & { months: MonthCounts[]; total: DayCounts }

export type AttendanceTrend = {
  months: string[]
  byCourse: CourseTrend[]
  total: DayCounts & { months: MonthCounts[] }
}

const emptyCounts = (): DayCounts => ({ studentDays: 0, absentDays: 0, justifiedDays: 0, lateDays: 0 })

function addCounts(target: DayCounts, source: DayCounts): void {
  target.studentDays += source.studentDays
  target.absentDays += source.absentDays
  target.justifiedDays += source.justifiedDays
  target.lateDays += source.lateDays
}

/** Las marcas de un alumno en un mes, contadas con la regla de su nivel. */
function countStudentMonth(marks: readonly TrendMark[], level: string | null): DayCounts {
  const entries = marks.map((mark) => ({ status: mark.status, absenceWeightHundredths: null, ymd: mark.ymd }))
  const counts = absenceCounts(entries, level)
  const studentDays = countsByDay(level) ? new Set(marks.map((mark) => mark.ymd)).size : marks.length
  return {
    studentDays,
    absentDays: counts.unjustified + counts.justified,
    justifiedDays: counts.justified,
    lateDays: counts.lates,
  }
}

function monthTable(byMonth: ReadonlyMap<string, DayCounts>, months: readonly string[]): MonthCounts[] {
  return months.map((month) => ({ month, ...(byMonth.get(month) ?? emptyCounts()) }))
}

export function attendanceTrend(marks: readonly TrendMark[], courses: readonly TrendCourse[]): AttendanceTrend {
  const courseById = new Map(courses.map((course) => [course.courseOfferingId, course]))
  // Alumno + curso + mes: la unidad sobre la que se aplica la regla del día.
  const groups = new Map<string, TrendMark[]>()
  for (const mark of marks) {
    if (!mark.courseOfferingId || !courseById.has(mark.courseOfferingId)) continue
    const key = `${mark.courseOfferingId}|${mark.studentId}|${mark.ymd.slice(0, 7)}`
    const list = groups.get(key)
    if (list) list.push(mark)
    else groups.set(key, [mark])
  }

  const perCourseMonth = new Map<string, Map<string, DayCounts>>()
  const totalByMonth = new Map<string, DayCounts>()
  for (const [key, list] of groups) {
    const [courseOfferingId, , month] = key.split('|')
    const counts = countStudentMonth(list, courseById.get(courseOfferingId)?.level ?? null)
    const byMonth = perCourseMonth.get(courseOfferingId) ?? new Map<string, DayCounts>()
    const courseMonth = byMonth.get(month) ?? emptyCounts()
    addCounts(courseMonth, counts)
    byMonth.set(month, courseMonth)
    perCourseMonth.set(courseOfferingId, byMonth)
    const totalMonth = totalByMonth.get(month) ?? emptyCounts()
    addCounts(totalMonth, counts)
    totalByMonth.set(month, totalMonth)
  }

  const months = [...totalByMonth.keys()].sort()
  const byCourse = courses.map((course) => {
    const byMonth = perCourseMonth.get(course.courseOfferingId) ?? new Map<string, DayCounts>()
    const total = emptyCounts()
    for (const counts of byMonth.values()) addCounts(total, counts)
    return { ...course, months: monthTable(byMonth, months), total }
  })
  const total = emptyCounts()
  for (const counts of totalByMonth.values()) addCounts(total, counts)
  return { months, byCourse, total: { ...total, months: monthTable(totalByMonth, months) } }
}
