import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, rosterMock } = vi.hoisted(() => ({
  prismaMock: {
    academicPeriod: { findUnique: vi.fn(), findMany: vi.fn() },
    gradeBook: { findMany: vi.fn() },
    gradingScale: { findFirst: vi.fn() },
    studentEnrollment: { findMany: vi.fn() },
    studentAttendanceEntry: { findMany: vi.fn() },
    studentAttendanceSession: { findMany: vi.fn() },
  },
  rosterMock: vi.fn(),
}))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../student-attendance/roster.js', () => ({ loadRosterForScope: rosterMock }))
vi.mock('../../config/system-settings.js', () => ({
  getStudentRollCallSettings: vi.fn().mockResolvedValue({ dailyAbsenceThresholdPercent: 50 }),
}))

import { loadAbsenceStreaks, loadGradeDrops, loadLowGrades } from './reports.js'

const boletin = { isMeeting: true, requiresGeneralGrade: true, requiresConceptualJudgement: true }
const E1 = { id: 'e1', name: '1.ª Entrega', level: 'EBI', schoolYearId: 'sy-1', kind: 'ENTREGA', sortOrder: 4, ...boletin }
const E2 = { ...E1, id: 'e2', name: '2.ª Entrega', sortOrder: 8 }
const bookLabels = {
  subjectId: 'mat',
  subject: { id: 'mat', name: 'Matemática' },
  orientation: null,
  courseOrientation: null,
  courseOffering: { id: 'off-1', course: { name: '7 EBI' } },
  schoolYearId: 'sy-1',
  courseOfferingId: 'off-1',
  orientationId: null,
  courseOrientationId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadLowGrades', () => {
  it('cuenta como baja la banda de alerta de la escala del nivel, sobre la R', async () => {
    prismaMock.academicPeriod.findUnique.mockResolvedValue(E1)
    prismaMock.gradingScale.findFirst.mockResolvedValue({
      levels: [
        { id: 'l1', label: 'Insuficiente', descriptor: null, minValueHundredths: 100, maxValueHundredths: 499, colorToken: null, iconToken: null, isPassing: false, isAlert: true },
        { id: 'l2', label: 'Suficiente', descriptor: null, minValueHundredths: 500, maxValueHundredths: 1000, colorToken: null, iconToken: null, isPassing: true, isAlert: false },
      ],
    })
    rosterMock.mockResolvedValue([{ studentId: 'a' }, { studentId: 'b' }, { studentId: 'c' }])
    prismaMock.gradeBook.findMany.mockResolvedValue([
      {
        ...bookLabels,
        periods: [
          {
            grades: [
              { studentId: 'a', meetingValueHundredths: 300 },
              { studentId: 'b', meetingValueHundredths: 800 },
              // Sin R no cuenta, aunque tenga C.
              { studentId: 'c', meetingValueHundredths: null },
            ],
          },
        ],
      },
    ])

    const result = await loadLowGrades('e1')

    expect(prismaMock.gradeBook.findMany.mock.calls[0][0].where.courseOffering).toEqual({ isOffered: true, course: { level: 'EBI' } })
    expect(result?.rows[0]).toMatchObject({ subjectName: 'Matemática', graded: 2, low: 1, percent: 50, pending: 1 })
  })

  it('sólo acepta reuniones de boletín', async () => {
    prismaMock.academicPeriod.findUnique.mockResolvedValue({ ...E1, requiresConceptualJudgement: false })
    expect(await loadLowGrades('exd')).toBeNull()
  })
})

describe('loadGradeDrops', () => {
  it('compara la R con la del boletín anterior del mismo nivel', async () => {
    prismaMock.academicPeriod.findUnique.mockResolvedValue(E2)
    prismaMock.academicPeriod.findMany.mockResolvedValue([E1, { ...E1, id: 'tramo', kind: 'TRAMO', sortOrder: 6, isMeeting: false }, E2])
    const grade = (studentId: string, value: number | null) => ({
      studentId,
      meetingValueHundredths: value,
      studentFirstName: studentId.toUpperCase(),
      studentLastName: 'X',
    })
    prismaMock.gradeBook.findMany.mockResolvedValue([
      {
        ...bookLabels,
        periods: [
          { periodId: 'e1', grades: [grade('a', 800), grade('b', 600), grade('c', 700)] },
          { periodId: 'e2', grades: [grade('a', 600), grade('b', 900), grade('c', null)] },
        ],
      },
    ])

    const result = await loadGradeDrops('e2')

    expect(result?.previous).toEqual({ id: 'e1', name: '1.ª Entrega' })
    expect(prismaMock.gradeBook.findMany.mock.calls[0][0].include.periods.where).toEqual({ periodId: { in: ['e1', 'e2'] } })
    expect(result?.rows).toEqual([
      expect.objectContaining({ studentId: 'a', subjectName: 'Matemática', previous: 800, current: 600 }),
    ])
  })

  it('el primer boletín no tiene con qué compararse', async () => {
    prismaMock.academicPeriod.findUnique.mockResolvedValue(E1)
    prismaMock.academicPeriod.findMany.mockResolvedValue([E1, E2])
    const result = await loadGradeDrops('e1')
    expect(result).toMatchObject({ previous: null, rows: [] })
    expect(prismaMock.gradeBook.findMany).not.toHaveBeenCalled()
  })
})

describe('loadAbsenceStreaks', () => {
  const enrollment = (studentId: string, level: string) => ({
    studentId,
    courseOfferingId: 'off-1',
    courseOrientationId: null,
    student: { firstName: studentId, lastName: 'X' },
    courseOffering: { course: { name: '7 EBI', level } },
  })
  const mark = (studentId: string, ymd: string, status = 'ABSENT') => ({ studentId, status, session: { occurrenceYmd: ymd } })
  const days = ['2026-10-08', '2026-10-09', '2026-10-12']

  beforeEach(() => {
    prismaMock.studentAttendanceSession.findMany.mockResolvedValue(
      days.map((occurrenceYmd) => ({ courseOfferingId: 'off-1', courseOrientationId: null, occurrenceYmd })),
    )
  })

  it('ciclo básico: faltar a una clase del día ya cuenta, y el fin de semana no corta', async () => {
    prismaMock.studentEnrollment.findMany.mockResolvedValue([enrollment('a', 'EBI')])
    prismaMock.studentAttendanceEntry.findMany
      .mockResolvedValueOnce(days.map((d) => mark('a', d)))
      .mockResolvedValueOnce([...days.map((d) => mark('a', d)), ...days.map((d) => mark('a', d, 'PRESENT'))])

    const rows = await loadAbsenceStreaks('sy-1')
    expect(rows).toEqual([expect.objectContaining({ studentId: 'a', from: '2026-10-08', to: '2026-10-12', days: 3, open: true })])
  })

  it('bachillerato: con una sola clase faltada de cuatro el día no es falta entera', async () => {
    prismaMock.studentEnrollment.findMany.mockResolvedValue([enrollment('a', 'EMS')])
    const oneOfFour = (d: string) => [mark('a', d), mark('a', d, 'PRESENT'), mark('a', d, 'PRESENT'), mark('a', d, 'PRESENT')]
    prismaMock.studentAttendanceEntry.findMany
      .mockResolvedValueOnce(days.map((d) => mark('a', d)))
      .mockResolvedValueOnce(days.flatMap(oneOfFour))

    expect(await loadAbsenceStreaks('sy-1')).toEqual([])
  })

  it('una falta justificada no suma a la racha', async () => {
    prismaMock.studentEnrollment.findMany.mockResolvedValue([enrollment('a', 'EBI')])
    const absent = [mark('a', days[0]), mark('a', days[2])]
    prismaMock.studentAttendanceEntry.findMany
      .mockResolvedValueOnce(absent)
      .mockResolvedValueOnce([...absent, mark('a', days[1], 'ABSENT_JUSTIFIED')])

    expect(await loadAbsenceStreaks('sy-1')).toEqual([])
  })
})
