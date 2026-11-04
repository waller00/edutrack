import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, reportsMock, rulesMock, scaleMock } = vi.hoisted(() => ({
  prismaMock: {
    schoolYear: { findUnique: vi.fn(), findMany: vi.fn() },
    studentAttendanceEntry: { findMany: vi.fn() },
    courseOffering: { findMany: vi.fn() },
    academicPeriod: { findMany: vi.fn() },
    gradeBookPeriod: { findMany: vi.fn() },
    periodGrade: { findMany: vi.fn() },
    studentPendingSubject: { groupBy: vi.fn(), findMany: vi.fn() },
    studentEnrollment: { findMany: vi.fn() },
    course: { findMany: vi.fn() },
  },
  reportsMock: { reportEnrollments: vi.fn(), loadYearAbsenceTotals: vi.fn(), loadAbsenceStreaks: vi.fn() },
  rulesMock: vi.fn(),
  scaleMock: vi.fn(),
}))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../student-reports/reports.js', () => reportsMock)
vi.mock('../gradebook/alert-rules.js', async () => ({
  ...(await vi.importActual<object>('../gradebook/alert-rules.js')),
  alertRulesForYear: rulesMock,
}))
vi.mock('../gradebook/period-scale.js', () => ({ periodScaleFor: scaleMock }))

import { loadAttendanceTrend, loadRisk, loadSubjectsApe, loadTrajectory } from './loaders.js'

const YEAR = { id: 'y26', code: 2026, label: 'Ciclo 2026', status: 'ACTIVE', startsOn: new Date('2026-03-02T12:00:00Z'), endsOn: null }
const COURSES = [
  { id: 'c7', code: '7-EBI', name: '7 EBI', level: 'EBI', sortOrder: 1 },
  { id: 'c8', code: '8-EBI', name: '8 EBI', level: 'EBI', sortOrder: 2 },
]
const ALERT = [
  { id: 'l1', label: 'Insuficiente', minValueHundredths: 100, maxValueHundredths: 499, colorToken: null, iconToken: null, isPassing: false, isAlert: true },
  { id: 'l2', label: 'Aceptable', minValueHundredths: 500, maxValueHundredths: 1000, colorToken: null, iconToken: null, isPassing: true, isAlert: false },
]

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.schoolYear.findUnique.mockResolvedValue(YEAR)
  prismaMock.schoolYear.findMany.mockResolvedValue([YEAR])
  prismaMock.course.findMany.mockResolvedValue(COURSES)
})

describe('loadAttendanceTrend', () => {
  it('sólo cuenta listas pasadas y deja afuera los cursos sin listas', async () => {
    prismaMock.studentAttendanceEntry.findMany.mockResolvedValue([
      { studentId: 'a', status: 'ABSENT', session: { occurrenceYmd: '2026-03-03', courseOfferingId: 'o7' } },
    ])
    prismaMock.courseOffering.findMany.mockResolvedValue([
      { id: 'o8', course: COURSES[1] },
      { id: 'o7', course: COURSES[0] },
    ])

    const trend = await loadAttendanceTrend('y26')

    expect(prismaMock.studentAttendanceEntry.findMany.mock.calls[0][0].where).toEqual({ session: { schoolYearId: 'y26', status: 'TAKEN' } })
    expect(trend.schoolYear).toMatchObject({ code: 2026 })
    expect(trend.byCourse.map((c) => c.courseName)).toEqual(['7 EBI'])
    expect(trend.total).toMatchObject({ studentDays: 1, absentDays: 1 })
  })
})

describe('loadRisk', () => {
  it('junta notas del boletín de referencia, faltas, faltas seguidas y previas', async () => {
    reportsMock.reportEnrollments.mockResolvedValue([
      { studentId: 'ana', firstName: 'Ana', lastName: 'Pérez', courseName: '8 EBI', level: 'EBI' },
      { studentId: 'beto', firstName: 'Beto', lastName: 'Gómez', courseName: '8 EBI', level: 'EBI' },
    ])
    reportsMock.loadYearAbsenceTotals.mockResolvedValue(new Map([['beto', 1900]]))
    reportsMock.loadAbsenceStreaks.mockResolvedValue([{ studentId: 'beto', open: true, days: 4, from: '2026-10-28' }])
    rulesMock.mockResolvedValue([{ type: 'ALERT_SUBJECTS', threshold: 2 }])
    scaleMock.mockResolvedValue({ levels: ALERT })
    const boletin = { isMeeting: true, requiresGeneralGrade: true, requiresConceptualJudgement: true }
    prismaMock.academicPeriod.findMany.mockResolvedValue([{ id: 'e3', name: '3.ª Entrega', level: 'EBI', sortOrder: 80, ...boletin }])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([{ periodId: 'e3', _count: { grades: 40 } }])
    const grade = (studentId: string, value: number, subject: string) => ({
      studentId,
      meetingValueHundredths: value,
      gradeBookPeriod: { periodId: 'e3', gradeBook: { subject: { name: subject } } },
    })
    prismaMock.periodGrade.findMany.mockResolvedValue([grade('ana', 300, 'Matemática'), grade('ana', 400, 'Física'), grade('beto', 800, 'Matemática')])
    prismaMock.studentPendingSubject.groupBy.mockResolvedValue([{ studentId: 'ana', _count: { _all: 1 } }])

    const risk = await loadRisk('y26')

    expect(risk.counts).toEqual({ students: 2, grades: 1, absences: 1, both: 0 })
    expect(risk.rows.find((r) => r.studentId === 'ana')).toMatchObject({
      reasons: ['GRADES', 'CARRIED'],
      grades: { lowSubjects: 2, subjects: ['Física', 'Matemática'], periodName: '3.ª Entrega' },
      carried: 1,
    })
    expect(risk.rows.find((r) => r.studentId === 'beto')).toMatchObject({ reasons: ['ABSENCES', 'STREAK'], streak: { days: 4 } })
    expect(risk.references).toEqual([{ level: 'EBI', period: { id: 'e3', name: '3.ª Entrega' } }])
    expect(risk.threshold).toBe(2)
    // Las previas: de años anteriores, que todavía debía al empezar el ciclo.
    expect(prismaMock.studentPendingSubject.groupBy.mock.calls[0][0].where).toMatchObject({
      schoolYear: { code: { lt: 2026 } },
      OR: [{ resolvedAt: null }, { resolvedAt: { gte: YEAR.startsOn } }],
    })
  })
})

describe('loadTrajectory', () => {
  it('lee todas las matrículas con su curso y las materias perdidas en el año', async () => {
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      { studentId: 'a', schoolYearId: 'y26', enrollmentStatus: 'ACTIVE', academicResult: null, withdrawnAt: null, withdrawalAcademicYear: null, courseOffering: { courseId: 'c7' } },
    ])
    prismaMock.studentPendingSubject.findMany.mockResolvedValue([])

    const trajectory = await loadTrajectory('y26')

    expect(prismaMock.studentPendingSubject.findMany.mock.calls[0][0].where).toEqual({ origin: 'FAILED_THIS_YEAR' })
    expect(trajectory.byYear).toEqual([expect.objectContaining({ code: 2026, enrolled: 1, inProgress: 1 })])
    expect(trajectory.focusYear).toBeNull()
  })
})

describe('loadSubjectsApe', () => {
  it('sin materias perdidas no hay APE que mirar, pero sí las previas del ciclo', async () => {
    prismaMock.studentPendingSubject.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ studentId: 'a', _count: { _all: 2 } }])
    prismaMock.studentEnrollment.findMany.mockResolvedValue([{ studentId: 'a' }])

    const result = await loadSubjectsApe('y26')

    expect(result.focusYear).toBeNull()
    expect(result.rows).toEqual([])
    expect(result.carriedOver).toEqual({ students: 1, subjects: 2 })
  })

  it('mira el último año con materias perdidas y ubica cada una en el curso de ese año', async () => {
    const Y25 = { ...YEAR, id: 'y25', code: 2025, status: 'CLOSED' }
    prismaMock.schoolYear.findMany.mockResolvedValue([Y25, YEAR])
    prismaMock.studentPendingSubject.groupBy
      .mockResolvedValueOnce([{ schoolYearId: 'y25', _count: { _all: 1 } }])
      .mockResolvedValueOnce([])
    prismaMock.studentPendingSubject.findMany.mockResolvedValue([
      { studentId: 'a', subjectId: 'mat', apeDecember: 'FAILED', apeFebruary: 'PASSED', resolvedAt: new Date(), subject: { name: 'Matemática' } },
    ])
    prismaMock.studentEnrollment.findMany.mockImplementation(async (args: any) =>
      args.where.schoolYearId === 'y25' ? [{ studentId: 'a', courseOffering: { course: { id: 'c7', name: '7 EBI' } } }] : [{ studentId: 'a' }],
    )

    const result = await loadSubjectsApe('y26')

    expect(result.focusYear).toMatchObject({ code: 2025 })
    expect(result.rows).toEqual([expect.objectContaining({ courseName: '7 EBI', subjectName: 'Matemática', february: 1 })])
    expect(result.students).toEqual({ referred: 1, clearedByFebruary: 1, clearedLater: 0, stillOwing: 0 })
  })
})
