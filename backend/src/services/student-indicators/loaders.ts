import { prisma } from '../../db/prisma.js'
import { shareInFlight } from '../../lib/in-flight.js'
import { alertRulesForYear, alertSubjectsThreshold } from '../gradebook/alert-rules.js'
import { describeValue, isReportCardPeriod } from '../gradebook/period-closure.js'
import { periodScaleFor } from '../gradebook/period-scale.js'
import { loadAbsenceStreaks, loadYearAbsenceTotals, reportEnrollments } from '../student-reports/reports.js'
import { attendanceTrend } from './attendance-trend.js'
import { pickReferencePeriods, riskCounts, riskRows, type ReferenceCandidate, type RiskInput } from './risk.js'
import { apeFocusYear, summarizeApe, type ApeCourse } from './subjects-ape.js'
import { buildTrajectory, rankCourses } from './trajectory.js'

/**
 * Consultas de Indicadores de estudiantes. Pocas y por ciclo; la aritmética está en los módulos
 * puros de esta carpeta, que se prueban sin base.
 */

const YEAR_SELECT = { id: true, code: true, label: true, status: true, startsOn: true, endsOn: true } as const
const COURSE_SELECT = { id: true, code: true, name: true, level: true, sortOrder: true } as const

type YearRow = { id: string; code: number; label: string; status: string; startsOn: Date | null; endsOn: Date | null }
const yearRef = (year: YearRow | null | undefined) =>
  year ? { id: year.id, code: year.code, label: year.label, status: year.status } : null

// ─── Asistencia en el tiempo ────────────────────────────────────────────────

export function loadAttendanceTrend(schoolYearId: string) {
  return shareInFlight(`attendance-trend:${schoolYearId}`, async () => {
    const [year, entries, offerings] = await Promise.all([
      prisma.schoolYear.findUnique({ where: { id: schoolYearId }, select: YEAR_SELECT }),
      prisma.studentAttendanceEntry.findMany({
        where: { session: { schoolYearId, status: 'TAKEN' } },
        select: { studentId: true, status: true, session: { select: { occurrenceYmd: true, courseOfferingId: true } } },
      }),
      prisma.courseOffering.findMany({ where: { schoolYearId }, select: { id: true, course: { select: COURSE_SELECT } } }),
    ])
    const ranks = rankCourses(offerings.map((o) => o.course))
    const courses = [...offerings]
      .sort((a, b) => (ranks.get(a.course.id)?.position ?? 0) - (ranks.get(b.course.id)?.position ?? 0) || a.course.name.localeCompare(b.course.name, 'es'))
      .map((o) => ({ courseOfferingId: o.id, courseName: o.course.name, level: o.course.level }))
    const trend = attendanceTrend(
      entries.map((e) => ({ studentId: e.studentId, courseOfferingId: e.session.courseOfferingId, ymd: e.session.occurrenceYmd, status: e.status })),
      courses,
    )
    return { schoolYear: yearRef(year), ...trend, byCourse: trend.byCourse.filter((course) => course.total.studentDays > 0) }
  })
}

// ─── Riesgo ─────────────────────────────────────────────────────────────────

/** Boletines del ciclo con cuántas notas de reunión tienen: de ahí sale el de referencia. */
async function referenceCandidates(schoolYearId: string): Promise<ReferenceCandidate[]> {
  const periods = await prisma.academicPeriod.findMany({
    where: { schoolYearId, isActive: true, isMeeting: true },
    select: { id: true, name: true, level: true, sortOrder: true, isMeeting: true, requiresGeneralGrade: true, requiresConceptualJudgement: true },
  })
  const reportCards = periods.filter(isReportCardPeriod)
  if (reportCards.length === 0) return []
  const books = await prisma.gradeBookPeriod.findMany({
    where: { periodId: { in: reportCards.map((p) => p.id) } },
    select: { periodId: true, _count: { select: { grades: { where: { meetingValueHundredths: { not: null } } } } } },
  })
  const graded = new Map<string, number>()
  for (const book of books) graded.set(book.periodId, (graded.get(book.periodId) ?? 0) + book._count.grades)
  return reportCards.map((p) => ({ id: p.id, name: p.name, level: p.level, sortOrder: p.sortOrder, graded: graded.get(p.id) ?? 0 }))
}

type LowSubjects = NonNullable<RiskInput['lowSubjects']>

/** Materias en tramo de alerta de cada estudiante en el boletín de referencia de su nivel. */
async function lowSubjectsAt(references: readonly ReferenceCandidate[]): Promise<Map<string, LowSubjects>> {
  const result = new Map<string, LowSubjects>()
  if (references.length === 0) return result
  const [grades, scales] = await Promise.all([
    prisma.periodGrade.findMany({
      where: { meetingValueHundredths: { not: null }, gradeBookPeriod: { periodId: { in: references.map((r) => r.id) } } },
      select: {
        studentId: true,
        meetingValueHundredths: true,
        gradeBookPeriod: { select: { periodId: true, gradeBook: { select: { subject: { select: { name: true } } } } } },
      },
    }),
    Promise.all(references.map(async (ref) => [ref.id, (await periodScaleFor(ref.level))?.levels ?? []] as const)),
  ])
  const levelsOf = new Map(scales)
  const nameOf = new Map(references.map((ref) => [ref.id, ref.name]))
  for (const grade of grades) {
    const periodId = grade.gradeBookPeriod.periodId
    const entry = result.get(grade.studentId) ?? { count: 0, subjects: [], periodName: nameOf.get(periodId) ?? '' }
    if (describeValue(grade.meetingValueHundredths, levelsOf.get(periodId) ?? [])?.isAlert) {
      entry.count++
      entry.subjects.push(grade.gradeBookPeriod.gradeBook.subject?.name ?? '—')
    }
    result.set(grade.studentId, entry)
  }
  for (const entry of result.values()) entry.subjects.sort((a, b) => a.localeCompare(b, 'es'))
  return result
}

/** Materias de años anteriores que el estudiante todavía debía al empezar este ciclo. */
async function carriedSubjects(year: YearRow, studentIds: readonly string[]): Promise<Map<string, number>> {
  if (studentIds.length === 0) return new Map()
  const rows = await prisma.studentPendingSubject.groupBy({
    by: ['studentId'],
    where: {
      studentId: { in: [...studentIds] },
      schoolYear: { code: { lt: year.code } },
      ...(year.startsOn ? { OR: [{ resolvedAt: null }, { resolvedAt: { gte: year.startsOn } }] } : { resolvedAt: null }),
    },
    _count: { _all: true },
  })
  return new Map(rows.map((row) => [row.studentId, row._count._all]))
}

export async function loadRisk(schoolYearId: string, periodId?: string) {
  const [year, enrollments, absences, streaks, rules, candidates] = await Promise.all([
    prisma.schoolYear.findUnique({ where: { id: schoolYearId }, select: YEAR_SELECT }),
    reportEnrollments(schoolYearId),
    loadYearAbsenceTotals(schoolYearId),
    loadAbsenceStreaks(schoolYearId),
    alertRulesForYear(schoolYearId),
    referenceCandidates(schoolYearId),
  ])
  const references = pickReferencePeriods(candidates, periodId)
  const chosen = [...references.values()].filter((ref): ref is ReferenceCandidate => ref !== null)
  const [lowSubjects, carried] = await Promise.all([
    lowSubjectsAt(chosen),
    year ? carriedSubjects(year, enrollments.map((e) => e.studentId)) : Promise.resolve(new Map<string, number>()),
  ])
  const openStreaks = new Map<string, { days: number; from: string }>()
  for (const streak of streaks.filter((s) => s.open)) {
    const current = openStreaks.get(streak.studentId)
    if (!current || streak.days > current.days) openStreaks.set(streak.studentId, { days: streak.days, from: streak.from })
  }
  const threshold = alertSubjectsThreshold(rules)
  const rows = riskRows(
    enrollments.map((e) => ({
      studentId: e.studentId,
      firstName: e.firstName,
      lastName: e.lastName,
      courseName: e.courseName,
      level: e.level,
      lowSubjects: lowSubjects.get(e.studentId) ?? null,
      absenceHundredths: absences.get(e.studentId) ?? 0,
      openStreak: openStreaks.get(e.studentId) ?? null,
      carried: carried.get(e.studentId) ?? 0,
    })),
    threshold,
  )
  return {
    schoolYear: yearRef(year),
    enrolled: enrollments.length,
    threshold: Number.isFinite(threshold) ? threshold : null,
    references: [...references].map(([level, ref]) => ({ level, period: ref ? { id: ref.id, name: ref.name } : null })),
    counts: riskCounts(rows),
    rows,
  }
}

// ─── Trayectoria ────────────────────────────────────────────────────────────

export async function loadTrajectory(requestedYearId: string | null) {
  const [years, courses, enrollments, failed] = await Promise.all([
    prisma.schoolYear.findMany({ select: YEAR_SELECT }),
    prisma.course.findMany({ select: COURSE_SELECT }),
    prisma.studentEnrollment.findMany({
      select: {
        studentId: true,
        schoolYearId: true,
        enrollmentStatus: true,
        academicResult: true,
        withdrawnAt: true,
        withdrawalAcademicYear: true,
        courseOffering: { select: { courseId: true } },
      },
    }),
    prisma.studentPendingSubject.findMany({
      where: { origin: 'FAILED_THIS_YEAR' },
      select: { studentId: true, schoolYearId: true, apeDecember: true, apeFebruary: true },
    }),
  ])
  return buildTrajectory(
    {
      years,
      courses,
      enrollments: enrollments.map(({ courseOffering, ...e }) => ({ ...e, courseId: courseOffering.courseId })),
      failed,
    },
    requestedYearId,
  )
}

// ─── Materias y APE ─────────────────────────────────────────────────────────

const NO_APE = { students: { referred: 0, clearedByFebruary: 0, clearedLater: 0, stillOwing: 0 }, byCourse: [], rows: [] }

/** Quiénes debían, al empezar el ciclo pedido, materias de años anteriores. */
async function carriedOverSummary(year: YearRow | undefined) {
  if (!year) return { students: 0, subjects: 0 }
  const active = await prisma.studentEnrollment.findMany({ where: { schoolYearId: year.id, enrollmentStatus: 'ACTIVE' }, select: { studentId: true } })
  const carried = await carriedSubjects(year, active.map((e) => e.studentId))
  return { students: carried.size, subjects: [...carried.values()].reduce((acc, n) => acc + n, 0) }
}

export async function loadSubjectsApe(requestedYearId: string) {
  const [years, failedByYear, courses] = await Promise.all([
    prisma.schoolYear.findMany({ select: YEAR_SELECT }),
    prisma.studentPendingSubject.groupBy({ by: ['schoolYearId'], where: { origin: 'FAILED_THIS_YEAR' }, _count: { _all: true } }),
    prisma.course.findMany({ select: COURSE_SELECT }),
  ])
  const requested = years.find((year) => year.id === requestedYearId)
  const focus = apeFocusYear(years, requestedYearId, new Map(failedByYear.map((row) => [row.schoolYearId, row._count._all])))
  const carriedOver = await carriedOverSummary(requested)
  if (!focus) return { requestedYear: yearRef(requested), focusYear: null, ...NO_APE, carriedOver }

  const [rows, enrollments] = await Promise.all([
    prisma.studentPendingSubject.findMany({
      where: { schoolYearId: focus.id, origin: 'FAILED_THIS_YEAR' },
      select: { studentId: true, subjectId: true, apeDecember: true, apeFebruary: true, resolvedAt: true, subject: { select: { name: true } } },
    }),
    prisma.studentEnrollment.findMany({
      where: { schoolYearId: focus.id },
      select: { studentId: true, courseOffering: { select: { course: { select: { id: true, name: true } } } } },
    }),
  ])
  const ranks = rankCourses(courses)
  const courseOf = new Map<string, ApeCourse>(
    enrollments.map((e) => [
      e.studentId,
      { courseId: e.courseOffering.course.id, courseName: e.courseOffering.course.name, position: ranks.get(e.courseOffering.course.id)?.position ?? 0 },
    ]),
  )
  const summary = summarizeApe(
    rows.map((row) => ({ ...row, subjectName: row.subject?.name ?? '—' })),
    courseOf,
  )
  return { requestedYear: yearRef(requested), focusYear: yearRef(focus), ...summary, carriedOver }
}
