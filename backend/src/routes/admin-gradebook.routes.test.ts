import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { signAccessToken } from '../test-utils/bearer-token.js'

const { prismaMock, rosterMock, scopeMock } = vi.hoisted(() => ({
  prismaMock: {
    courseOffering: { findMany: vi.fn(), findUnique: vi.fn() },
    courseOrientation: { findMany: vi.fn() },
    gradeBook: { findMany: vi.fn(), findUnique: vi.fn() },
    gradingScale: { findFirst: vi.fn() },
    student: { findUnique: vi.fn() },
    studentEnrollment: { findMany: vi.fn() },
    periodGrade: { findMany: vi.fn() },
    academicPeriod: { findMany: vi.fn() },
    gradeBookPeriod: { findMany: vi.fn(), findUnique: vi.fn() },
    endorsement: { create: vi.fn() },
    inAppNotification: { createMany: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(1),
    teacherMeetingRecord: { findMany: vi.fn(), create: vi.fn() },
  },
  rosterMock: vi.fn(),
  scopeMock: vi.fn(),
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/school-year-service.js', () => ({
  resolveSchoolYearIdForList: vi.fn().mockResolvedValue('sy-1'),
}))
vi.mock('../services/student-attendance/roster.js', () => ({ loadRosterForScope: rosterMock }))
vi.mock('../middlewares/auth.js', async () => {
  const actual = await vi.importActual<any>('../middlewares/auth.js')
  return { ...actual, userPermissionScope: scopeMock }
})

import adminGradeBookRoutes from './admin-gradebook.js'
import { authGuard, requirePermission } from '../middlewares/auth.js'

function app() {
  const a = express()
  a.use(express.json())
  a.use(cookieParser())
  a.use('/admin/gradebook', authGuard, requirePermission('gradebook.read', 'all'), adminGradeBookRoutes)
  return a
}

const tok = (role = 'ADMIN', sub = 'a-1') => signAccessToken({ sub, email: 'a@a.com', role: role as 'ADMIN' })

const OFFERING_ID = '11111111-1111-4111-8111-111111111111'
const PERIOD_ID = '22222222-2222-4222-8222-222222222222'
const CO_ID = '33333333-3333-4333-8333-333333333333'
const STUDENT_ID = '44444444-4444-4444-8444-444444444444'

const LEVELS = [
  { id: 'bajo', label: 'Insuficiente', descriptor: 'No alcanza.', minValueHundredths: 100, maxValueHundredths: 599, colorToken: 'red', iconToken: 'alert-triangle', isPassing: false, isAlert: true },
  { id: 'alto', label: 'Logrado', descriptor: 'Alcanza.', minValueHundredths: 600, maxValueHundredths: 1200, colorToken: 'green', iconToken: 'check', isPassing: true, isAlert: false },
]

function book(over: any = {}) {
  return {
    id: 'gb-1',
    subjectId: 's-1',
    courseOfferingId: OFFERING_ID,
    courseOrientationId: null,
    orientationId: null,
    subject: { id: 's-1', name: 'Matemática', sortOrder: 10 },
    teacher: { id: 't-1', name: 'Ana G' },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.courseOffering.findUnique.mockResolvedValue({
    id: OFFERING_ID,
    schoolYearId: 'sy-1',
    courseId: 'c-1',
    course: { name: '3 EMS' },
    schoolYear: { id: 'sy-1', label: '2026' },
  })
  prismaMock.gradingScale.findFirst.mockResolvedValue({ levels: LEVELS })
  scopeMock.mockResolvedValue('all')
  prismaMock.inAppNotification.createMany.mockResolvedValue({ count: 0 })
  // `resolveGradeBookRecipients` busca al titular para avisarle del visado.
  prismaMock.gradeBook.findUnique.mockResolvedValue({ teacherUserId: 't-1' })
  prismaMock.gradeBookPeriod.findMany.mockResolvedValue([])
  rosterMock.mockResolvedValue([])
})

describe('permisos', () => {
  it('rechaza a un docente: la vista institucional exige alcance all', async () => {
    const res = await request(app())
      .get('/admin/gradebook/groups')
      .set('Authorization', `Bearer ${tok('TEACHER', 't-1')}`)
    expect(res.status).toBe(403)
  })

  it('sin sesión responde 401', async () => {
    expect((await request(app()).get('/admin/gradebook/groups')).status).toBe(401)
  })
})

describe('GET /groups', () => {
  it('un curso sin orientaciones es un solo grupo', async () => {
    prismaMock.courseOffering.findMany.mockResolvedValue([
      { id: OFFERING_ID, courseId: 'c-1', course: { id: 'c-1', name: '7 EBI', code: null, level: 'EBI', sortOrder: 1 } },
    ])
    prismaMock.courseOrientation.findMany.mockResolvedValue([])

    const res = await request(app()).get('/admin/gradebook/groups').set('Authorization', `Bearer ${tok()}`)

    expect(res.body.data).toEqual([
      { courseOfferingId: OFFERING_ID, courseId: 'c-1', courseName: '7 EBI', level: 'EBI', courseOrientationId: null, orientationName: null },
    ])
  })

  it('un curso con orientaciones es un grupo por orientación', async () => {
    prismaMock.courseOffering.findMany.mockResolvedValue([
      { id: OFFERING_ID, courseId: 'c-1', course: { id: 'c-1', name: '3 EMS', code: null, level: 'EMS', sortOrder: 5 } },
    ])
    prismaMock.courseOrientation.findMany.mockResolvedValue([
      { id: CO_ID, courseId: 'c-1', orientation: { id: 'o-1', name: 'Ciencias de la Vida' } },
      { id: 'co-2', courseId: 'c-1', orientation: { id: 'o-2', name: 'Ciencia y Tecnología' } },
    ])

    const res = await request(app()).get('/admin/gradebook/groups').set('Authorization', `Bearer ${tok()}`)

    expect(res.body.data).toHaveLength(2)
    expect(res.body.data.map((g: any) => g.orientationName)).toEqual(['Ciencias de la Vida', 'Ciencia y Tecnología'])
  })
})

describe('GET /group-matrix', () => {
  const url = `/admin/gradebook/group-matrix?courseOfferingId=${OFFERING_ID}&periodId=${PERIOD_ID}`

  it('exige los parámetros del grupo y del período', async () => {
    const res = await request(app()).get('/admin/gradebook/group-matrix').set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(400)
  })

  it('incluye las asignaturas de la orientación Y las de tronco común', async () => {
    prismaMock.gradeBook.findMany.mockResolvedValue([
      book({ id: 'comun', subject: { id: 's-1', name: 'Idioma Español', sortOrder: 10 } }),
      book({ id: 'vida', courseOrientationId: CO_ID, subject: { id: 's-2', name: 'Biología Humana', sortOrder: 20 } }),
      book({ id: 'tec', courseOrientationId: 'otra', subject: { id: 's-3', name: 'Física', sortOrder: 30 } }),
    ])

    const res = await request(app())
      .get(`${url}&courseOrientationId=${CO_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.body.subjects.map((s: any) => s.gradeBookId).sort()).toEqual(['comun', 'vida'])
  })

  it('arma la fila con promedio, pendientes y alertas', async () => {
    prismaMock.gradeBook.findMany.mockResolvedValue([book({ id: 'gb-1' }), book({ id: 'gb-2', subjectId: 's-2', subject: { id: 's-2', name: 'Historia', sortOrder: 20 } })])
    rosterMock.mockResolvedValue([
      { studentId: STUDENT_ID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      { gradeBookId: 'gb-1', status: 'CLOSED', grades: [{ studentId: STUDENT_ID, valueHundredths: 300, conceptualJudgement: 'Debe reforzar.' }] },
      { gradeBookId: 'gb-2', status: 'OPEN', grades: [] },
    ])

    const res = await request(app()).get(url).set('Authorization', `Bearer ${tok()}`)

    const row = res.body.students[0]
    expect(row.averageHundredths).toBe(300)
    expect(row.pendingCount).toBe(1)
    expect(row.alertCount).toBe(1)
    expect(row.cells[0].descriptor.label).toBe('Insuficiente')
    expect(row.cells[0].periodStatus).toBe('CLOSED')
  })

  it('rotula el promedio como indicador automático (RF-061)', async () => {
    prismaMock.gradeBook.findMany.mockResolvedValue([])
    const res = await request(app()).get(url).set('Authorization', `Bearer ${tok()}`)
    expect(res.body.averageLabel).toBe('Indicador automático / promedio orientativo')
  })

  it('404 si el grupo no existe', async () => {
    prismaMock.courseOffering.findUnique.mockResolvedValue(null)
    const res = await request(app()).get(url).set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(404)
  })
})

describe('GET /students/:studentId', () => {
  it('404 si no existe', async () => {
    prismaMock.student.findUnique.mockResolvedValue(null)
    const res = await request(app())
      .get(`/admin/gradebook/students/${STUDENT_ID}`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(404)
  })

  it('arma trayectoria, histórico y evolución por ciclo', async () => {
    prismaMock.student.findUnique.mockResolvedValue({ id: STUDENT_ID, firstName: 'Ana', lastName: 'B', documentId: null, email: null })
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      { schoolYear: { code: 2026, label: '2026' }, courseOffering: { course: { name: '3 EMS' } }, orientation: null, courseOrientation: { orientation: { name: 'Cs. de la Vida' } }, enrollmentStatus: 'ACTIVE' },
    ])
    const gradeBook = {
      subject: { name: 'Matemática' },
      schoolYear: { code: 2026, label: '2026' },
      courseOffering: { course: { name: '3 EMS' } },
      courseOrientation: null,
    }
    prismaMock.periodGrade.findMany.mockResolvedValue([
      { valueHundredths: 900, conceptualJudgement: null, gradeBookPeriod: { period: { code: 'P1', name: 'Uno', sortOrder: 10 }, gradeBook } },
      { valueHundredths: 700, conceptualJudgement: null, gradeBookPeriod: { period: { code: 'P2', name: 'Dos', sortOrder: 20 }, gradeBook } },
      { valueHundredths: 500, conceptualJudgement: null, gradeBookPeriod: { period: { code: 'P3', name: 'Tres', sortOrder: 30 }, gradeBook } },
    ])

    const res = await request(app())
      .get(`/admin/gradebook/students/${STUDENT_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.enrollments[0].orientationName).toBe('Cs. de la Vida')
    expect(res.body.evolutionByYear[0].schoolYearCode).toBe(2026)
    // 9 → 7 → 5 es un descenso sostenido (§5.7).
    expect(res.body.evolutionByYear[0].subjects[0].sustainedDecline).toBe(true)
  })
})

describe('reunión de profesores', () => {
  it('registra una decisión sobre un estudiante', async () => {
    prismaMock.teacherMeetingRecord.create.mockResolvedValue({ id: 'm-1' })

    const res = await request(app())
      .post('/admin/gradebook/meeting-records')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ courseOfferingId: OFFERING_ID, periodId: PERIOD_ID, studentId: STUDENT_ID, decision: 'Se acuerda apoyo en Matemática.' })

    expect(res.status).toBe(201)
    expect(prismaMock.teacherMeetingRecord.create.mock.calls[0][0].data).toMatchObject({
      schoolYearId: 'sy-1',
      studentId: STUDENT_ID,
      createdByUserId: 'a-1',
    })
  })

  it('admite una decisión sobre el grupo, sin estudiante', async () => {
    prismaMock.teacherMeetingRecord.create.mockResolvedValue({ id: 'm-2' })
    const res = await request(app())
      .post('/admin/gradebook/meeting-records')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ courseOfferingId: OFFERING_ID, periodId: PERIOD_ID, decision: 'Se refuerza la comunicación con familias.' })

    expect(res.status).toBe(201)
    expect(prismaMock.teacherMeetingRecord.create.mock.calls[0][0].data.studentId).toBeNull()
  })

  it('rechaza una decisión vacía', async () => {
    const res = await request(app())
      .post('/admin/gradebook/meeting-records')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ courseOfferingId: OFFERING_ID, periodId: PERIOD_ID, decision: '' })
    expect(res.status).toBe(400)
  })
})

describe('GET /periods', () => {
  it('los sirve con gradebook.read, sin exigir academic-config.manage', async () => {
    // Adscripción, dirección e inspección necesitan el desplegable pero no editan la
    // parametrización, así que no pueden depender del endpoint de administración.
    prismaMock.academicPeriod.findMany.mockResolvedValue([{ id: 'p-1', code: 'MAYO', name: 'Mayo', level: 'EMS', closesOn: null }])

    const res = await request(app()).get('/admin/gradebook/periods').set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.data[0].name).toBe('Mayo')
    expect(prismaMock.academicPeriod.findMany.mock.calls[0][0].where).toMatchObject({
      schoolYearId: 'sy-1',
      isActive: true,
    })
  })

  it('filtra por nivel cuando se pide', async () => {
    prismaMock.academicPeriod.findMany.mockResolvedValue([])
    await request(app()).get('/admin/gradebook/periods?level=EBI').set('Authorization', `Bearer ${tok()}`)
    expect(prismaMock.academicPeriod.findMany.mock.calls[0][0].where.level).toBe('EBI')
  })
})

// ─── Visado ─────────────────────────────────────────────────────────────────

const GBP_ID = '55555555-5555-4555-8555-555555555555'

function endorsement(section: string, status: string, iso: string, over: any = {}) {
  return { section, status, occurredAt: new Date(iso), observations: null, actorRoleCode: 'DIRECCION', ...over }
}

function gbpRow(endorsements: any[] = [], over: any = {}) {
  return {
    id: GBP_ID,
    gradeBookId: 'gb-1',
    status: 'CLOSED',
    closedAt: new Date('2026-06-01T12:00:00Z'),
    closedLate: false,
    updatedAt: new Date('2026-06-01T12:00:00Z'),
    endorsements,
    period: { id: PERIOD_ID, code: 'MAYO', name: 'Mayo', sortOrder: 20 },
    gradeBook: {
      id: 'gb-1',
      subject: { id: 's-1', name: 'Matemática' },
      teacher: { id: 't-1', name: 'Ana G' },
      courseOffering: { course: { name: '3 EMS' } },
      courseOrientation: null,
    },
    ...over,
  }
}

describe('GET /endorsements (grilla RF-080)', () => {
  it('sólo muestra períodos cerrados: un período abierto no tiene nada firme que visar', async () => {
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([])
    await request(app()).get('/admin/gradebook/endorsements').set('Authorization', `Bearer ${tok()}`)
    expect(prismaMock.gradeBookPeriod.findMany.mock.calls[0][0].where.status).toBe('CLOSED')
  })

  it('devuelve el estado vigente de cada sección y la antigüedad del pendiente', async () => {
    vi.setSystemTime(new Date('2026-06-11T12:00:00Z'))
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      gbpRow([endorsement('GRADES', 'OBSERVED', '2026-06-01T12:00:00Z', { observations: 'Falta un alumno.' })]),
    ])

    const res = await request(app()).get('/admin/gradebook/endorsements').set('Authorization', `Bearer ${tok()}`)

    const row = res.body.data[0]
    expect(row.sections.find((s: any) => s.section === 'GRADES').status).toBe('OBSERVED')
    expect(row.sections.find((s: any) => s.section === 'CLOSURE').status).toBe('PENDING')
    expect(row.overallStatus).toBe('PENDING')
    expect(row.pendingAgeDays).toBe(10)
    expect(row.blockingSections).toEqual(['GRADES'])
    expect(row.canFinalize).toBe(false)
  })

  it('un período ya visado no acumula antigüedad', async () => {
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      gbpRow([endorsement('ALL', 'ENDORSED', '2026-06-05T12:00:00Z')]),
    ])
    const res = await request(app()).get('/admin/gradebook/endorsements').set('Authorization', `Bearer ${tok()}`)
    expect(res.body.data[0].pendingAgeDays).toBeNull()
  })

  it('con pending=true filtra lo ya visado', async () => {
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      gbpRow([endorsement('ALL', 'ENDORSED', '2026-06-05T12:00:00Z')]),
      gbpRow([], { id: 'otro' }),
    ])
    const res = await request(app())
      .get('/admin/gradebook/endorsements?pending=true')
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].gradeBookPeriodId).toBe('otro')
  })
})

describe('GET /endorsements/:id', () => {
  it('devuelve el historial completo, no sólo el estado vigente (RF-083)', async () => {
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue(
      gbpRow([
        endorsement('GRADES', 'ENDORSED', '2026-06-01T12:00:00Z'),
        endorsement('GRADES', 'OBSERVED', '2026-06-10T12:00:00Z'),
      ]),
    )

    const res = await request(app())
      .get(`/admin/gradebook/endorsements/${GBP_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.body.history).toHaveLength(2)
    // El visado anterior sigue estando aunque ya no sea el vigente.
    expect(res.body.history[0].status).toBe('ENDORSED')
    expect(res.body.sections.find((s: any) => s.section === 'GRADES').status).toBe('OBSERVED')
  })
})

describe('POST /endorsements', () => {
  const body = { gradeBookPeriodId: GBP_ID, section: 'GRADES', status: 'OBSERVED', observations: 'Falta un alumno.' }

  beforeEach(() => {
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue(gbpRow())
    prismaMock.endorsement.create.mockResolvedValue({ id: 'e-1' })
  })

  it('registra la observación y congela el rol del actor', async () => {
    const res = await request(app())
      .post('/admin/gradebook/endorsements')
      .set('Authorization', `Bearer ${tok('ADMIN', 'd-1')}`)
      .send(body)

    expect(res.status).toBe(201)
    expect(prismaMock.endorsement.create.mock.calls[0][0].data).toMatchObject({
      section: 'GRADES',
      status: 'OBSERVED',
      actorRoleCode: 'ADMIN',
    })
    expect(prismaMock.$executeRaw).toHaveBeenCalled()
  })

  it('una observación sin texto no dice qué corregir', async () => {
    const res = await request(app())
      .post('/admin/gradebook/endorsements')
      .set('Authorization', `Bearer ${tok('ADMIN', 'd-1')}`)
      .send({ ...body, observations: '   ' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('OBSERVATION_REQUIRED')
  })

  it('no se visa un período abierto', async () => {
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue(gbpRow([], { status: 'OPEN' }))
    const res = await request(app())
      .post('/admin/gradebook/endorsements')
      .set('Authorization', `Bearer ${tok('ADMIN', 'd-1')}`)
      .send(body)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('PERIOD_NOT_CLOSED')
  })

  it('bloquea el visado del período si hay una sección observada (RF-082)', async () => {
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue(
      gbpRow([endorsement('CLOSURE', 'OBSERVED', '2026-06-02T12:00:00Z')]),
    )

    const res = await request(app())
      .post('/admin/gradebook/endorsements')
      .set('Authorization', `Bearer ${tok('ADMIN', 'd-1')}`)
      .send({ gradeBookPeriodId: GBP_ID, section: 'ALL', status: 'ENDORSED' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('SECTIONS_OBSERVED')
    expect(res.body.detail.blockingSections).toEqual(['CLOSURE'])
    expect(prismaMock.endorsement.create).not.toHaveBeenCalled()
  })

  it('con todo conforme, Dirección visa el período', async () => {
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue(
      gbpRow([
        endorsement('CLOSURE', 'OBSERVED', '2026-06-02T12:00:00Z'),
        endorsement('CLOSURE', 'CORRECTED', '2026-06-04T12:00:00Z'),
      ]),
    )

    const res = await request(app())
      .post('/admin/gradebook/endorsements')
      .set('Authorization', `Bearer ${tok('ADMIN', 'd-1')}`)
      .send({ gradeBookPeriodId: GBP_ID, section: 'ALL', status: 'ENDORSED' })

    expect(res.status).toBe(201)
  })
})

describe('POST /endorsements — atribuciones', () => {
  beforeEach(() => {
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue(gbpRow())
    prismaMock.endorsement.create.mockResolvedValue({ id: 'e-1' })
  })

  /** Simula un rol concreto: qué permisos de libreta tiene y cuáles no. */
  function actingAs(granted: string[]) {
    scopeMock.mockImplementation(async (_u: string, code: string) => (granted.includes(code) ? 'all' : null))
  }

  it('adscripción observa pero NO visa', async () => {
    actingAs(['gradebook.review'])
    const res = await request(app())
      .post('/admin/gradebook/endorsements')
      .set('Authorization', `Bearer ${tok('ADMIN', 'ads-1')}`)
      .send({ gradeBookPeriodId: GBP_ID, section: 'ALL', status: 'ENDORSED' })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('CANNOT_ENDORSE')
  })

  it('inspección no puede tocar una sección ya visada por Dirección', async () => {
    // La nota funcional del pliego, verificada en la ruta y no sólo en el servicio.
    actingAs(['gradebook.inspect'])
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue(
      gbpRow([endorsement('GRADES', 'ENDORSED', '2026-06-05T12:00:00Z')]),
    )

    const res = await request(app())
      .post('/admin/gradebook/endorsements')
      .set('Authorization', `Bearer ${tok('ADMIN', 'insp-1')}`)
      .send({ gradeBookPeriodId: GBP_ID, section: 'GRADES', status: 'OBSERVED', observations: 'Reviso esto.' })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('ENDORSED_BY_DIRECTION')
    expect(prismaMock.endorsement.create).not.toHaveBeenCalled()
  })

  it('adscripción tampoco puede revertir un visado de Dirección', async () => {
    actingAs(['gradebook.review'])
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue(
      gbpRow([endorsement('GRADES', 'ENDORSED', '2026-06-05T12:00:00Z')]),
    )

    const res = await request(app())
      .post('/admin/gradebook/endorsements')
      .set('Authorization', `Bearer ${tok('ADMIN', 'ads-1')}`)
      .send({ gradeBookPeriodId: GBP_ID, section: 'GRADES', status: 'OBSERVED', observations: 'Reviso.' })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('ENDORSED_BY_DIRECTION')
  })

  it('dirección sí puede reabrir su propio visado', async () => {
    actingAs(['gradebook.review', 'gradebook.endorse'])
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue(
      gbpRow([endorsement('GRADES', 'ENDORSED', '2026-06-05T12:00:00Z')]),
    )

    const res = await request(app())
      .post('/admin/gradebook/endorsements')
      .set('Authorization', `Bearer ${tok('ADMIN', 'dir-1')}`)
      .send({ gradeBookPeriodId: GBP_ID, section: 'GRADES', status: 'OBSERVED', observations: 'Reabro.' })

    expect(res.status).toBe(201)
  })
})

describe('avisos del visado (RF-091)', () => {
  beforeEach(() => {
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue(gbpRow())
    prismaMock.endorsement.create.mockResolvedValue({ id: 'e-1' })
  })

  it('avisa al docente cuando le observan la libreta', async () => {
    await request(app())
      .post('/admin/gradebook/endorsements')
      .set('Authorization', `Bearer ${tok('ADMIN', 'd-1')}`)
      .send({ gradeBookPeriodId: GBP_ID, section: 'GRADES', status: 'OBSERVED', observations: 'Falta un alumno.' })

    const rows = prismaMock.inAppNotification.createMany.mock.calls[0][0].data
    expect(rows[0]).toMatchObject({ userId: 't-1', type: 'GRADEBOOK_OBSERVATION' })
    expect(rows[0].body).toContain('Falta un alumno.')
  })

  it('avisa cuando Dirección visa el período', async () => {
    await request(app())
      .post('/admin/gradebook/endorsements')
      .set('Authorization', `Bearer ${tok('ADMIN', 'd-1')}`)
      .send({ gradeBookPeriodId: GBP_ID, section: 'ALL', status: 'ENDORSED' })

    const rows = prismaMock.inAppNotification.createMany.mock.calls[0][0].data
    expect(rows[0]).toMatchObject({ type: 'GRADEBOOK_ENDORSED' })
  })

  it('marcar corregido no genera aviso: no es novedad para el docente', async () => {
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue(
      gbpRow([endorsement('GRADES', 'OBSERVED', '2026-06-02T12:00:00Z')]),
    )
    await request(app())
      .post('/admin/gradebook/endorsements')
      .set('Authorization', `Bearer ${tok('ADMIN', 'd-1')}`)
      .send({ gradeBookPeriodId: GBP_ID, section: 'GRADES', status: 'CORRECTED' })

    expect(prismaMock.inAppNotification.createMany).not.toHaveBeenCalled()
  })

  it('si el aviso falla, el visado igual queda firme', async () => {
    prismaMock.inAppNotification.createMany.mockRejectedValue(new Error('db caída'))
    const res = await request(app())
      .post('/admin/gradebook/endorsements')
      .set('Authorization', `Bearer ${tok('ADMIN', 'd-1')}`)
      .send({ gradeBookPeriodId: GBP_ID, section: 'ALL', status: 'ENDORSED' })

    expect(res.status).toBe(201)
    expect(prismaMock.endorsement.create).toHaveBeenCalled()
  })
})

describe('ciclo archivado (RF-110, RF-111)', () => {
  it('no se visa una libreta de un ciclo pasado a histórico', async () => {
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue(
      gbpRow([], { gradeBook: { id: 'gb-1', status: 'ARCHIVED', subject: { id: 's-1', name: 'Matemática' } } }),
    )

    const res = await request(app())
      .post('/admin/gradebook/endorsements')
      .set('Authorization', `Bearer ${tok('ADMIN', 'd-1')}`)
      .send({ gradeBookPeriodId: GBP_ID, section: 'ALL', status: 'ENDORSED' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('SCHOOL_YEAR_CLOSED')
    expect(prismaMock.endorsement.create).not.toHaveBeenCalled()
  })
})
