import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, loadersMock, reportsMock, academicMock } = vi.hoisted(() => ({
  prismaMock: {
    schoolYear: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
  loadersMock: { loadRisk: vi.fn(), loadAttendanceTrend: vi.fn(), loadSubjectsApe: vi.fn(), loadTrajectory: vi.fn() },
  reportsMock: { loadAbsenceStreaks: vi.fn(), loadAbsenceThresholds: vi.fn(), loadGradeDrops: vi.fn(), loadLowGrades: vi.fn() },
  academicMock: { loadAcademicDashboard: vi.fn(), loadAcademicComparison: vi.fn() },
}))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('./loaders.js', () => loadersMock)
vi.mock('../student-reports/reports.js', () => reportsMock)
vi.mock('./academic.js', () => academicMock)

import { loadStudentIndicatorsReport } from './report.js'

const PERIOD = { id: 'p2', name: '2.ª Entrega', level: 'EBI' }
const NOW = new Date('2026-11-13T17:00:00.000Z')

const trend = { schoolYear: null, months: [], byCourse: [], total: { studentDays: 0, absentDays: 0, justifiedDays: 0, lateDays: 0, months: [] } }
const risk = { schoolYear: null, enrolled: 0, threshold: 3, references: [], counts: { students: 0, grades: 0, absences: 0, both: 0 }, rows: [] }
const ape = { requestedYear: null, focusYear: null, students: { referred: 0, clearedByFebruary: 0, clearedLater: 0, stillOwing: 0 }, byCourse: [], rows: [], carriedOver: { students: 0, subjects: 0 } }
const trajectory = { requestedYear: null, focusYear: null, byCourse: [], total: {}, byYear: [], cohorts: [] }

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.schoolYear.findUnique.mockResolvedValue({ id: 'sy-2026', label: 'Ciclo 2026' })
  prismaMock.schoolYear.findMany.mockResolvedValue([{ id: 'sy-2025' }, { id: 'sy-2026' }])
  loadersMock.loadRisk.mockResolvedValue(risk)
  loadersMock.loadAttendanceTrend.mockResolvedValue(trend)
  loadersMock.loadSubjectsApe.mockResolvedValue(ape)
  loadersMock.loadTrajectory.mockResolvedValue(trajectory)
  reportsMock.loadAbsenceStreaks.mockResolvedValue([])
  reportsMock.loadAbsenceThresholds.mockResolvedValue([])
  reportsMock.loadLowGrades.mockResolvedValue(null)
  reportsMock.loadGradeDrops.mockResolvedValue(null)
  academicMock.loadAcademicDashboard.mockResolvedValue({ ambiguous: ['EBI', 'EMS'] })
  academicMock.loadAcademicComparison.mockImplementation(async ({ dimension }: { dimension: string }) => ({ dimension, level: 'EBI', data: [] }))
})

describe('loadStudentIndicatorsReport: carga sólo lo que se ve', () => {
  it('con sólo los reportes no toca las notas ni la trayectoria', async () => {
    const report = await loadStudentIndicatorsReport({ schoolYearId: 'sy-2026', period: PERIOD, access: { analytics: false, reports: true }, generatedAt: NOW })
    expect(loadersMock.loadRisk).toHaveBeenCalledWith('sy-2026', 'p2')
    expect(reportsMock.loadLowGrades).toHaveBeenCalledWith('p2')
    expect(reportsMock.loadGradeDrops).not.toHaveBeenCalled()
    expect(academicMock.loadAcademicDashboard).not.toHaveBeenCalled()
    expect(loadersMock.loadTrajectory).not.toHaveBeenCalled()
    expect(report.sections.map((s) => s.id)).toEqual(['resumen', 'materias', 'asistencia', 'riesgo'])
  })

  it('con sólo el rendimiento no toca las listas con nombres', async () => {
    await loadStudentIndicatorsReport({ schoolYearId: 'sy-2026', period: PERIOD, access: { analytics: true, reports: false }, generatedAt: NOW })
    expect(loadersMock.loadRisk).not.toHaveBeenCalled()
    expect(reportsMock.loadAbsenceStreaks).not.toHaveBeenCalled()
    expect(academicMock.loadAcademicDashboard).toHaveBeenCalledWith({ periodId: 'p2', level: 'EBI' }, 'sy-2026')
  })

  it('compara el boletín por asignatura y curso en el ciclo, y por año en todos los ciclos', async () => {
    await loadStudentIndicatorsReport({ schoolYearId: 'sy-2026', period: PERIOD, access: { analytics: true, reports: true }, generatedAt: NOW })
    const calls = academicMock.loadAcademicComparison.mock.calls.map(([params]) => [params.dimension, params.years])
    expect(calls).toEqual([
      ['SUBJECT', ['sy-2026']],
      ['COURSE', ['sy-2026']],
      ['YEAR', ['sy-2025', 'sy-2026']],
    ])
    expect(reportsMock.loadGradeDrops).toHaveBeenCalledWith('p2')
  })

  it('sin boletín no pide notas ni comparaciones, y la sección lo dice', async () => {
    const report = await loadStudentIndicatorsReport({ schoolYearId: 'sy-2026', period: null, access: { analytics: true, reports: true }, generatedAt: NOW })
    expect(reportsMock.loadLowGrades).not.toHaveBeenCalled()
    expect(academicMock.loadAcademicDashboard).not.toHaveBeenCalled()
    expect(academicMock.loadAcademicComparison).not.toHaveBeenCalled()
    expect(report.filters).toContain('Boletín de referencia: el ciclo todavía no tiene boletines')
  })

  it('si los niveles no se pueden separar, Rendimiento queda sin datos en vez de mezclar escalas', async () => {
    const report = await loadStudentIndicatorsReport({ schoolYearId: 'sy-2026', period: PERIOD, access: { analytics: true, reports: false }, generatedAt: NOW })
    expect(report.sections.find((s) => s.id === 'rendimiento')!.blocks).toEqual([{ kind: 'note', lines: ['Todavía no hay notas de boletín en este ciclo.'] }])
  })
})
