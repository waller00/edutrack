import { prisma } from '../../db/prisma.js'
import { getStudentRollCallSettings } from '../../config/system-settings.js'
import { loadRosterForScope } from '../student-attendance/roster.js'
import { loadAbsenceTotals } from '../student-attendance/absence-totals.js'
import { isBasicCycle } from '../student-attendance/absence-weight.js'
import { consolidateDay, type AttendanceCell } from '../student-attendance/consolidation.js'
import {
  describeValue,
  isReportCardPeriod,
  officialPeriodValue,
  previousReportCardPeriod,
} from '../gradebook/period-closure.js'
import { periodScaleFor } from '../gradebook/period-scale.js'
import {
  findAbsenceStreaks,
  isGradeDrop,
  summarizeLowGrades,
  thresholdsReached,
  type AbsenceStreak,
  type LowGradeBook,
} from './rules.js'

/**
 * Reportes de estudiantes, derivados al leer. Los mismos cargadores alimentan la pantalla y el
 * escaneo de alertas: así una alerta nunca dice algo distinto de lo que muestra el reporte.
 */

const PERIOD_SELECT = {
  id: true,
  name: true,
  level: true,
  schoolYearId: true,
  kind: true,
  sortOrder: true,
  isMeeting: true,
  requiresGeneralGrade: true,
  requiresConceptualJudgement: true,
} as const

type ReportPeriod = { id: string; name: string; level: string; schoolYearId: string; sortOrder: number }

export type StudentRef = { studentId: string; firstName: string; lastName: string; courseName: string }

function booksOfLevel(schoolYearId: string, level: string) {
  return {
    schoolYearId,
    status: 'ACTIVE' as const,
    courseOffering: { isOffered: true, course: { level: level as never } },
  }
}

const BOOK_LABELS = {
  subject: { select: { id: true, name: true } },
  orientation: { select: { name: true } },
  courseOrientation: { select: { orientation: { select: { name: true } } } },
  courseOffering: { select: { id: true, course: { select: { name: true } } } },
} as const

async function reportCardPeriod(periodId: string) {
  const period = await prisma.academicPeriod.findUnique({ where: { id: periodId }, select: PERIOD_SELECT })
  return period && isReportCardPeriod(period) ? period : null
}

// ─── % de notas bajas por materia y curso ───────────────────────────────────

export async function loadLowGrades(periodId: string) {
  const period = await reportCardPeriod(periodId)
  if (!period) return null
  const scale = await periodScaleFor(period.level)
  const levels = scale?.levels ?? []
  const books = await prisma.gradeBook.findMany({
    where: booksOfLevel(period.schoolYearId, period.level),
    include: {
      ...BOOK_LABELS,
      periods: { where: { periodId }, select: { grades: { select: { studentId: true, meetingValueHundredths: true } } } },
    },
  })

  const input: LowGradeBook[] = await Promise.all(
    books.map(async (book) => {
      const roster = await loadRosterForScope({
        schoolYearId: book.schoolYearId,
        courseOfferingId: book.courseOfferingId,
        orientationId: book.orientationId,
        courseOrientationId: book.courseOrientationId,
      })
      const rosterIds = new Set(roster.map((s) => s.studentId))
      const officialValues = (book.periods[0]?.grades ?? []).flatMap((g) => {
        const value = officialPeriodValue(g)
        return value != null && rosterIds.has(g.studentId) ? [{ studentId: g.studentId, valueHundredths: value }] : []
      })
      return {
        courseOfferingId: book.courseOfferingId,
        courseName: book.courseOffering?.course?.name ?? '—',
        orientationName: book.courseOrientation?.orientation?.name ?? book.orientation?.name ?? null,
        subjectName: book.subject?.name ?? '—',
        rosterSize: roster.length,
        officialValues,
      }
    }),
  )

  // Nota baja = banda de alerta de la escala del nivel (Insuficiente, Regular / En proceso…).
  const summary = summarizeLowGrades(input, (value) => Boolean(describeValue(value, levels)?.isAlert))
  return { period: { id: period.id, name: period.name, level: period.level }, ...summary }
}

// ─── Bajó de un boletín a otro ──────────────────────────────────────────────

export type GradeDropRow = StudentRef & {
  subjectId: string
  subjectName: string
  previous: number
  current: number
}

export async function loadGradeDrops(periodId: string) {
  const period = await reportCardPeriod(periodId)
  if (!period) return null
  const siblings = await prisma.academicPeriod.findMany({
    where: { schoolYearId: period.schoolYearId, level: period.level, isActive: true },
    select: PERIOD_SELECT,
  })
  const previous = previousReportCardPeriod(period, siblings)
  const header = {
    period: { id: period.id, name: period.name, level: period.level },
    previous: previous ? { id: previous.id, name: previous.name } : null,
  }
  if (!previous) return { ...header, rows: [] as GradeDropRow[] }

  const books = await prisma.gradeBook.findMany({
    where: booksOfLevel(period.schoolYearId, period.level),
    include: {
      ...BOOK_LABELS,
      periods: {
        where: { periodId: { in: [previous.id, period.id] } },
        select: {
          periodId: true,
          grades: {
            select: { studentId: true, meetingValueHundredths: true, studentFirstName: true, studentLastName: true },
          },
        },
      },
    },
  })

  const rows: GradeDropRow[] = []
  for (const book of books) {
    const byPeriod = new Map(book.periods.map((p) => [p.periodId, p.grades]))
    const before = new Map((byPeriod.get(previous.id) ?? []).map((g) => [g.studentId, officialPeriodValue(g)]))
    for (const grade of byPeriod.get(period.id) ?? []) {
      const entry = { previous: before.get(grade.studentId) ?? null, current: officialPeriodValue(grade) }
      if (!isGradeDrop(entry)) continue
      rows.push({
        studentId: grade.studentId,
        firstName: grade.studentFirstName,
        lastName: grade.studentLastName,
        courseName: book.courseOffering?.course?.name ?? '—',
        subjectId: book.subjectId,
        subjectName: book.subject?.name ?? '—',
        previous: entry.previous as number,
        current: entry.current as number,
      })
    }
  }
  rows.sort((a, b) => a.courseName.localeCompare(b.courseName, 'es') || a.lastName.localeCompare(b.lastName, 'es'))
  return { ...header, rows }
}

/** Todas las bajas del ciclo, boletín por boletín. Es lo que recorre el escaneo de alertas. */
export async function loadAllGradeDrops(schoolYearId: string) {
  const periods = await prisma.academicPeriod.findMany({
    where: { schoolYearId, isActive: true },
    select: PERIOD_SELECT,
  })
  const results = []
  for (const period of periods.filter(isReportCardPeriod)) {
    const result = await loadGradeDrops(period.id)
    if (result?.previous && result.rows.length) results.push(result)
  }
  return results
}

// ─── Faltas: matrículas del ciclo ───────────────────────────────────────────

async function activeEnrollments(schoolYearId: string) {
  const rows = await prisma.studentEnrollment.findMany({
    where: { schoolYearId, enrollmentStatus: 'ACTIVE' },
    select: {
      studentId: true,
      courseOfferingId: true,
      courseOrientationId: true,
      student: { select: { firstName: true, lastName: true } },
      courseOffering: { select: { course: { select: { name: true, level: true } } } },
    },
  })
  return rows.map((row) => ({
    studentId: row.studentId,
    courseOfferingId: row.courseOfferingId,
    courseOrientationId: row.courseOrientationId,
    firstName: row.student?.firstName ?? '',
    lastName: row.student?.lastName ?? '',
    courseName: row.courseOffering?.course?.name ?? '—',
    level: row.courseOffering?.course?.level ?? null,
  }))
}

// ─── 18 / 25 faltas ─────────────────────────────────────────────────────────

export type AbsenceThresholdRow = StudentRef & {
  absenceHundredths: number
  /** Umbral más alto alcanzado, en centésimos (1800 o 2500). */
  threshold: number
  reached: number[]
}

export async function loadAbsenceThresholds(schoolYearId: string): Promise<AbsenceThresholdRow[]> {
  const enrollments = await activeEnrollments(schoolYearId)
  const rows: AbsenceThresholdRow[] = []
  // Cada nivel cuenta distinto (ciclo básico por día): se cargan los totales por nivel.
  for (const level of new Set(enrollments.map((e) => e.level))) {
    const group = enrollments.filter((e) => e.level === level)
    const totals = await loadAbsenceTotals(group.map((e) => e.studentId), schoolYearId, level)
    for (const e of group) {
      const hundredths = totals.get(e.studentId)?.absenceHundredths ?? 0
      const reached = thresholdsReached(hundredths)
      if (reached.length === 0) continue
      rows.push({
        studentId: e.studentId,
        firstName: e.firstName,
        lastName: e.lastName,
        courseName: e.courseName,
        absenceHundredths: hundredths,
        threshold: reached[reached.length - 1],
        reached,
      })
    }
  }
  return rows.sort((a, b) => b.absenceHundredths - a.absenceHundredths)
}

// ─── Faltas seguidas ────────────────────────────────────────────────────────

export type AbsenceStreakRow = StudentRef & AbsenceStreak

/**
 * ¿El día es una falta entera sin justificar? En ciclo básico, faltar a una sola clase ya lo es.
 * En bachillerato se usa la consolidación diaria con su umbral, contando sólo ausencias sin
 * justificar.
 */
function isFullUnjustifiedDay(statuses: readonly string[], basicCycle: boolean, thresholdPercent: number): boolean {
  if (basicCycle) return statuses.includes('ABSENT')
  const cells = statuses.map((s) => ({
    ymd: '',
    status: (s === 'ABSENT' ? 'ABSENT' : 'PRESENT') as AttendanceCell['status'],
    subjectId: null,
    subjectName: null,
  }))
  return consolidateDay(cells, { thresholdPercent }) === 'ABSENCE'
}

export async function loadAbsenceStreaks(schoolYearId: string): Promise<AbsenceStreakRow[]> {
  const enrollments = await activeEnrollments(schoolYearId)
  if (enrollments.length === 0) return []

  // Sólo interesan los alumnos con alguna ausencia sin justificar: el resto no tiene racha.
  const absent = await prisma.studentAttendanceEntry.findMany({
    where: { status: 'ABSENT', session: { schoolYearId, status: 'TAKEN' } },
    select: { studentId: true, session: { select: { occurrenceYmd: true } } },
  })
  const absentStudents = [...new Set(absent.map((a) => a.studentId))]
  if (absentStudents.length === 0) return []
  const absentDays = [...new Set(absent.map((a) => a.session.occurrenceYmd))]

  const [dayEntries, sessionDays, settings] = await Promise.all([
    // Todas las marcas de esos alumnos esos días: hacen falta para saber si el día fue falta entera.
    prisma.studentAttendanceEntry.findMany({
      where: {
        studentId: { in: absentStudents },
        session: { schoolYearId, status: 'TAKEN', occurrenceYmd: { in: absentDays } },
      },
      select: { studentId: true, status: true, session: { select: { occurrenceYmd: true } } },
    }),
    // Días de clase de cada grupo (con lista tomada). Entre ellos no hay fines de semana ni feriados.
    prisma.studentAttendanceSession.findMany({
      where: { schoolYearId, status: 'TAKEN' },
      distinct: ['courseOfferingId', 'courseOrientationId', 'occurrenceYmd'],
      select: { courseOfferingId: true, courseOrientationId: true, occurrenceYmd: true },
    }),
    getStudentRollCallSettings(),
  ])

  const statusesByStudentDay = new Map<string, string[]>()
  for (const entry of dayEntries) {
    const key = `${entry.studentId}|${entry.session.occurrenceYmd}`
    statusesByStudentDay.set(key, [...(statusesByStudentDay.get(key) ?? []), entry.status])
  }

  const rows: AbsenceStreakRow[] = []
  for (const e of enrollments.filter((en) => absentStudents.includes(en.studentId))) {
    // Días del grupo del alumno: los de su oferta, de tronco común o de su orientación.
    const classDays = [
      ...new Set(
        sessionDays
          .filter(
            (s) =>
              s.courseOfferingId === e.courseOfferingId &&
              (s.courseOrientationId == null || s.courseOrientationId === e.courseOrientationId),
          )
          .map((s) => s.occurrenceYmd),
      ),
    ].sort()
    const fullDays = new Set(
      absentDays.filter((ymd) => {
        const statuses = statusesByStudentDay.get(`${e.studentId}|${ymd}`) ?? []
        return statuses.length > 0 && isFullUnjustifiedDay(statuses, isBasicCycle(e.level), settings.dailyAbsenceThresholdPercent)
      }),
    )
    for (const streak of findAbsenceStreaks(classDays, fullDays)) {
      rows.push({ studentId: e.studentId, firstName: e.firstName, lastName: e.lastName, courseName: e.courseName, ...streak })
    }
  }
  return rows.sort((a, b) => b.to.localeCompare(a.to) || a.lastName.localeCompare(b.lastName, 'es'))
}
