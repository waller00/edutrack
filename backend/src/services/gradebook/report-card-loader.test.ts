import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, absencesMock } = vi.hoisted(() => ({
  prismaMock: {
    courseOffering: { findUnique: vi.fn() },
    courseOrientation: { findUnique: vi.fn() },
    orientation: { findUnique: vi.fn() },
    gradeBook: { findMany: vi.fn() },
    gradeBookPeriod: { findMany: vi.fn() },
    academicPeriod: { findMany: vi.fn() },
    teacherMeetingRecord: { findMany: vi.fn() },
  },
  absencesMock: vi.fn(),
}))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../student-attendance/absence-totals.js', () => ({ loadAbsenceTotals: absencesMock }))

import { loadReportCards, type ReportCardPeriod } from './report-card-loader.js'

const book = (id: string, name: string, sortOrder: number, courseOrientationId: string | null = null) => ({
  id,
  courseOfferingId: 'off-1',
  courseOrientationId,
  orientationId: null,
  subject: { name, sortOrder },
})

const day = (ymd: string) => new Date(`${ymd}T12:00:00Z`)

const ENTREGA: ReportCardPeriod = {
  id: 'p-e3',
  name: '3.ª Entrega (3.ª Reunión)',
  level: 'EBI',
  kind: 'ENTREGA',
  sortOrder: 80,
  startsOn: day('2026-09-15'),
  endsOn: day('2026-10-15'),
  judgementLabel: 'Informe de actuación',
}

const STUDENT = { id: 'st-1', firstName: 'Orazio', lastName: 'Liesegang Rodríguez' }
const GROUP = { schoolYearId: 'sy-1', courseOfferingId: 'off-1', courseOrientationId: null, orientationId: null }

describe('loadReportCards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.courseOffering.findUnique.mockResolvedValue({ course: { name: '7.º', level: 'EBI' }, schoolYear: { label: '2026' } })
    prismaMock.gradeBook.findMany.mockResolvedValue([
      book('gb-hist', 'Historia', 20),
      book('gb-mat', 'Matemática', 10),
      book('gb-otra', 'Biología', 5, 'co-otra'),
    ])
    prismaMock.academicPeriod.findMany.mockResolvedValue([
      { id: 'p-agoset', kind: 'TRAMO', sortOrder: 70, startsOn: day('2026-08-01'), endsOn: day('2026-09-30') },
      ENTREGA,
    ])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      {
        gradeBookId: 'gb-mat',
        status: 'CLOSED',
        grades: [{ studentId: 'st-1', valueHundredths: 900, meetingValueHundredths: 800, conceptualJudgement: 'Muy bien.', conductValueHundredths: 600 }],
      },
      // Historia tiene notas, pero el docente todavía no cerró: no van al boletín.
      { gradeBookId: 'gb-hist', status: 'OPEN', grades: [{ studentId: 'st-1', meetingValueHundredths: 700 }] },
    ])
    prismaMock.teacherMeetingRecord.findMany.mockResolvedValue([
      { studentId: null, decision: 'Del grupo.', createdAt: new Date('2026-10-01') },
      { studentId: 'st-1', decision: 'Valoramos su cambio de actitud.', createdAt: new Date('2026-10-02') },
    ])
    absencesMock.mockResolvedValue(
      new Map([['st-1', { absenceHundredths: 250, justified: 1, lates: 0, counts: { justified: 1, unjustified: 2, lates: 0 } }]]),
    )
  })

  it('arma el boletín de la planilla: cierre, juicio de reunión y faltas del período', async () => {
    const [card] = await loadReportCards({ group: GROUP, period: ENTREGA, students: [STUDENT] })

    expect(card.group).toEqual({ courseName: '7.º', orientationName: null, schoolYearLabel: '2026' })
    expect(card.period).toEqual({ name: ENTREGA.name, columnLabel: 'Ago-Set', judgementLabel: 'Informe de actuación' })
    // Tronco común en el orden de la planilla; la de otra orientación no entra.
    expect(card.subjects.map((s) => s.subjectName)).toEqual(['Matemática', 'Historia'])
    expect(card.subjects[0]).toMatchObject({ closed: true, conductValueHundredths: 600, valueHundredths: 800, conceptualJudgement: 'Muy bien.' })
    expect(card.subjects[1]).toMatchObject({ closed: false, valueHundredths: null })
    expect(card.meetingJudgement).toBe('Valoramos su cambio de actitud.')
    expect(card.attendance).toEqual({ absenceHundredths: 250, justified: 1, unjustified: 2, lates: 0, untilYmd: '2026-09-30' })
    expect(card.absenceTotal).toBe(2)
  })

  it('las faltas son las del año hasta el fin del tramo que informa la entrega', async () => {
    // El límite del reglamento es por grado: la familia necesita el acumulado, no el del período.
    await loadReportCards({ group: GROUP, period: ENTREGA, students: [STUDENT] })
    expect(absencesMock).toHaveBeenCalledWith(['st-1'], 'sy-1', 'EBI', '2026-09-30')
  })

  it('el juicio de reunión es del grupo del alumno: oferta, período y orientación', async () => {
    await loadReportCards({ group: { ...GROUP, courseOrientationId: 'co-1' }, period: ENTREGA, students: [STUDENT] })
    expect(prismaMock.teacherMeetingRecord.findMany.mock.calls[0][0].where).toEqual({
      courseOfferingId: 'off-1',
      periodId: 'p-e3',
      OR: [{ studentId: { in: ['st-1'] } }, { studentId: null, courseOrientationId: 'co-1' }],
    })
  })

  it('un estudiante sin notas ni faltas igual tiene boletín', async () => {
    const [card] = await loadReportCards({ group: GROUP, period: ENTREGA, students: [{ ...STUDENT, id: 'st-2' }] })
    expect(card.subjects.every((s) => s.valueHundredths == null)).toBe(true)
    expect(card.meetingJudgement).toBe('Del grupo.')
    expect(card.attendance).toEqual({ absenceHundredths: 0, justified: 0, unjustified: 0, lates: 0, untilYmd: '2026-09-30' })
    expect(card.absenceTotal).toBe(0)
  })
})
