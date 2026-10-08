import { prisma } from '../../db/prisma.js'
import { EMPTY_ABSENCE_TOTALS, loadAbsenceTotals } from '../student-attendance/absence-totals.js'
import { isReportCardPeriod } from './period-closure.js'
import { conductLabel, conductScale } from './period-scale.js'

/**
 * Lo que la ficha académica suma a las notas: faltas, conducta institucional, decisiones de la
 * reunión y las reuniones con boletín de cada año. La reunión mira rendimiento, conducta e
 * inasistencias juntos; la ficha tenía sólo lo primero.
 */

export type StudentFileYear = { schoolYearId: string; level: string | null }

export type StudentFileYearExtras = {
  absences: { absenceHundredths: number; justified: number }
  conduct: Array<{ periodId: string; periodName: string; valueHundredths: number | null; label: string | null }>
  reportCardPeriods: Array<{ id: string; name: string }>
}

export type StudentFileDecision = {
  id: string
  schoolYearId: string | null
  periodName: string
  decision: string
  createdAt: Date
  createdByName: string | null
}

async function absencesByYear(studentId: string, years: readonly StudentFileYear[]) {
  const entries = await Promise.all(
    years.map(async (year) => {
      const totals = (await loadAbsenceTotals([studentId], year.schoolYearId, year.level)).get(studentId) ?? EMPTY_ABSENCE_TOTALS
      return [year.schoolYearId, { absenceHundredths: totals.absenceHundredths, justified: totals.justified }] as const
    }),
  )
  return new Map(entries)
}

export async function loadStudentFileExtras(
  studentId: string,
  years: readonly StudentFileYear[],
): Promise<{ byYear: Map<string, StudentFileYearExtras>; decisions: StudentFileDecision[] }> {
  const yearIds = [...new Set(years.map((year) => year.schoolYearId))]
  const [conductRows, decisionRows, periods, scale, absences] = await Promise.all([
    prisma.studentConductRecord.findMany({
      where: { studentId },
      select: { periodId: true, valueHundredths: true, period: { select: { name: true, sortOrder: true, schoolYearId: true } } },
    }),
    prisma.teacherMeetingRecord.findMany({
      where: { studentId },
      select: {
        id: true,
        decision: true,
        createdAt: true,
        period: { select: { name: true, schoolYearId: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    yearIds.length > 0
      ? prisma.academicPeriod.findMany({
          where: { schoolYearId: { in: yearIds }, isActive: true, isMeeting: true },
          select: {
            id: true,
            name: true,
            level: true,
            schoolYearId: true,
            isMeeting: true,
            requiresGeneralGrade: true,
            requiresConceptualJudgement: true,
          },
          orderBy: { sortOrder: 'asc' },
        })
      : Promise.resolve([]),
    conductScale(),
    absencesByYear(studentId, years),
  ])

  const conductLevels = scale?.levels ?? []
  const byYear = new Map<string, StudentFileYearExtras>()
  for (const year of years) {
    byYear.set(year.schoolYearId, {
      absences: absences.get(year.schoolYearId) ?? { absenceHundredths: 0, justified: 0 },
      conduct: conductRows
        .filter((row) => row.period?.schoolYearId === year.schoolYearId)
        .sort((a, b) => (a.period?.sortOrder ?? 0) - (b.period?.sortOrder ?? 0))
        .map((row) => ({
          periodId: row.periodId,
          periodName: row.period?.name ?? '',
          valueHundredths: row.valueHundredths,
          label: conductLabel(row.valueHundredths, conductLevels),
        })),
      // Boletín sólo de las reuniones de boletín del nivel del estudiante ese año.
      reportCardPeriods: periods
        .filter((p) => p.schoolYearId === year.schoolYearId && (!year.level || p.level === year.level) && isReportCardPeriod(p))
        .map((p) => ({ id: p.id, name: p.name })),
    })
  }

  const decisions = decisionRows.map((row) => ({
    id: row.id,
    schoolYearId: row.period?.schoolYearId ?? null,
    periodName: row.period?.name ?? '',
    decision: row.decision,
    createdAt: row.createdAt,
    createdByName: row.createdBy?.name ?? null,
  }))

  return { byYear, decisions }
}
