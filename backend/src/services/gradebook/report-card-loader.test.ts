import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, absencesMock } = vi.hoisted(() => ({
  prismaMock: {
    courseOffering: { findUnique: vi.fn() },
    courseOrientation: { findUnique: vi.fn() },
    orientation: { findUnique: vi.fn() },
    gradeBook: { findMany: vi.fn() },
    gradeBookPeriod: { findMany: vi.fn() },
    gradingScale: { findFirst: vi.fn() },
    studentConductRecord: { findMany: vi.fn() },
  },
  absencesMock: vi.fn(),
}))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../student-attendance/absence-totals.js', () => ({ loadAbsenceTotals: absencesMock }))

import { loadReportCards } from './report-card-loader.js'

const PERFORMANCE = {
  decimals: 0,
  levels: [
    { id: 'bajo', label: 'Insuficiente', minValueHundredths: 100, maxValueHundredths: 599, isAlert: true },
    { id: 'alto', label: 'Logrado', minValueHundredths: 600, maxValueHundredths: 1200, isAlert: false },
  ],
}
const CONDUCT = {
  levels: [
    { id: 'b', label: 'Buena', minValueHundredths: 300, maxValueHundredths: 300 },
    { id: 'mb', label: 'Muy buena', minValueHundredths: 400, maxValueHundredths: 400 },
  ],
}

const book = (id: string, name: string, sortOrder: number, courseOrientationId: string | null = null) => ({
  id,
  courseOfferingId: 'off-1',
  courseOrientationId,
  orientationId: null,
  subject: { name, sortOrder },
  teacher: { name: 'Ana G' },
})

const STUDENT = { id: 'st-1', firstName: 'Ana', lastName: 'Díaz', documentId: null, birthDate: null }

describe('loadReportCards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.courseOffering.findUnique.mockResolvedValue({ course: { name: '5.º', level: 'EMS' }, schoolYear: { label: '2026' } })
    prismaMock.courseOrientation.findUnique.mockResolvedValue({ orientation: { name: 'Científico' } })
    prismaMock.gradeBook.findMany.mockResolvedValue([
      book('gb-hist', 'Historia', 20),
      book('gb-mat', 'Matemática', 10),
      book('gb-otra', 'Biología', 5, 'co-otra'),
    ])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      {
        gradeBookId: 'gb-mat',
        grades: [{ studentId: 'st-1', valueHundredths: 900, meetingValueHundredths: 500, conceptualJudgement: 'Bien.', conductValueHundredths: 400 }],
      },
      { gradeBookId: 'gb-hist', grades: [{ studentId: 'st-1', valueHundredths: 800, meetingValueHundredths: null }] },
    ])
    prismaMock.gradingScale.findFirst.mockImplementation(async (args: any) => (args.where.code === 'CONDUCTA' ? CONDUCT : PERFORMANCE))
    prismaMock.studentConductRecord.findMany.mockResolvedValue([{ studentId: 'st-1', valueHundredths: 300 }])
    absencesMock.mockResolvedValue(new Map([['st-1', { absenceHundredths: 150, justified: 1, lates: 0 }]]))
  })

  it('arma el boletín con la nota de reunión, la conducta de la escala y las faltas', async () => {
    const { cards } = await loadReportCards({
      group: { schoolYearId: 'sy-1', courseOfferingId: 'off-1', courseOrientationId: 'co-1', orientationId: null },
      period: { id: 'p-1', name: '1.ª Entrega' },
      students: [STUDENT],
    })

    const card = cards[0]
    expect(card.group).toEqual({ courseName: '5.º', orientationName: 'Científico', schoolYearLabel: '2026' })
    // Tronco común más su orientación, en el orden de la planilla; la de otra orientación no entra.
    expect(card.subjects.map((s) => s.subjectName)).toEqual(['Matemática', 'Historia'])
    // Va R, no C: Matemática tiene C 9 y R 5.
    expect(card.subjects[0]).toMatchObject({ valueHundredths: 500, descriptor: 'Insuficiente', conductLabel: '4' })
    // Sin R la materia queda pendiente aunque haya C.
    expect(card.subjects[1]).toMatchObject({ valueHundredths: null, descriptor: null })
    expect(card.conductLabel).toBe('3')
    expect(card.attendance).toEqual({ absenceHundredths: 150, justifiedCount: 1 })
    expect(card.averageHundredths).toBe(500)
    expect(card.pendingCount).toBe(1)
  })

  it('un estudiante sin notas igual tiene boletín, todo pendiente', async () => {
    const { cards } = await loadReportCards({
      group: { schoolYearId: 'sy-1', courseOfferingId: 'off-1', courseOrientationId: null, orientationId: null },
      period: { id: 'p-1', name: '1.ª Entrega' },
      students: [{ ...STUDENT, id: 'st-2' }],
    })
    expect(cards[0].subjects.every((s) => s.valueHundredths == null)).toBe(true)
    expect(cards[0].conductLabel).toBeNull()
    expect(cards[0].attendance.absenceHundredths).toBe(0)
  })
})
