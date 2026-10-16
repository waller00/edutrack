import { AuditAction } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { loadRosterForScope, type RosterStudent } from '../student-attendance/roster.js'
import {
  countMissingAssessmentGrades,
  countStudentsWithoutGrades,
  sortByUrgency,
  summarize,
  type CompletenessSummary,
} from './completeness.js'
import { assessmentPeriodsFor, isReportCardPeriod } from './period-closure.js'

export type CompletenessPeriod = {
  id: string
  name: string
  schoolYearId: string
  level: string
}

const hasText = (value: string | null | undefined) => (value ?? '').trim() !== ''

type RosterScope = {
  schoolYearId: string
  courseOfferingId: string
  orientationId: string | null
  courseOrientationId: string | null
}

const scopeKeyOf = (s: RosterScope) => `${s.courseOfferingId}|${s.orientationId ?? ''}|${s.courseOrientationId ?? ''}`

/**
 * Roster de cada grupo, una consulta por grupo y no por libreta: las doce materias de un grupo
 * comparten alumnos, y antes se pedían doce veces.
 */
async function rostersByScope(scopes: readonly RosterScope[]): Promise<Map<string, RosterStudent[]>> {
  const unique = new Map(scopes.map((scope) => [scopeKeyOf(scope), scope]))
  const entries = await Promise.all(
    [...unique].map(async ([key, scope]) => [key, await loadRosterForScope(scope)] as const),
  )
  return new Map(entries)
}

type RequestStamp = { before: string | null; after: string | null }

/**
 * Cuándo se avisó por última vez a cada libreta por esta reunión, en cada etapa. Sale de la
 * auditoría (`GRADEBOOK_COMPLETION_REQUESTED`), así "Avisado" sobrevive a recargar la pantalla.
 * Los avisos viejos no tienen etapa: eran todos de antes de la reunión.
 */
async function lastRequests(gradeBookIds: readonly string[], periodId: string): Promise<Map<string, RequestStamp>> {
  if (gradeBookIds.length === 0) return new Map()
  const rows = await prisma.auditLog.findMany({
    where: {
      action: AuditAction.GRADEBOOK_COMPLETION_REQUESTED,
      entityType: 'GradeBook',
      entityId: { in: [...gradeBookIds] },
      metadata: { path: ['periodId'], equals: periodId },
    },
    select: { entityId: true, occurredAt: true, metadata: true },
    orderBy: { occurredAt: 'desc' },
  })
  const stamps = new Map<string, RequestStamp>()
  for (const row of rows) {
    if (!row.entityId) continue
    const stage = (row.metadata as { stage?: string } | null)?.stage === 'after' ? 'after' : 'before'
    const stamp = stamps.get(row.entityId) ?? { before: null, after: null }
    // Vienen de la más nueva a la más vieja: la primera de cada etapa es la última.
    if (!stamp[stage]) stamp[stage] = row.occurredAt.toISOString()
    stamps.set(row.entityId, stamp)
  }
  return stamps
}

/**
 * Estado de las libretas de un nivel frente a una reunión. Sólo las libretas del nivel del
 * período: una libreta EMS no tiene nada que ver con la 1.ª Entrega de EBI, y mezclarlas la
 * mostraba entera "sin calificación".
 */
export async function loadPeriodCompleteness(
  periodId: string,
  opts: { gradeBookId?: string } = {},
): Promise<{ period: CompletenessPeriod; rows: CompletenessSummary[] } | null> {
  const period = await prisma.academicPeriod.findUnique({
    where: { id: periodId },
    select: {
      id: true,
      name: true,
      schoolYearId: true,
      level: true,
      kind: true,
      sortOrder: true,
      requiresConceptualJudgement: true,
      isMeeting: true,
      requiresGeneralGrade: true,
    },
  })
  if (!period) return null

  const siblings = await prisma.academicPeriod.findMany({
    where: { schoolYearId: period.schoolYearId, level: period.level, isActive: true },
    select: { id: true, kind: true, sortOrder: true },
  })
  const assessmentPeriodIds = assessmentPeriodsFor(period, siblings)

  const books = await prisma.gradeBook.findMany({
    where: {
      schoolYearId: period.schoolYearId,
      status: 'ACTIVE',
      ...(opts.gradeBookId ? { id: opts.gradeBookId } : {}),
      courseOffering: { isOffered: true, course: { level: period.level } },
    },
    include: {
      subject: { select: { name: true } },
      teacher: { select: { id: true, name: true } },
      courseOffering: { include: { course: { select: { name: true } } } },
      courseOrientation: { select: { orientation: { select: { name: true } } } },
      periods: { where: { periodId }, include: { grades: true } },
      assessments: {
        where: { periodId: { in: assessmentPeriodIds }, deletedAt: null },
        select: {
          scope: true,
          grades: { select: { studentId: true, valueHundredths: true, scaleLevelId: true, isAbsent: true } },
        },
      },
    },
  })

  const [rosters, requests] = await Promise.all([
    rostersByScope(books),
    lastRequests(
      books.map((book) => book.id),
      periodId,
    ),
  ])

  const rows = books.map((book) => {
    const roster = rosters.get(scopeKeyOf(book)) ?? []
    const rosterIds = new Set(roster.map((s) => s.studentId))
    const state = book.periods[0] ?? null
    // Sólo cuentan los alumnos del grupo: una nota de alguien dado de baja no tapa a otro.
    const grades = (state?.grades ?? []).filter((g) => rosterIds.has(g.studentId))
    return summarize({
      gradeBookId: book.id,
      subjectName: book.subject?.name ?? '—',
      courseName: book.courseOffering?.course?.name ?? '—',
      orientationName: book.courseOrientation?.orientation?.name ?? null,
      teacherUserId: book.teacherUserId,
      teacherName: book.teacher?.name ?? null,
      periodStatus: (state?.status as CompletenessSummary['periodStatus']) ?? null,
      rosterSize: roster.length,
      // R es el rendimiento (la nota oficial) y C la conducta.
      gradedCount: grades.filter((g) => g.meetingValueHundredths != null).length,
      requiresGrade: period.requiresGeneralGrade,
      judgedCount: grades.filter((g) => hasText(g.conceptualJudgement)).length,
      requiresJudgement: period.requiresConceptualJudgement,
      conductCount: grades.filter((g) => g.conductValueHundredths != null).length,
      requiresConduct: period.requiresGeneralGrade && period.isMeeting,
      hasGroupReport: hasText(state?.groupReport),
      requiresGroupReport: isReportCardPeriod(period),
      expectsAssessments: assessmentPeriodIds.length > 0,
      assessmentCount: book.assessments.length,
      missingAssessmentGrades: countMissingAssessmentGrades(book.assessments, rosterIds),
      studentsWithoutGrades: countStudentsWithoutGrades(book.assessments, rosterIds),
      lastRequestedAt: requests.get(book.id) ?? { before: null, after: null },
    })
  })

  return {
    period: { id: period.id, name: period.name, schoolYearId: period.schoolYearId, level: period.level },
    rows: sortByUrgency(rows),
  }
}
