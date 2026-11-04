import { prisma } from '../../db/prisma.js'
import type { RosterStudent } from '../student-attendance/roster.js'
import { reviewSummary } from './endorsement-view.js'
import { meetingReadiness, type AssessmentWithGrades } from './meeting-readiness.js'
import { assessmentPeriodsFor, isReportCardPeriod, type ClosureBlocker, type StudentPeriodRow } from './period-closure.js'
import { rostersByScope, scopeKeyOf, type RosterScope } from './rosters.js'

/**
 * En qué está cada reunión de una o varias libretas: su estado, el plazo, qué falta para cerrarla
 * (`meetingReadiness`, la misma cuenta del cierre y del control) y qué dijo el visado.
 *
 * Lo usan el panel de cierre de la libreta (todas las reuniones, no sólo la elegida) y el Inicio y
 * la lista de libretas del docente. Son siempre cuatro consultas más una por grupo, tenga una
 * libreta o veinte.
 */

export type MeetingBook = RosterScope & { id: string; level: string | null }

type MeetingPeriod = {
  id: string
  name: string
  kind: string
  sortOrder: number
  level: string | null
  schoolYearId: string
  isMeeting: boolean
  requiresGeneralGrade: boolean
  requiresConceptualJudgement: boolean
  closesOn: Date | null
  judgementLabel: string | null
}

type BookState = {
  gradeBookId: string
  periodId: string
  status: string
  closedAt: Date | null
  closedLate: boolean
  reopenReason: string | null
  groupReport: string | null
  grades: readonly { studentId: string; meetingValueHundredths: number | null; conductValueHundredths: number | null; conceptualJudgement: string | null }[]
  endorsements: readonly unknown[]
}

type BookAssessment = AssessmentWithGrades & { gradeBookId: string; periodId: string }

const ymd = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null)

export type MeetingSummary = {
  periodId: string
  name: string
  kind: string
  sortOrder: number
  reportCard: boolean
  judgementLabel: string | null
  closesOn: string | null
  status: 'OPEN' | 'CLOSED' | 'REOPENED'
  closedAt: string | null
  closedLate: boolean
  reopenReason: string | null
  /** Lo que falta para cerrarla; `null` si ya está cerrada. */
  missing: ClosureBlocker[] | null
  review: Omit<ReturnType<typeof reviewSummary>, 'states'> | null
}

/** Las filas del cierre de cada alumno del grupo, con lo guardado en la reunión. */
function closureRows(roster: readonly RosterStudent[], state: BookState | undefined): StudentPeriodRow[] {
  const saved = new Map((state?.grades ?? []).map((grade) => [grade.studentId, grade]))
  return roster.map((student) => {
    const grade = saved.get(student.studentId)
    return {
      studentId: student.studentId,
      lastName: student.lastName,
      firstName: student.firstName,
      assessmentValues: [],
      meetingValueHundredths: grade?.meetingValueHundredths ?? null,
      conductValueHundredths: grade?.conductValueHundredths ?? null,
      conceptualJudgement: grade?.conceptualJudgement ?? null,
    }
  })
}

/** Una reunión de una libreta, armada con lo ya cargado. Pura. */
export function summarizeMeeting(input: {
  period: MeetingPeriod
  /** Los tramos cuyas evaluaciones informa (`assessmentPeriodsFor`). */
  assessmentPeriodIds: readonly string[]
  roster: readonly RosterStudent[]
  state: BookState | undefined
  assessments: readonly BookAssessment[]
}): MeetingSummary {
  const { period, state } = input
  const status = (state?.status ?? 'OPEN') as MeetingSummary['status']
  const rules = {
    isMeeting: period.isMeeting,
    requiresGeneralGrade: period.requiresGeneralGrade,
    requiresConceptualJudgement: period.requiresConceptualJudgement,
  }
  const covered = new Set(input.assessmentPeriodIds)
  const missing =
    status === 'CLOSED'
      ? null
      : meetingReadiness({
          rules,
          students: closureRows(input.roster, state),
          groupReport: state?.groupReport ?? null,
          assessments: covered.size > 0 ? input.assessments.filter((a) => covered.has(a.periodId)) : undefined,
        })
  const review = state ? reviewSummary(state) : null
  return {
    periodId: period.id,
    name: period.name,
    kind: period.kind,
    sortOrder: period.sortOrder,
    reportCard: isReportCardPeriod(rules),
    judgementLabel: period.judgementLabel,
    closesOn: ymd(period.closesOn),
    status,
    closedAt: state?.closedAt?.toISOString() ?? null,
    closedLate: state?.closedLate ?? false,
    reopenReason: status === 'REOPENED' ? (state?.reopenReason ?? null) : null,
    missing,
    review: review ? { sections: review.sections, overallStatus: review.overallStatus, blockingSections: review.blockingSections, reclosedAfterObservation: review.reclosedAfterObservation } : null,
  }
}

const PERIOD_SELECT = {
  id: true,
  name: true,
  kind: true,
  sortOrder: true,
  level: true,
  schoolYearId: true,
  isMeeting: true,
  requiresGeneralGrade: true,
  requiresConceptualJudgement: true,
  closesOn: true,
  judgementLabel: true,
} as const

/** Las reuniones del ciclo y nivel de cada libreta, y los tramos que informa cada una. */
async function meetingsOf(books: readonly MeetingBook[]) {
  const periods: MeetingPeriod[] = await prisma.academicPeriod.findMany({
    where: {
      schoolYearId: { in: [...new Set(books.map((b) => b.schoolYearId))] },
      isActive: true,
      level: { in: [...new Set(books.flatMap((b) => (b.level ? [b.level] : [])))] as never },
    },
    select: PERIOD_SELECT,
    orderBy: { sortOrder: 'asc' },
  })
  const covered = new Map<string, string[]>()
  for (const period of periods.filter((p) => p.isMeeting)) {
    const siblings = periods.filter((p) => p.schoolYearId === period.schoolYearId && p.level === period.level)
    covered.set(period.id, assessmentPeriodsFor(period, siblings))
  }
  return { meetings: periods.filter((p) => p.isMeeting), covered }
}

export async function loadMeetingSummaries(
  books: readonly MeetingBook[],
): Promise<{ byBook: Map<string, MeetingSummary[]>; rosters: Map<string, RosterStudent[]> }> {
  if (books.length === 0) return { byBook: new Map(), rosters: new Map() }
  const { meetings, covered } = await meetingsOf(books)
  const bookIds = books.map((book) => book.id)
  const [states, assessments, rosters] = await Promise.all([
    prisma.gradeBookPeriod.findMany({
      where: { gradeBookId: { in: bookIds }, periodId: { in: meetings.map((m) => m.id) } },
      select: {
        gradeBookId: true,
        periodId: true,
        status: true,
        closedAt: true,
        closedLate: true,
        reopenReason: true,
        groupReport: true,
        grades: { select: { studentId: true, meetingValueHundredths: true, conductValueHundredths: true, conceptualJudgement: true } },
        endorsements: { orderBy: { occurredAt: 'asc' } },
      },
    }),
    prisma.assessment.findMany({
      where: { gradeBookId: { in: bookIds }, periodId: { in: [...new Set([...covered.values()].flat())] }, deletedAt: null },
      select: {
        gradeBookId: true,
        periodId: true,
        scope: true,
        grades: { select: { studentId: true, valueHundredths: true, scaleLevelId: true, isAbsent: true } },
      },
    }),
    rostersByScope(books),
  ])

  const stateOf = new Map(states.map((state) => [`${state.gradeBookId}|${state.periodId}`, state as BookState]))
  const byBook = new Map<string, MeetingSummary[]>()
  for (const book of books) {
    const roster = rosters.get(scopeKeyOf(book)) ?? []
    const own = (assessments as BookAssessment[]).filter((a) => a.gradeBookId === book.id)
    const rows = meetings
      .filter((m) => m.schoolYearId === book.schoolYearId && m.level === book.level)
      .map((period) =>
        summarizeMeeting({
          period,
          assessmentPeriodIds: covered.get(period.id) ?? [],
          roster,
          state: stateOf.get(`${book.id}|${period.id}`),
          assessments: own,
        }),
      )
    byBook.set(book.id, rows)
  }
  return { byBook, rosters }
}
