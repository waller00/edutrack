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
    academicPeriod: { findUnique: vi.fn() },
  },
  rosterMock: vi.fn(),
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/school-year-service.js', () => ({
  resolveSchoolYearIdForList: vi.fn().mockResolvedValue('sy-2026'),
}))
vi.mock('../services/student-attendance/roster.js', () => ({ loadRosterForScope: rosterMock }))

import adminAcademicAnalyticsRoutes from './admin-academic-analytics.js'
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
          { studentId: 's1', studentLastName: 'B', studentFirstName: 'Ana', valueHundredths: 300, meetingValueHundredths: 300 },
          { studentId: 's2', studentLastName: 'C', studentFirstName: 'Beto', valueHundredths: 900, meetingValueHundredths: 900 },
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
    courseOffering: { course: { id: 'c-1', name: '3 EMS', level: 'EMS' } },
  }

  it('exige la dimensión', async () => {
    const res = await request(app())
      .get('/admin/academic-analytics/comparison')
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(400)
  })

  it('compara varios ciclos en la misma consulta (RF-200)', async () => {
    prismaMock.periodGrade.findMany.mockResolvedValue([
      { studentId: 's1', meetingValueHundredths: 900, gradeBookPeriod: { gradeBook } },
      { studentId: 's2', meetingValueHundredths: 300, gradeBookPeriod: { gradeBook: { ...gradeBook, schoolYearId: 'sy-2025', schoolYear: { label: '2025' } } } },
    ])

    const res = await request(app())
      .get('/admin/academic-analytics/comparison?dimension=YEAR&schoolYearIds=sy-2025,sy-2026')
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.body.data.map((r: any) => r.label)).toEqual(['2025', '2026'])
    expect(res.body.data.find((r: any) => r.label === '2025').alertPercentage).toBe(100)
  })

  it('agrupa por asignatura con su porcentaje de alerta (§5.5)', async () => {
    prismaMock.periodGrade.findMany.mockResolvedValue([
      { studentId: 's1', meetingValueHundredths: 300, gradeBookPeriod: { gradeBook } },
      { studentId: 's2', meetingValueHundredths: 900, gradeBookPeriod: { gradeBook } },
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
      { type: 'ALERT_SUBJECTS', schoolYearId: null, threshold: 1, isActive: true },
    ])
    prismaMock.gradeBook.findMany.mockResolvedValue([BOOK])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      {
        gradeBookId: 'gb-1',
        status: 'CLOSED',
        closedLate: false,
        period: { id: 'p-1', name: 'Mayo', sortOrder: 20 },
        endorsements: [],
        grades: [{ studentId: 's1', studentLastName: 'B', studentFirstName: 'Ana', valueHundredths: 300, meetingValueHundredths: 300 }],
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

describe('indicadores por nivel y por reunión', () => {
  const EBI_BOOK = { ...BOOK, id: 'gb-ebi', subjectId: 's-9', courseOffering: { course: { id: 'c-9', name: '1.º', level: 'EBI' } } }

  const state = (gradeBookId: string, period: { id: string; sortOrder: number }, grades: Array<[string, number | null]>) => ({
    gradeBookId,
    status: 'CLOSED',
    closedLate: false,
    period: { name: period.id, ...period },
    endorsements: [],
    grades: grades.map(([studentId, value]) => ({
      studentId,
      studentLastName: studentId,
      studentFirstName: studentId,
      valueHundredths: value,
      meetingValueHundredths: value,
    })),
  })

  it('con libretas de los dos niveles pide elegir: 1 a 10 y 1 a 12 no se promedian', async () => {
    prismaMock.gradeBook.findMany.mockResolvedValue([BOOK, EBI_BOOK])
    const res = await request(app()).get('/admin/academic-analytics/dashboard').set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'LEVEL_REQUIRED', levels: ['EBI', 'EMS'] })
  })

  it('con el nivel elegido usa la escala de ese nivel y sólo sus libretas', async () => {
    prismaMock.gradeBook.findMany.mockResolvedValue([BOOK])
    const res = await request(app()).get('/admin/academic-analytics/dashboard?level=EMS').set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(200)
    expect(res.body.level).toBe('EMS')
    expect(prismaMock.gradingScale.findFirst.mock.calls[0][0].where).toMatchObject({ code: 'NUMERICA_1_12' })
  })

  it('mide contra la última reunión con notas, no contra todas juntas', async () => {
    prismaMock.gradeBook.findMany.mockResolvedValue([BOOK])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      state('gb-1', { id: 'p-1', sortOrder: 10 }, [['s1', 300]]),
      state('gb-1', { id: 'p-2', sortOrder: 20 }, [['s1', 900]]),
    ])
    const res = await request(app()).get('/admin/academic-analytics/dashboard').set('Authorization', `Bearer ${tok()}`)
    expect(res.body.referencePeriod).toEqual({ id: 'p-2', name: 'p-2' })
    expect(res.body.performance).toMatchObject({ averageHundredths: 900, gradedCount: 1 })
    // La serie va de 3 a 9: mejoró.
    expect(res.body.students.improved).toBe(1)
  })

  it('la tendencia es del promedio de sus materias, no de una materia suelta', async () => {
    const ART = { ...BOOK, id: 'gb-art', subjectId: 's-art', subject: { id: 's-art', name: 'Dibujo' } }
    prismaMock.gradeBook.findMany.mockResolvedValue([BOOK, ART])
    // Matemática 4 y Dibujo 10 en las dos reuniones: no cambió nada.
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      state('gb-1', { id: 'p-1', sortOrder: 10 }, [['s1', 400]]),
      state('gb-art', { id: 'p-1', sortOrder: 10 }, [['s1', 1000]]),
      state('gb-art', { id: 'p-2', sortOrder: 20 }, [['s1', 1000]]),
      state('gb-1', { id: 'p-2', sortOrder: 20 }, [['s1', 400]]),
    ])
    const res = await request(app()).get('/admin/academic-analytics/dashboard').set('Authorization', `Bearer ${tok()}`)
    expect(res.body.students).toMatchObject({ improved: 0, declined: 0 })
  })

  it('con una reunión elegida, la serie llega hasta ahí y las alertas son de esa reunión', async () => {
    prismaMock.academicAlertRule.findMany.mockResolvedValue([
      { type: 'ALERT_SUBJECTS', schoolYearId: null, threshold: 1, isActive: true },
    ])
    prismaMock.gradeBook.findMany.mockResolvedValue([BOOK])
    const P1 = '33333333-3333-4333-8333-333333333333'
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      state('gb-1', { id: P1, sortOrder: 10 }, [['s1', 300]]),
      state('gb-1', { id: 'p-2', sortOrder: 20 }, [['s1', 900]]),
    ])
    const res = await request(app()).get(`/admin/academic-analytics/dashboard?periodId=${P1}`).set('Authorization', `Bearer ${tok()}`)
    // En la primera reunión tenía un 3: en alerta. Lo de después no cuenta para esa reunión.
    expect(res.body.students.atRisk).toBe(1)
    expect(res.body.performance.averageHundredths).toBe(300)
  })

  it('con un grupo elegido cuentan sólo sus alumnos, también en tronco común', async () => {
    const OFFERING = '11111111-1111-4111-8111-111111111111'
    const CO = '22222222-2222-4222-8222-222222222222'
    prismaMock.gradeBook.findMany.mockResolvedValue([{ ...BOOK, courseOfferingId: OFFERING }])
    rosterMock.mockResolvedValue([{ studentId: 's1' }])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      state('gb-1', { id: 'p-1', sortOrder: 10 }, [['s1', 800], ['s-otra-orientacion', 300]]),
    ])
    const res = await request(app())
      .get(`/admin/academic-analytics/dashboard?courseOfferingId=${OFFERING}&courseOrientationId=${CO}`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.body.students.total).toBe(1)
    expect(res.body.performance.averageHundredths).toBe(800)
    expect(rosterMock).toHaveBeenCalledWith({ schoolYearId: 'sy-2026', courseOfferingId: OFFERING, courseOrientationId: CO, orientationId: null })
  })
})

describe('GET /comparison por nivel y reunión', () => {
  const book = (level: string, year = 'sy-2026', label = '2026') => ({
    schoolYearId: year,
    schoolYear: { label },
    subject: { id: 's-1', name: 'Matemática' },
    courseOffering: { course: { id: 'c-1', name: '1.º', level } },
  })

  it('con notas de los dos niveles pide elegir uno', async () => {
    prismaMock.periodGrade.findMany.mockResolvedValue([
      { studentId: 's1', meetingValueHundredths: 900, gradeBookPeriod: { gradeBook: book('EBI') } },
      { studentId: 's2', meetingValueHundredths: 900, gradeBookPeriod: { gradeBook: book('EMS') } },
    ])
    const res = await request(app()).get('/admin/academic-analytics/comparison?dimension=SUBJECT').set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('LEVEL_REQUIRED')
  })

  it('entre años compara la misma reunión por su código', async () => {
    const P = '44444444-4444-4444-8444-444444444444'
    prismaMock.academicPeriod.findUnique.mockResolvedValue({ code: 'E1', level: 'EBI' })
    prismaMock.periodGrade.findMany.mockResolvedValue([
      { studentId: 's1', meetingValueHundredths: 900, gradeBookPeriod: { gradeBook: book('EBI', 'sy-2025', '2025') } },
    ])
    const res = await request(app())
      .get(`/admin/academic-analytics/comparison?dimension=YEAR&periodId=${P}&schoolYearIds=sy-2025,sy-2026`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    const where = prismaMock.periodGrade.findMany.mock.calls[0][0].where
    expect(where.gradeBookPeriod.period).toEqual({ isMeeting: true, code: 'E1', level: 'EBI' })
    expect(where.gradeBookPeriod.gradeBook.courseOffering).toEqual({ course: { level: 'EBI' } })
    expect(res.body.level).toBe('EBI')
  })

  it('dentro de un año filtra por la reunión misma', async () => {
    const P = '44444444-4444-4444-8444-444444444444'
    prismaMock.academicPeriod.findUnique.mockResolvedValue({ code: 'E1', level: 'EBI' })
    prismaMock.periodGrade.findMany.mockResolvedValue([])
    await request(app())
      .get(`/admin/academic-analytics/comparison?dimension=SUBJECT&periodId=${P}`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(prismaMock.periodGrade.findMany.mock.calls[0][0].where.gradeBookPeriod.period).toEqual({ isMeeting: true, id: P })
  })
})
