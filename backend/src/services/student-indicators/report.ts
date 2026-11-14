import { prisma } from '../../db/prisma.js'
import { loadAbsenceStreaks, loadAbsenceThresholds, loadGradeDrops, loadLowGrades } from '../student-reports/reports.js'
import type { ReportDoc } from '../reports/model.js'
import { loadAcademicComparison, loadAcademicDashboard, type Ambiguous, type ComparisonDimension, type Level } from './academic.js'
import { loadAttendanceTrend, loadRisk, loadSubjectsApe, loadTrajectory } from './loaders.js'
import { buildStudentReport, type IndicatorAccess, type ReportPeriod, type StudentReportData } from './report-sections.js'

/**
 * Carga lo que muestra "Indicadores de estudiantes" para el ciclo y el boletín elegidos, con los
 * mismos servicios que la pantalla y sólo para las secciones que quien descarga puede ver.
 */

const DIMENSIONS: readonly ComparisonDimension[] = ['SUBJECT', 'COURSE', 'YEAR']

const solved = <T extends object>(result: T | Ambiguous): T | null => ('ambiguous' in result ? null : result)

type Reports = Pick<StudentReportData, 'risk' | 'trend' | 'streaks' | 'thresholds' | 'subjectsApe' | 'lowGrades' | 'drops'>
type Academic = Pick<StudentReportData, 'dashboard' | 'comparisons'>

const NO_REPORTS: Reports = { risk: null, trend: null, streaks: null, thresholds: null, subjectsApe: null, lowGrades: null, drops: null }
const NO_ACADEMIC: Academic = { dashboard: null, comparisons: null }

/** Lo de los reportes de estudiantes: faltas, materias y APE, quién necesita atención. */
async function loadReports(schoolYearId: string, period: ReportPeriod | null, withDrops: boolean): Promise<Reports> {
  const periodId = period?.id
  const [risk, trend, streaks, thresholds, subjectsApe, lowGrades, drops] = await Promise.all([
    loadRisk(schoolYearId, periodId),
    loadAttendanceTrend(schoolYearId),
    loadAbsenceStreaks(schoolYearId),
    loadAbsenceThresholds(schoolYearId),
    loadSubjectsApe(schoolYearId),
    periodId ? loadLowGrades(periodId) : null,
    // "Quiénes bajaron" va en Rendimiento: sólo si también se ve esa sección.
    periodId && withDrops ? loadGradeDrops(periodId) : null,
  ])
  return { risk, trend, streaks, thresholds, subjectsApe, lowGrades, drops }
}

/** El tablero de notas y las tres comparaciones; entre años, el mismo boletín en cada ciclo. */
async function loadAcademic(schoolYearId: string, period: ReportPeriod | null): Promise<Academic> {
  if (!period) return NO_ACADEMIC
  const level = (period.level ?? undefined) as Level | undefined
  const years = await prisma.schoolYear.findMany({ select: { id: true } })
  const yearsFor = (dimension: ComparisonDimension) => (dimension === 'YEAR' ? years.map((year) => year.id) : [schoolYearId])
  const [dashboard, ...comparisons] = await Promise.all([
    loadAcademicDashboard({ periodId: period.id, level }, schoolYearId),
    ...DIMENSIONS.map((dimension) => loadAcademicComparison({ dimension, years: yearsFor(dimension), periodId: period.id, level })),
  ])
  const byDimension: Academic['comparisons'] = {}
  DIMENSIONS.forEach((dimension, i) => {
    const comparison = solved(comparisons[i])
    if (comparison) byDimension[dimension] = comparison
  })
  return { dashboard: solved(dashboard), comparisons: byDimension }
}

export async function loadStudentIndicatorsReport(params: {
  schoolYearId: string
  period: ReportPeriod | null
  access: IndicatorAccess
  generatedAt: Date
}): Promise<ReportDoc> {
  const { schoolYearId, period, access } = params
  const [year, reports, academic, trajectory] = await Promise.all([
    prisma.schoolYear.findUnique({ where: { id: schoolYearId }, select: { id: true, label: true } }),
    access.reports ? loadReports(schoolYearId, period, access.analytics) : NO_REPORTS,
    access.analytics ? loadAcademic(schoolYearId, period) : NO_ACADEMIC,
    access.analytics ? loadTrajectory(schoolYearId) : null,
  ])
  return buildStudentReport({
    access,
    year: year ?? { id: schoolYearId, label: 'Ciclo lectivo' },
    period,
    generatedAt: params.generatedAt,
    ...reports,
    ...academic,
    trajectory,
  })
}
