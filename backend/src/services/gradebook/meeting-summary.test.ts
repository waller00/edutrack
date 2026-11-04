import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, rosterMock } = vi.hoisted(() => ({
  prismaMock: {
    academicPeriod: { findMany: vi.fn() },
    gradeBookPeriod: { findMany: vi.fn() },
    assessment: { findMany: vi.fn() },
  },
  rosterMock: vi.fn(),
}))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../student-attendance/roster.js', () => ({ loadRosterForScope: rosterMock }))

import { loadMeetingSummaries, summarizeMeeting } from './meeting-summary.js'

const ENTREGA = {
  id: 'e1',
  name: '1.ª Entrega',
  kind: 'ENTREGA',
  sortOrder: 30,
  level: 'EBI',
  schoolYearId: 'y26',
  isMeeting: true,
  requiresGeneralGrade: true,
  requiresConceptualJudgement: true,
  closesOn: new Date('2026-05-14T12:00:00Z'),
  judgementLabel: null,
}
const TRAMO = { ...ENTREGA, id: 't1', name: 'Marzo-Abril', kind: 'TRAMO', sortOrder: 20, isMeeting: false, requiresGeneralGrade: false, requiresConceptualJudgement: false, closesOn: null }
const roster = [
  { studentId: 'ana', firstName: 'Ana', lastName: 'Pérez', studentEnrollmentId: 'e-a', documentId: null },
  { studentId: 'beto', firstName: 'Beto', lastName: 'Gómez', studentEnrollmentId: 'e-b', documentId: null },
]
const full = (studentId: string) => ({ studentId, meetingValueHundredths: 800, conductValueHundredths: 800, conceptualJudgement: 'Bien.' })
const state = (over: Record<string, unknown> = {}) => ({
  gradeBookId: 'gb1',
  periodId: 'e1',
  status: 'OPEN',
  closedAt: null,
  closedLate: false,
  reopenReason: null,
  groupReport: 'El grupo trabajó bien.',
  grades: [full('ana'), full('beto')],
  endorsements: [],
  ...over,
})
const groupTest = (graded: string[]) => ({
  gradeBookId: 'gb1',
  periodId: 't1',
  scope: 'GROUP' as const,
  grades: graded.map((studentId) => ({ studentId, valueHundredths: 700, scaleLevelId: null, isAbsent: false })),
})

describe('summarizeMeeting', () => {
  it('lista para cerrar: nada falta', () => {
    const row = summarizeMeeting({ period: ENTREGA, assessmentPeriodIds: ['t1'], roster, state: state(), assessments: [groupTest(['ana', 'beto'])] })
    expect(row).toMatchObject({ status: 'OPEN', missing: [], reportCard: true, closesOn: '2026-05-14', review: { overallStatus: 'PENDING' } })
  })

  it('cuenta lo que falta de los tramos que informa, con quiénes', () => {
    const row = summarizeMeeting({ period: ENTREGA, assessmentPeriodIds: ['t1'], roster, state: state({ grades: [full('ana')] }), assessments: [groupTest(['ana'])] })
    expect(row.missing?.map((b) => [b.code, b.studentIds])).toEqual([
      ['MISSING_ASSESSMENT_GRADES', ['beto']],
      ['MISSING_GRADES', ['beto']],
      ['MISSING_CONDUCT', ['beto']],
      ['MISSING_JUDGEMENT', ['beto']],
    ])
  })

  it('sin fila todavía, está abierta y le falta todo; cerrada no tiene faltantes', () => {
    expect(summarizeMeeting({ period: ENTREGA, assessmentPeriodIds: [], roster, state: undefined, assessments: [] })).toMatchObject({ status: 'OPEN', review: null })
    expect(summarizeMeeting({ period: ENTREGA, assessmentPeriodIds: ['t1'], roster, state: state({ status: 'CLOSED', closedAt: new Date('2026-05-13T15:00:00Z') }), assessments: [] })).toMatchObject({
      status: 'CLOSED',
      missing: null,
      closedAt: '2026-05-13T15:00:00.000Z',
    })
  })

  it('el motivo de reapertura sólo mientras está reabierta', () => {
    const reopened = summarizeMeeting({ period: ENTREGA, assessmentPeriodIds: [], roster, state: state({ status: 'REOPENED', reopenReason: 'Faltó un juicio' }), assessments: [] })
    expect(reopened.reopenReason).toBe('Faltó un juicio')
  })
})

describe('loadMeetingSummaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.academicPeriod.findMany.mockResolvedValue([TRAMO, ENTREGA])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([state()])
    prismaMock.assessment.findMany.mockResolvedValue([groupTest(['ana', 'beto'])])
    rosterMock.mockResolvedValue(roster)
  })

  const book = (id: string, courseOfferingId = 'o1') => ({ id, schoolYearId: 'y26', courseOfferingId, orientationId: null, courseOrientationId: null, level: 'EBI' })

  it('las mismas consultas para una libreta que para varias, y un roster por grupo', async () => {
    const { byBook } = await loadMeetingSummaries([book('gb1'), book('gb2'), book('gb3', 'o2')])
    expect(prismaMock.academicPeriod.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.gradeBookPeriod.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.assessment.findMany).toHaveBeenCalledTimes(1)
    expect(rosterMock).toHaveBeenCalledTimes(2)
    expect(byBook.get('gb1')?.map((m) => [m.name, m.missing?.length])).toEqual([['1.ª Entrega', 0]])
    // gb2 no tiene fila ni evaluaciones: le falta todo.
    expect(byBook.get('gb2')?.[0].missing?.map((b) => b.code)).toContain('NO_ASSESSMENTS')
    expect(prismaMock.assessment.findMany.mock.calls[0][0].where.periodId).toEqual({ in: ['t1'] })
  })

  it('sin libretas no consulta nada', async () => {
    const result = await loadMeetingSummaries([])
    expect(result.byBook.size).toBe(0)
    expect(prismaMock.academicPeriod.findMany).not.toHaveBeenCalled()
  })
})
