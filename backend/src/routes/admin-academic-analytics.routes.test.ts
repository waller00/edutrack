import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { signAccessToken } from '../test-utils/bearer-token.js'

const { prismaMock, rosterMock } = vi.hoisted(() => ({
  prismaMock: {
    academicAlertRule: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    gradingScale: { findFirst: vi.fn() },
    gradeBook: { findMany: vi.fn() },
    gradeBookPeriod: { findMany: vi.fn() },
    assessment: { groupBy: vi.fn() },
    periodGrade: { findMany: vi.fn() },
  },
  rosterMock: vi.fn(),
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/school-year-service.js', () => ({
  resolveSchoolYearIdForList: vi.fn().mockResolvedValue('sy-2026'),
}))
vi.mock('../services/student-attendance/roster.js', () => ({ loadRosterForScope: rosterMock }))

import adminAcademicAnalyticsRoutes, { alertRulesForYear } from './admin-academic-analytics.js'
import { authGuard, requirePermission } from '../middlewares/auth.js'

function app() {
  const a = express()
  a.use(express.json())
  a.use(cookieParser())
  a.use('/admin/academic-analytics', authGuard, requirePermission('academic-analytics.read', 'all'), adminAcademicAnalyticsRoutes)
  return a
}

const tok = (role = 'ADMIN', sub = 'a-1') => signAccessToken({ sub, email: 'a@a.com', role: role as 'ADMIN' })

const LEVELS = [
  { id: 'bajo', label: 'Insuficiente', minValueHundredths: 100, maxValueHundredths: 599, colorToken: 'red', iconToken: 'alert-triangle', isPassing: false, isAlert: true },
  { id: 'alto', label: 'Logrado', minValueHundredths: 600, maxValueHundredths: 1200, colorToken: 'green', iconToken: 'check', isPassing: true, isAlert: false },
]

const BOOK = {
  id: 'gb-1',
  subjectId: 's-1',
  schoolYearId: 'sy-2026',
  courseOfferingId: 'off-1',
  orientationId: null,
  courseOrientationId: null,
  subject: { id: 's-1', name: 'Matemática' },
  courseOffering: { course: { id: 'c-1', name: '3 EMS', level: 'EMS' } },
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.gradingScale.findFirst.mockResolvedValue({ levels: LEVELS })
  prismaMock.academicAlertRule.findMany.mockResolvedValue([])
  prismaMock.gradeBook.findMany.mockResolvedValue([])
  prismaMock.gradeBookPeriod.findMany.mockResolvedValue([])
  prismaMock.assessment.groupBy.mockResolvedValue([])
  prismaMock.periodGrade.findMany.mockResolvedValue([])
  rosterMock.mockResolvedValue([])
})

describe('permisos', () => {
  it('rechaza a un docente: el backoffice exige alcance all', async () => {
    const res = await request(app())
      .get('/admin/academic-analytics/dashboard')
      .set('Authorization', `Bearer ${tok('TEACHER', 't-1')}`)
    expect(res.status).toBe(403)
  })

  it('sin sesión responde 401', async () => {
    expect((await request(app()).get('/admin/academic-analytics/dashboard')).status).toBe(401)
  })
})

describe('alertRulesForYear (RF-200)', () => {
  it('la regla del ciclo pisa a la general', async () => {
    // Una comparativa histórica no puede cambiar sola cuando alguien mueve el umbral actual.
    prismaMock.academicAlertRule.findMany.mockResolvedValue([
      { type: 'ALERT_SUBJECTS', schoolYearId: null, threshold: 3 },
      { type: 'ALERT_SUBJECTS', schoolYearId: 'sy-2026', threshold: 2 },
    ])
    expect(await alertRulesForYear('sy-2026')).toEqual([{ type: 'ALERT_SUBJECTS', threshold: 2 }])
  })

  it('sin regla propia usa la general', async () => {
    prismaMock.academicAlertRule.findMany.mockResolvedValue([
      { type: 'ALERT_SUBJECTS', schoolYearId: null, threshold: 3 },
    ])
    expect(await alertRulesForYear('sy-2025')).toEqual([{ type: 'ALERT_SUBJECTS', threshold: 3 }])
  })
})

describe('GET /dashboard', () => {
  it('arma los tres bloques del pliego', async () => {
    prismaMock.gradeBook.findMany.mockResolvedValue([BOOK])
    rosterMock.mockResolvedValue([{ studentId: 's1' }, { studentId: 's2' }])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      {
        gradeBookId: 'gb-1',
        status: 'CLOSED',
        closedLate: false,
        period: { id: 'p-1', name: 'Mayo', sortOrder: 20 },
        endorsements: [{ status: 'ENDORSED' }],
        grades: [
          { studentId: 's1', studentLastName: 'B', studentFirstName: 'Ana', valueHundredths: 300 },
          { studentId: 's2', studentLastName: 'C', studentFirstName: 'Beto', valueHundredths: 900 },
        ],
      },
    ])
    prismaMock.assessment.groupBy.mockResolvedValue([{ gradeBookId: 'gb-1', _count: { _all: 2 } }])

    const res = await request(app())
      .get('/admin/academic-analytics/dashboard')
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.students).toMatchObject({ total: 2, evaluated: 2 })
    expect(res.body.performance.averageHundredths).toBe(600)
    expect(res.body.performance.medianHundredths).toBe(600)
    expect(res.body.management).toMatchObject({ gradeBooks: 1, complete: 1, pendingClosures: 0 })
  })

  it('lleva la aclaración de que las alertas no generan decisiones administrativas', async () => {
    const res = await request(app())
      .get('/admin/academic-analytics/dashboard')
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.body.disclaimer).toContain('No generan')
    expect(res.body.disclaimer).toContain('desempeño docente')
  })

  it('filtra por curso, orientación y asignatura', async () => {
    const params = new URLSearchParams({
      courseOfferingId: '11111111-1111-4111-8111-111111111111',
      subjectId: '22222222-2222-4222-8222-222222222222',
      level: 'EMS',
    })
    await request(app())
      .get(`/admin/academic-analytics/dashboard?${params}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(prismaMock.gradeBook.findMany.mock.calls[0][0].where).toMatchObject({
      schoolYearId: 'sy-2026',
      courseOfferingId: '11111111-1111-4111-8111-111111111111',
      subjectId: '22222222-2222-4222-8222-222222222222',
      courseOffering: { course: { level: 'EMS' } },
    })
  })

  it('sin datos responde ceros, no rompe', async () => {
    const res = await request(app())
      .get('/admin/academic-analytics/dashboard')
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(200)
    expect(res.body.students).toMatchObject({ total: 0, evaluated: 0 })
    expect(res.body.performance.averageHundredths).toBeNull()
  })
})

describe('GET /comparison', () => {
  const gradeBook = {
    schoolYearId: 'sy-2026',
    schoolYear: { label: '2026' },
    subject: { id: 's-1', name: 'Matemática' },
    courseOffering: { course: { id: 'c-1', name: '3 EMS' } },
  }

  it('exige la dimensión', async () => {
    const res = await request(app())
      .get('/admin/academic-analytics/comparison')
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(400)
  })

  it('compara varios ciclos en la misma consulta (RF-200)', async () => {
    prismaMock.periodGrade.findMany.mockResolvedValue([
      { studentId: 's1', valueHundredths: 900, gradeBookPeriod: { gradeBook } },
      { studentId: 's2', valueHundredths: 300, gradeBookPeriod: { gradeBook: { ...gradeBook, schoolYearId: 'sy-2025', schoolYear: { label: '2025' } } } },
    ])

    const res = await request(app())
      .get('/admin/academic-analytics/comparison?dimension=YEAR&schoolYearIds=sy-2025,sy-2026')
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.body.data.map((r: any) => r.label)).toEqual(['2025', '2026'])
    expect(res.body.data.find((r: any) => r.label === '2025').alertPercentage).toBe(100)
  })

  it('agrupa por asignatura con su porcentaje de alerta (§5.5)', async () => {
    prismaMock.periodGrade.findMany.mockResolvedValue([
      { studentId: 's1', valueHundredths: 300, gradeBookPeriod: { gradeBook } },
      { studentId: 's2', valueHundredths: 900, gradeBookPeriod: { gradeBook } },
    ])

    const res = await request(app())
      .get('/admin/academic-analytics/comparison?dimension=SUBJECT')
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.body.data[0]).toMatchObject({ label: 'Matemática', gradedCount: 2, studentCount: 2, alertPercentage: 50 })
  })
})

describe('GET /risk-matrix', () => {
  it('arma la matriz Estudiantes × Materias con las alertas disparadas', async () => {
    prismaMock.academicAlertRule.findMany.mockResolvedValue([
      { type: 'ALERT_SUBJECTS', schoolYearId: null, threshold: 1 },
    ])
    prismaMock.gradeBook.findMany.mockResolvedValue([BOOK])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      {
        gradeBookId: 'gb-1',
        status: 'CLOSED',
        closedLate: false,
        period: { id: 'p-1', name: 'Mayo', sortOrder: 20 },
        endorsements: [],
        grades: [{ studentId: 's1', studentLastName: 'B', studentFirstName: 'Ana', valueHundredths: 300 }],
      },
    ])

    const res = await request(app())
      .get('/admin/academic-analytics/risk-matrix')
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.body.subjects).toEqual([{ id: 's-1', name: 'Matemática' }])
    expect(res.body.students[0].cells).toEqual([300])
    expect(res.body.students[0].alerts).toContainEqual({ type: 'ALERT_SUBJECTS', detail: 1 })
  })
})

describe('umbrales configurables (§5.7)', () => {
  it('crea el umbral si no existe', async () => {
    prismaMock.academicAlertRule.findFirst.mockResolvedValue(null)
    prismaMock.academicAlertRule.create.mockResolvedValue({ id: 'r-1' })

    const res = await request(app())
      .put('/admin/academic-analytics/alert-rules')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ type: 'ALERT_SUBJECTS', threshold: 2 })

    expect(res.status).toBe(200)
    expect(prismaMock.academicAlertRule.create.mock.calls[0][0].data).toMatchObject({
      type: 'ALERT_SUBJECTS',
      threshold: 2,
      schoolYearId: null,
    })
  })

  it('actualiza el existente en vez de duplicarlo', async () => {
    prismaMock.academicAlertRule.findFirst.mockResolvedValue({ id: 'r-1' })
    prismaMock.academicAlertRule.update.mockResolvedValue({ id: 'r-1' })

    await request(app())
      .put('/admin/academic-analytics/alert-rules')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ type: 'ALERT_SUBJECTS', threshold: 4 })

    expect(prismaMock.academicAlertRule.create).not.toHaveBeenCalled()
    expect(prismaMock.academicAlertRule.update.mock.calls[0][0].data.threshold).toBe(4)
  })

  it('rechaza un umbral negativo', async () => {
    const res = await request(app())
      .put('/admin/academic-analytics/alert-rules')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ type: 'SCORE_DROP', threshold: -1 })
    expect(res.status).toBe(400)
  })
})
