import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, reportsMock, pushMock } = vi.hoisted(() => ({
  prismaMock: {
    studentAlert: { findMany: vi.fn(), createMany: vi.fn() },
    user: { findMany: vi.fn() },
    inAppNotification: { createMany: vi.fn() },
  },
  reportsMock: {
    loadAbsenceThresholds: vi.fn(),
    loadAbsenceStreaks: vi.fn(),
    loadAllGradeDrops: vi.fn(),
  },
  pushMock: vi.fn(),
}))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../webPush.js', () => ({ sendWebPushPayloadToUser: pushMock }))
vi.mock('./reports.js', () => reportsMock)
vi.mock('../school-year-service.js', () => ({ getActiveSchoolYearId: vi.fn().mockResolvedValue('sy-1') }))

import {
  collectAlertCandidates,
  MAX_INDIVIDUAL_NOTIFICATIONS,
  newAlerts,
  notificationsFor,
  scanStudentAlerts,
  type AlertCandidate,
} from './alerts-scan.js'

const student = { studentId: 'st-1', firstName: 'Ana', lastName: 'Díaz', courseName: '7 EBI' }

beforeEach(() => {
  vi.clearAllMocks()
  reportsMock.loadAbsenceThresholds.mockResolvedValue([])
  reportsMock.loadAbsenceStreaks.mockResolvedValue([])
  reportsMock.loadAllGradeDrops.mockResolvedValue([])
  prismaMock.studentAlert.findMany.mockResolvedValue([])
  prismaMock.studentAlert.createMany.mockImplementation(async ({ data }: any) => ({ count: data.length }))
  prismaMock.user.findMany.mockResolvedValue([{ id: 'adscripta' }, { id: 'direccion' }])
  prismaMock.inAppNotification.createMany.mockResolvedValue({ count: 0 })
  pushMock.mockResolvedValue({ sent: 1, failed: 0 })
})

const drop = {
  period: { id: 'e2', name: '2.ª Entrega' },
  previous: { id: 'e1', name: '1.ª Entrega' },
  rows: [{ ...student, subjectId: 'mat', subjectName: 'Matemática', previous: 800, current: 600 }],
}

describe('collectAlertCandidates', () => {
  it('una alerta por umbral alcanzado: la de 25 es otra, además de la de 18', async () => {
    reportsMock.loadAbsenceThresholds.mockResolvedValue([
      { ...student, absenceHundredths: 2550, threshold: 2500, reached: [1800, 2500] },
    ])
    const candidates = await collectAlertCandidates('sy-1')
    expect(candidates.map((c) => [c.type, c.key])).toEqual([
      ['ABSENCE_THRESHOLD', '18'],
      ['ABSENCE_THRESHOLD', '25'],
    ])
    expect(candidates[1].title).toBe('Díaz, Ana llegó a 25 faltas')
  })

  it('la racha se identifica por su día de inicio: si se alarga, no se avisa de nuevo', async () => {
    reportsMock.loadAbsenceStreaks.mockResolvedValue([{ ...student, from: '2026-10-05', to: '2026-10-07', days: 3, open: true }])
    const [candidate] = await collectAlertCandidates('sy-1')
    expect(candidate).toMatchObject({ type: 'ABSENCE_STREAK', key: '2026-10-05' })
    expect(candidate.body).toContain('sigue faltando')
  })

  it('la baja de boletín es por período y materia', async () => {
    reportsMock.loadAllGradeDrops.mockResolvedValue([drop])
    const [candidate] = await collectAlertCandidates('sy-1')
    expect(candidate).toMatchObject({ type: 'GRADE_DROP', key: 'e2:mat', title: 'Díaz, Ana bajó en Matemática' })
    expect(candidate.body).toBe('7 EBI: de 8 (1.ª Entrega) a 6 (2.ª Entrega).')
  })
})

describe('newAlerts / notificationsFor', () => {
  const candidate = (key: string): AlertCandidate => ({
    type: 'ABSENCE_THRESHOLD',
    studentId: 'st-1',
    key,
    title: `t${key}`,
    body: 'b',
    payload: {},
  })

  it('descarta lo que ya se avisó y los duplicados', () => {
    const fresh = newAlerts([candidate('18'), candidate('25'), candidate('25')], [{ type: 'ABSENCE_THRESHOLD', studentId: 'st-1', key: '18' }])
    expect(fresh.map((a) => a.key)).toEqual(['25'])
  })

  it('una notificación por alerta, o un resumen si son muchas', () => {
    expect(notificationsFor([candidate('18')])).toEqual([{ title: 't18', body: 'b', actionUrl: '/admin/student-attendance?tab=faltas' }])
    const many = Array.from({ length: MAX_INDIVIDUAL_NOTIFICATIONS + 1 }, (_, i) => candidate(String(i)))
    const [summary] = notificationsFor(many)
    expect(notificationsFor(many)).toHaveLength(1)
    expect(summary.title).toBe(`${many.length} alertas nuevas de faltas`)
  })

  it('las bajas de nota no avisan: sólo faltas seguidas y 18/25', () => {
    const gradeDrop: AlertCandidate = { ...candidate('e2:mat'), type: 'GRADE_DROP' }
    const streak: AlertCandidate = { ...candidate('2026-10-05'), type: 'ABSENCE_STREAK', title: 'racha' }
    expect(notificationsFor([gradeDrop])).toEqual([])
    expect(notificationsFor([gradeDrop, streak, candidate('18')]).map((n) => n.title)).toEqual(['racha', 't18'])
  })

  it('cada aviso lleva a su pestaña de Asistencia de estudiantes', () => {
    const streak: AlertCandidate = { ...candidate('2026-10-05'), type: 'ABSENCE_STREAK' }
    expect(notificationsFor([streak])[0].actionUrl).toBe('/admin/student-attendance?tab=seguidas')
    expect(notificationsFor([candidate('18')])[0].actionUrl).toBe('/admin/student-attendance?tab=faltas')
    const many = Array.from({ length: MAX_INDIVIDUAL_NOTIFICATIONS + 1 }, (_, i) => candidate(String(i)))
    expect(notificationsFor(many)[0].actionUrl).toBe('/admin/student-attendance?tab=faltas')
  })

  it('el resumen cuenta sólo las de faltas', () => {
    const drops = Array.from({ length: MAX_INDIVIDUAL_NOTIFICATIONS + 3 }, (_, i): AlertCandidate => ({
      ...candidate(`d${i}`),
      type: 'GRADE_DROP',
    }))
    expect(notificationsFor([...drops, candidate('18')])).toHaveLength(1)
    expect(notificationsFor([...drops, candidate('18')])[0].title).toBe('t18')
  })
})

describe('scanStudentAlerts', () => {
  beforeEach(() => {
    reportsMock.loadAbsenceThresholds.mockResolvedValue([{ ...student, absenceHundredths: 1800, threshold: 1800, reached: [1800] }])
  })

  it('guarda la alerta nueva y avisa a adscripción y dirección', async () => {
    const result = await scanStudentAlerts('sy-1')

    expect(result.created).toBe(1)
    expect(prismaMock.studentAlert.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ schoolYearId: 'sy-1', studentId: 'st-1', type: 'ABSENCE_THRESHOLD', key: '18' }),
    ])
    expect(prismaMock.user.findMany.mock.calls[0][0].where.orgRole).toEqual({ code: { in: ['DIRECCION', 'ADSCRIPTO'] } })
    const notifications = prismaMock.inAppNotification.createMany.mock.calls[0][0].data
    expect(notifications.map((n: any) => n.userId)).toEqual(['adscripta', 'direccion'])
    expect(notifications[0]).toMatchObject({ type: 'STUDENT_ALERT', title: 'Díaz, Ana llegó a 18 faltas' })
  })

  it('también les llega por push', async () => {
    await scanStudentAlerts('sy-1')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(pushMock.mock.calls.map(([userId]) => userId)).toEqual(['adscripta', 'direccion'])
    expect(pushMock.mock.calls[0][1]).toMatchObject({
      title: 'Díaz, Ana llegó a 18 faltas',
      url: '/admin/student-attendance?tab=faltas',
    })
  })

  it('una baja de nota se guarda (sigue en Reportes) pero no avisa', async () => {
    reportsMock.loadAbsenceThresholds.mockResolvedValue([])
    reportsMock.loadAllGradeDrops.mockResolvedValue([drop])

    expect((await scanStudentAlerts('sy-1')).created).toBe(1)
    expect(prismaMock.studentAlert.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ type: 'GRADE_DROP', key: 'e2:mat' }),
    ])
    expect(prismaMock.inAppNotification.createMany).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('no avisa dos veces lo mismo', async () => {
    prismaMock.studentAlert.findMany.mockResolvedValue([{ type: 'ABSENCE_THRESHOLD', studentId: 'st-1', key: '18' }])

    expect((await scanStudentAlerts('sy-1')).created).toBe(0)
    expect(prismaMock.studentAlert.createMany).not.toHaveBeenCalled()
    expect(prismaMock.inAppNotification.createMany).not.toHaveBeenCalled()
  })

  it('las alertas ya avisadas se buscan en el ciclo: las 18 faltas del año pasado no silencian las de este', async () => {
    await scanStudentAlerts('sy-2027')

    expect(prismaMock.studentAlert.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ schoolYearId: 'sy-2027' }),
    )
    expect(prismaMock.studentAlert.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ schoolYearId: 'sy-2027', type: 'ABSENCE_THRESHOLD', key: '18' }),
    ])
  })
})
