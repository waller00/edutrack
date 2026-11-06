import { prisma } from '../../db/prisma.js'
import { loadAbsenceTotals, type AbsenceTotals } from '../student-attendance/absence-totals.js'
import { wholeAbsences } from '../student-attendance/absence-weight.js'
import { loadRosterForScope } from '../student-attendance/roster.js'
import { describeCell, gradeBooksForGroup, type ScaleLevelRow } from './institutional.js'
import { assessmentPeriodsFor, officialPeriodValue, previousReportCardPeriod } from './period-closure.js'
import { periodScaleFor } from './period-scale.js'
import { tallySubjectAttendance, type MarkCounts } from './subject-attendance.js'

/**
 * Un alumno en la Reunión de profesores: cada materia con su detalle (evaluaciones del período,
 * C, juicio del docente, faltas a esa materia y la R de la reunión anterior) y sus faltas del liceo
 * con el desglose. Lo abre el panel del alumno de `/libreta/reunion`; sólo `gradebook.read` `all`.
 *
 * Una cantidad fija de consultas, sin importar cuántas materias tenga el grupo: las faltas a cada
 * materia salen de una sola lectura de las marcas del alumno, repartidas por libreta.
 */

export type GroupScope = {
  courseOfferingId: string
  orientationId: string | null
  courseOrientationId: string | null
}

/**
 * La oferta y las libretas de un grupo en el orden de la matriz: las de su orientación más las de
 * tronco común (`gradeBooksForGroup`). La matriz y el panel del alumno muestran las mismas materias.
 */
export async function loadGroupBooks(scope: GroupScope) {
  const offering = await prisma.courseOffering.findUnique({
    where: { id: scope.courseOfferingId },
    include: { course: true, schoolYear: true },
  })
  if (!offering) return null
  const allBooks = await prisma.gradeBook.findMany({
    where: { schoolYearId: offering.schoolYearId, courseOfferingId: scope.courseOfferingId },
    include: {
      subject: { select: { id: true, name: true, sortOrder: true } },
      teacher: { select: { id: true, name: true } },
    },
  })
  const books = gradeBooksForGroup(allBooks as never, scope).sort(
    (a: any, b: any) => a.subject.sortOrder - b.subject.sortOrder || a.subject.name.localeCompare(b.subject.name, 'es'),
  ) as any[]
  return { offering, books }
}

type PeriodRow = {
  id: string
  name: string
  kind: string
  sortOrder: number
  startsOn: Date | null
  endsOn: Date | null
  isMeeting: boolean
  requiresGeneralGrade: boolean
  requiresConceptualJudgement: boolean
}

type BookRow = {
  id: string
  subjectId: string
  orientationId: string | null
  courseOrientationId: string | null
  subject: { name: string }
  teacher: { name: string | null } | null
}

type StateRow = {
  gradeBookId: string
  periodId: string
  status: string
  grades: Array<{
    valueHundredths: number | null
    meetingValueHundredths: number | null
    conductValueHundredths: number | null
    conceptualJudgement: string | null
  }>
}

type AssessmentRow = {
  id: string
  gradeBookId: string
  periodId: string
  date: Date
  title: string
  scope: string
  grades: Array<{ valueHundredths: number | null; isAbsent: boolean; comment: string | null; scaleLevel: { label: string } | null }>
}

type MarkRow = {
  status: string
  ymd: string
  subjectId: string | null
  orientationId: string | null
  courseOrientationId: string | null
}

export type MeetingStudentAssessment = {
  id: string
  title: string
  /** Día civil, `YYYY-MM-DD`. */
  date: string
  periodName: string
  scope: string
  valueHundredths: number | null
  /** «No rindió»: distinto de «sin nota». */
  isAbsent: boolean
  levelLabel: string | null
  comment: string | null
  /** Sin fila de nota para el alumno. */
  missing: boolean
}

export type MeetingStudentSubject = {
  gradeBookId: string
  subjectId: string
  name: string
  teacher: string | null
  periodStatus: string | null
  /** R, el rendimiento: la nota oficial. */
  valueHundredths: number | null
  descriptor: ReturnType<typeof describeCell>
  /** C vieja del docente, como propuesta mientras no hay R. */
  proposedValueHundredths: number | null
  /** C, la conducta en la asignatura. */
  conductValueHundredths: number | null
  conceptualJudgement: string | null
  /** R de la reunión de boletín anterior. */
  previousValueHundredths: number | null
  assessments: MeetingStudentAssessment[]
  /**
   * Faltas a las clases de esta materia: cada clase cuenta una vez (no es la falta oficial, que
   * es del día). `period` son los días que informa esta reunión; `year`, el ciclo.
   */
  attendance: { period: MarkCounts | null; year: MarkCounts }
}

export type MeetingStudent = {
  student: { studentId: string; lastName: string; firstName: string }
  period: { id: string; name: string }
  previousPeriod: { id: string; name: string } | null
  /** Faltas del liceo en el ciclo hasta hoy, con la regla del día (las de la columna Faltas). */
  absences: { hundredths: number; whole: number; unjustified: number; justified: number; lates: number }
  subjects: MeetingStudentSubject[]
}

const sameScope = (mark: MarkRow, book: BookRow) =>
  mark.subjectId === book.subjectId &&
  (mark.orientationId ?? null) === (book.orientationId ?? null) &&
  (mark.courseOrientationId ?? null) === (book.courseOrientationId ?? null)

function assessmentView(row: AssessmentRow, periodName: string): MeetingStudentAssessment | null {
  const grade = row.grades[0]
  // Una nota individual de otro alumno no es de este: sólo las del grupo se muestran sin nota.
  if (!grade && row.scope === 'INDIVIDUAL') return null
  return {
    id: row.id,
    title: row.title,
    date: row.date.toISOString().slice(0, 10),
    periodName,
    scope: row.scope,
    valueHundredths: grade?.valueHundredths ?? null,
    isAbsent: grade?.isAbsent ?? false,
    levelLabel: grade?.scaleLevel?.label ?? null,
    comment: grade?.comment ?? null,
    missing: !grade,
  }
}

function absencesView(totals: AbsenceTotals | undefined): MeetingStudent['absences'] {
  const hundredths = totals?.absenceHundredths ?? 0
  return {
    hundredths,
    whole: wholeAbsences(hundredths),
    unjustified: totals?.counts.unjustified ?? 0,
    justified: totals?.counts.justified ?? 0,
    lates: totals?.counts.lates ?? 0,
  }
}

export type MeetingStudentInput = {
  student: { studentId: string; lastName: string; firstName: string }
  books: readonly BookRow[]
  target: PeriodRow
  previous: PeriodRow | null
  periods: readonly PeriodRow[]
  states: readonly StateRow[]
  assessments: readonly AssessmentRow[]
  marks: readonly MarkRow[]
  levels: readonly ScaleLevelRow[]
  absences: AbsenceTotals | undefined
}

/** Arma el detalle del alumno con lo ya leído. Pura: los tests no tocan la base. */
export function buildMeetingStudent(input: MeetingStudentInput): MeetingStudent {
  const { student, target, previous, periods } = input
  const periodName = new Map(periods.map((p) => [p.id, p.name]))
  const stateOf = (bookId: string, periodId: string | undefined) =>
    periodId ? input.states.find((s) => s.gradeBookId === bookId && s.periodId === periodId) : undefined

  const subjects = input.books.map((book): MeetingStudentSubject => {
    const state = stateOf(book.id, target.id)
    const grade = state?.grades[0]
    const value = officialPeriodValue(grade)
    const tally = tallySubjectAttendance(
      input.marks.filter((mark) => sameScope(mark, book)).map((mark) => ({ studentId: student.studentId, status: mark.status, ymd: mark.ymd })),
      [student.studentId],
      periods,
    )[0]
    return {
      gradeBookId: book.id,
      subjectId: book.subjectId,
      name: book.subject.name,
      teacher: book.teacher?.name ?? null,
      periodStatus: state?.status ?? null,
      valueHundredths: value,
      descriptor: describeCell(value, input.levels),
      proposedValueHundredths: grade?.valueHundredths ?? null,
      conductValueHundredths: grade?.conductValueHundredths ?? null,
      conceptualJudgement: grade?.conceptualJudgement ?? null,
      previousValueHundredths: officialPeriodValue(stateOf(book.id, previous?.id)?.grades[0]),
      assessments: input.assessments
        .filter((a) => a.gradeBookId === book.id)
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .map((a) => assessmentView(a, periodName.get(a.periodId) ?? ''))
        .filter((a): a is MeetingStudentAssessment => a !== null),
      attendance: { period: tally.periods[target.id] ?? null, year: tally.total },
    }
  })

  return {
    student,
    period: { id: target.id, name: target.name },
    previousPeriod: previous ? { id: previous.id, name: previous.name } : null,
    absences: absencesView(input.absences),
    subjects,
  }
}

export type MeetingStudentResult =
  | { data: MeetingStudent }
  | { error: 'GROUP_NOT_FOUND' | 'PERIOD_NOT_FOUND' | 'STUDENT_NOT_IN_GROUP' }

const PERIOD_SELECT = {
  id: true,
  name: true,
  kind: true,
  sortOrder: true,
  startsOn: true,
  endsOn: true,
  isMeeting: true,
  requiresGeneralGrade: true,
  requiresConceptualJudgement: true,
} as const

/** Lee todo lo del alumno en esa reunión y lo arma con `buildMeetingStudent`. */
export async function loadMeetingStudent(args: {
  scope: GroupScope
  periodId: string
  studentId: string
}): Promise<MeetingStudentResult> {
  const { scope, periodId, studentId } = args
  const group = await loadGroupBooks(scope)
  if (!group) return { error: 'GROUP_NOT_FOUND' }
  const { offering, books } = group
  const schoolYearId = offering.schoolYearId
  const level = offering.course?.level ?? null

  const [roster, periods, scale] = await Promise.all([
    loadRosterForScope({ schoolYearId, ...scope }),
    prisma.academicPeriod.findMany({
      where: { schoolYearId, isActive: true, ...(level ? { level } : {}) },
      select: PERIOD_SELECT,
    }) as Promise<PeriodRow[]>,
    periodScaleFor(level),
  ])
  const student = roster.find((row) => row.studentId === studentId)
  if (!student) return { error: 'STUDENT_NOT_IN_GROUP' }
  const target = periods.find((p) => p.id === periodId)
  if (!target) return { error: 'PERIOD_NOT_FOUND' }
  const previous = previousReportCardPeriod(target, periods)

  const bookIds = books.map((b) => b.id)
  const tramoIds = assessmentPeriodsFor(target, periods)
  const [states, assessments, entries, absences] = await Promise.all([
    prisma.gradeBookPeriod.findMany({
      where: { gradeBookId: { in: bookIds }, periodId: { in: previous ? [target.id, previous.id] : [target.id] } },
      select: {
        gradeBookId: true,
        periodId: true,
        status: true,
        grades: {
          where: { studentId },
          select: { valueHundredths: true, meetingValueHundredths: true, conductValueHundredths: true, conceptualJudgement: true },
        },
      },
    }),
    tramoIds.length === 0
      ? Promise.resolve([])
      : prisma.assessment.findMany({
          where: { gradeBookId: { in: bookIds }, periodId: { in: tramoIds }, deletedAt: null },
          select: {
            id: true,
            gradeBookId: true,
            periodId: true,
            date: true,
            title: true,
            scope: true,
            grades: {
              where: { studentId },
              select: { valueHundredths: true, isAbsent: true, comment: true, scaleLevel: { select: { label: true } } },
            },
          },
        }),
    prisma.studentAttendanceEntry.findMany({
      where: { studentId, session: { schoolYearId, courseOfferingId: scope.courseOfferingId } },
      select: {
        status: true,
        session: { select: { occurrenceYmd: true, subjectId: true, orientationId: true, courseOrientationId: true } },
      },
    }),
    loadAbsenceTotals([studentId], schoolYearId, level),
  ])

  return {
    data: buildMeetingStudent({
      student: { studentId, lastName: student.lastName, firstName: student.firstName },
      books,
      target,
      previous,
      periods,
      states: states as StateRow[],
      assessments: assessments as AssessmentRow[],
      marks: entries.map((entry) => ({
        status: entry.status,
        ymd: entry.session.occurrenceYmd,
        subjectId: entry.session.subjectId,
        orientationId: entry.session.orientationId,
        courseOrientationId: entry.session.courseOrientationId,
      })),
      levels: (scale?.levels ?? []) as ScaleLevelRow[],
      absences: absences.get(studentId),
    }),
  }
}
