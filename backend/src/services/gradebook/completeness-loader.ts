import { prisma } from '../../db/prisma.js'
import { loadRosterForScope } from '../student-attendance/roster.js'
import { countMissingAssessmentGrades, sortByUrgency, summarize, type CompletenessSummary } from './completeness.js'
import { assessmentPeriodsFor } from './period-closure.js'

export type CompletenessPeriod = {
  id: string
  name: string
  schoolYearId: string
  level: string
}

const hasText = (value: string | null | undefined) => (value ?? '').trim() !== ''

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
      periods: { where: { periodId }, include: { grades: true } },
      assessments: {
        where: { periodId: { in: assessmentPeriodIds }, deletedAt: null },
        select: { grades: { select: { studentId: true, valueHundredths: true, scaleLevelId: true, isAbsent: true } } },
      },
    },
  })

  const rows = await Promise.all(
    books.map(async (book) => {
      const roster = await loadRosterForScope({
        schoolYearId: book.schoolYearId,
        courseOfferingId: book.courseOfferingId,
        orientationId: book.orientationId,
        courseOrientationId: book.courseOrientationId,
      })
      const rosterIds = new Set(roster.map((s) => s.studentId))
      const state = book.periods[0] ?? null
      // Sólo cuentan los alumnos del grupo: una nota de alguien dado de baja no tapa a otro.
      const grades = (state?.grades ?? []).filter((g) => rosterIds.has(g.studentId))
      return summarize({
        gradeBookId: book.id,
        subjectName: book.subject?.name ?? '—',
        courseName: book.courseOffering?.course?.name ?? '—',
        teacherUserId: book.teacherUserId,
        teacherName: book.teacher?.name ?? null,
        periodStatus: (state?.status as CompletenessSummary['periodStatus']) ?? null,
        rosterSize: roster.length,
        gradedCount: grades.filter((g) => g.valueHundredths != null).length,
        requiresGrade: period.requiresGeneralGrade,
        judgedCount: grades.filter((g) => hasText(g.conceptualJudgement)).length,
        requiresJudgement: period.requiresConceptualJudgement,
        meetingGradedCount: grades.filter((g) => g.meetingValueHundredths != null).length,
        expectsAssessments: assessmentPeriodIds.length > 0,
        assessmentCount: book.assessments.length,
        missingAssessmentGrades: countMissingAssessmentGrades(book.assessments, rosterIds),
      })
    }),
  )

  return {
    period: { id: period.id, name: period.name, schoolYearId: period.schoolYearId, level: period.level },
    rows: sortByUrgency(rows),
  }
}
