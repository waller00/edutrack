import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { signAccessToken } from '../test-utils/bearer-token.js'

const { prismaMock, rosterMock, saveGradesMock, notifyMock, auditMock } = vi.hoisted(() => ({
  prismaMock: {
    gradeBook: { findUnique: vi.fn() },
    assessment: { findFirst: vi.fn() },
    academicPeriod: { findFirst: vi.fn() },
    gradeBookPeriod: { upsert: vi.fn() },
    gradingScale: { findFirst: vi.fn() },
    periodGrade: { findMany: vi.fn(), upsert: vi.fn() },
    periodGradeRevision: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  rosterMock: vi.fn(),
  saveGradesMock: vi.fn(),
  notifyMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/student-attendance/roster.js', () => ({ loadRosterForScope: rosterMock }))
vi.mock('../services/audit-log.js', () => ({ recordAuditEventNow: auditMock }))
vi.mock('../services/gradebook/grading.js', async () => {
  const actual = await vi.importActual<any>('../services/gradebook/grading.js')
  return { ...actual, saveGrades: saveGradesMock }
})
vi.mock('../services/gradebook/notifications.js', async () => {
  const actual = await vi.importActual<any>('../services/gradebook/notifications.js')
  return { ...actual, notifyGradeBook: notifyMock, resolveGradeBookRecipients: vi.fn().mockResolvedValue([{ userId: 't-1' }]) }
})

import correctionsRoutes, { correctionsGuard } from './admin-gradebook-corrections.js'
import { GradingError } from '../services/gradebook/grading.js'
import { authGuard } from '../middlewares/auth.js'

function app() {
  const a = express()
  a.use(express.json())
  a.use(cookieParser())
  a.use('/admin/gradebook/corrections', authGuard, correctionsGuard, correctionsRoutes)
  return a
}

const tok = (role = 'ADMIN', sub = 'a-1') => signAccessToken({ sub, email: 'a@a.com', role: role as 'ADMIN' })

const GB = '11111111-1111-4111-8111-111111111111'
const AS = '22222222-2222-4222-8222-222222222222'
const ST = '33333333-3333-4333-8333-333333333333'
const PE = '44444444-4444-4444-8444-444444444444'

const assessmentUrl = `/admin/gradebook/corrections/gradebooks/${GB}/assessments/${AS}/students/${ST}`
const periodUrl = `/admin/gradebook/corrections/gradebooks/${GB}/periods/${PE}/students/${ST}`

const BOOK = {
  id: GB,
  status: 'ACTIVE',
  schoolYearId: 'sy-1',
  courseOfferingId: 'off-1',
  orientationId: null,
  courseOrientationId: null,
  subject: { name: 'Matemática' },
  courseOffering: { course: { level: 'EBI' } },
}
const STUDENT = { studentId: ST, studentEnrollmentId: 'e-1', firstName: 'Ana', lastName: 'Pérez', documentId: null }

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.gradeBook.findUnique.mockResolvedValue(BOOK)
  rosterMock.mockResolvedValue([STUDENT])
  prismaMock.assessment.findFirst.mockResolvedValue({
    id: AS,
    title: 'Escrito 2',
    gradingScale: { id: 'sc', kind: 'NUMERIC', minValueHundredths: 100, maxValueHundredths: 1000, levels: [] },
    period: { name: '2.º tramo' },
    grades: [{ valueHundredths: 300, isAbsent: false, comment: null }],
  })
  saveGradesMock.mockResolvedValue({ created: 0, updated: 1, unchanged: 0, revisions: 1 })
  prismaMock.academicPeriod.findFirst.mockResolvedValue({ id: PE, name: '1.ª Entrega' })
  prismaMock.gradingScale.findFirst.mockResolvedValue({ minValueHundredths: 100, maxValueHundredths: 1000, levels: [] })
  prismaMock.gradeBookPeriod.upsert.mockResolvedValue({ id: 'gbp-1', status: 'CLOSED' })
  prismaMock.periodGrade.findMany.mockResolvedValue([
    { studentId: ST, valueHundredths: null, meetingValueHundredths: 500, conductValueHundredths: 700, conceptualJudgement: 'Bien.' },
  ])
  prismaMock.periodGrade.upsert.mockResolvedValue({})
  prismaMock.periodGradeRevision.create.mockResolvedValue({})
  prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock))
})

describe('corregir una nota de una evaluación', () => {
  it('administración corrige con motivo: queda como corrección, se audita y se avisa al docente', async () => {
    const res = await request(app())
      .put(assessmentUrl)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ valueHundredths: 700, comment: 'Se había cargado mal.', reason: 'Error de carga visto en la reunión' })

    expect(res.status).toBe(200)
    expect(saveGradesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: AS,
        entries: [{ studentId: ST, valueHundredths: 700, scaleLevelId: null, isAbsent: false, comment: 'Se había cargado mal.' }],
        roster: [STUDENT],
        origin: 'ADMIN_CORRECTION',
        reason: 'Error de carga visto en la reunión',
      }),
    )
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      action: 'GRADE_CORRECTED',
      entityType: 'Assessment',
      metadata: { reason: 'Error de carga visto en la reunión', before: { valueHundredths: 300 } },
    })
    expect(notifyMock.mock.calls[0][1]).toMatchObject({
      type: 'GRADEBOOK_GRADE_CORRECTED',
      title: 'Administración corrigió la nota de «Escrito 2» de Pérez, Ana',
    })
  })

  it('«No rindió» borra el valor', async () => {
    await request(app())
      .put(assessmentUrl)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ valueHundredths: 700, isAbsent: true, reason: 'Faltó a la prueba' })
    expect(saveGradesMock.mock.calls[0][0].entries[0]).toMatchObject({ valueHundredths: null, isAbsent: true })
  })

  it('sin motivo no se corrige', async () => {
    const res = await request(app()).put(assessmentUrl).set('Authorization', `Bearer ${tok()}`).send({ valueHundredths: 700, reason: ' ' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Escribí el motivo de la corrección.')
    expect(saveGradesMock).not.toHaveBeenCalled()
  })

  it('un valor fuera de la escala lo rechaza la validación de siempre', async () => {
    saveGradesMock.mockRejectedValue(new GradingError(400, 'VALUE_OUT_OF_SCALE', 'Fuera de la escala.'))
    const res = await request(app()).put(assessmentUrl).set('Authorization', `Bearer ${tok()}`).send({ valueHundredths: 1500, reason: 'Corrección' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALUE_OUT_OF_SCALE')
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('un alumno que no es de la libreta da 404', async () => {
    rosterMock.mockResolvedValue([])
    const res = await request(app()).put(assessmentUrl).set('Authorization', `Bearer ${tok()}`).send({ valueHundredths: 700, reason: 'Corrección' })
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('STUDENT_NOT_IN_ROSTER')
  })

  it('un ciclo cerrado es de sólo lectura, también para administración', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue({ ...BOOK, status: 'ARCHIVED' })
    const res = await request(app()).put(assessmentUrl).set('Authorization', `Bearer ${tok()}`).send({ valueHundredths: 700, reason: 'Corrección' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ARCHIVED')
  })

  it.each([
    ['DIRECCION', 'd-1'],
    ['ADSCRIPTO', 'ad-1'],
    ['TEACHER', 't-1'],
  ])('%s no corrige: ve la libreta y no la edita', async (role, sub) => {
    const res = await request(app()).put(assessmentUrl).set('Authorization', `Bearer ${tok(role, sub)}`).send({ valueHundredths: 700, reason: 'Corrección' })
    expect(res.status).toBe(403)
    expect(saveGradesMock).not.toHaveBeenCalled()
  })
})

describe('corregir la R, la C o el juicio del docente', () => {
  it('corrige con la libreta cerrada sin reabrirla, y la revisión guarda el motivo', async () => {
    const res = await request(app())
      .put(periodUrl)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ meetingValueHundredths: 600, conceptualJudgement: 'Mejoró en el tramo.', reason: 'El docente pidió corregir en la reunión' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, revisions: 1, periodStatus: 'CLOSED' })
    // El estado del período no se toca.
    expect(prismaMock.gradeBookPeriod.upsert.mock.calls[0][0].update).toEqual({})
    expect(prismaMock.periodGrade.upsert.mock.calls[0][0].update).toMatchObject({ meetingValueHundredths: 600, conceptualJudgement: 'Mejoró en el tramo.' })
    // La C no se mandó: no se pisa.
    expect(prismaMock.periodGrade.upsert.mock.calls[0][0].update).not.toHaveProperty('conductValueHundredths')
    expect(prismaMock.periodGradeRevision.create.mock.calls[0][0].data).toMatchObject({
      origin: 'ADMIN_CORRECTION',
      reason: 'El docente pidió corregir en la reunión',
      previousMeetingValueHundredths: 500,
      newMeetingValueHundredths: 600,
    })
    expect(notifyMock.mock.calls[0][1].title).toBe('Administración corrigió la R y el juicio de Pérez, Ana')
    expect(auditMock.mock.calls[0][0]).toMatchObject({ action: 'GRADE_CORRECTED', entityType: 'GradeBookPeriod' })
  })

  it('la R tiene que ser entera y de la escala del nivel; la C, de la de conducta', async () => {
    const r = await request(app()).put(periodUrl).set('Authorization', `Bearer ${tok()}`).send({ meetingValueHundredths: 1100, reason: 'Corrección' })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('VALUE_OUT_OF_SCALE')
    const half = await request(app()).put(periodUrl).set('Authorization', `Bearer ${tok()}`).send({ meetingValueHundredths: 650, reason: 'Corrección' })
    expect(half.status).toBe(400)
    const c = await request(app()).put(periodUrl).set('Authorization', `Bearer ${tok()}`).send({ conductValueHundredths: 1200, reason: 'Corrección' })
    expect(c.status).toBe(400)
    expect(prismaMock.periodGrade.upsert).not.toHaveBeenCalled()
  })

  it('sin nada para corregir, o con un período de otro ciclo, no escribe', async () => {
    const empty = await request(app()).put(periodUrl).set('Authorization', `Bearer ${tok()}`).send({ reason: 'Corrección' })
    expect(empty.status).toBe(400)
    prismaMock.academicPeriod.findFirst.mockResolvedValue(null)
    const other = await request(app()).put(periodUrl).set('Authorization', `Bearer ${tok()}`).send({ meetingValueHundredths: 600, reason: 'Corrección' })
    expect(other.status).toBe(404)
    expect(other.body.code).toBe('PERIOD_NOT_FOUND')
    expect(prismaMock.academicPeriod.findFirst.mock.calls[0][0].where).toEqual({ id: PE, schoolYearId: 'sy-1' })
  })
})
