import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { signAccessToken } from '../test-utils/bearer-token.js'

const { prismaMock, rosterMock, scopeMock } = vi.hoisted(() => ({
  prismaMock: {
    courseOffering: { findMany: vi.fn(), findUnique: vi.fn() },
    courseOrientation: { findMany: vi.fn(), findUnique: vi.fn() },
    orientation: { findUnique: vi.fn() },
    gradeBook: { findMany: vi.fn(), findUnique: vi.fn() },
    gradingScale: { findFirst: vi.fn() },
    student: { findUnique: vi.fn(), findMany: vi.fn() },
    studentEnrollment: { findMany: vi.fn() },
    periodGrade: { findMany: vi.fn() },
    academicPeriod: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    gradeBookPeriod: { findMany: vi.fn(), findUnique: vi.fn() },
    gradeBookAccessLog: { findMany: vi.fn() },
    endorsement: { create: vi.fn() },
    academicAlertRule: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn() },
    inAppNotification: { createMany: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(1),
    teacherMeetingRecord: { findMany: vi.fn(), create: vi.fn() },
    studentConductRecord: { findMany: vi.fn(), upsert: vi.fn() },
    studentAttendanceEntry: { findMany: vi.fn() },
    $transaction: vi.fn(),
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
  prismaMock.studentConductRecord.findMany.mockResolvedValue([])
  prismaMock.studentAttendanceEntry.findMany.mockResolvedValue([])
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
  prismaMock.academicAlertRule.findMany.mockResolvedValue([])
  prismaMock.auditLog.findMany.mockResolvedValue([])
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
      { gradeBookId: 'gb-1', status: 'CLOSED', grades: [{ studentId: STUDENT_ID, valueHundredths: 300, meetingValueHundredths: 300, conceptualJudgement: 'Debe reforzar.' }] },
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

  it('marca en alerta con el umbral configurado del ciclo, no con un número fijo', async () => {
    prismaMock.gradeBook.findMany.mockResolvedValue([book({ id: 'gb-1' })])
    rosterMock.mockResolvedValue([
      { studentId: STUDENT_ID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      { gradeBookId: 'gb-1', status: 'CLOSED', grades: [{ studentId: STUDENT_ID, valueHundredths: 300, meetingValueHundredths: 300 }] },
    ])

    // Por defecto hacen falta 3 asignaturas en alerta: con una sola, no.
    const byDefault = await request(app()).get(url).set('Authorization', `Bearer ${tok()}`)
    expect(byDefault.body.students[0].atRisk).toBe(false)
    expect(byDefault.body.alertSubjectsThreshold).toBe(3)

    prismaMock.academicAlertRule.findMany.mockResolvedValue([
      { type: 'ALERT_SUBJECTS', schoolYearId: 'sy-1', threshold: 1, isActive: true },
    ])
    const configured = await request(app()).get(url).set('Authorization', `Bearer ${tok()}`)
    expect(configured.body.students[0].atRisk).toBe(true)
    expect(configured.body.alertSubjectsThreshold).toBe(1)
  })

  it('con la regla apagada nadie queda marcado', async () => {
    prismaMock.gradeBook.findMany.mockResolvedValue([book({ id: 'gb-1' })])
    rosterMock.mockResolvedValue([
      { studentId: STUDENT_ID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      { gradeBookId: 'gb-1', status: 'CLOSED', grades: [{ studentId: STUDENT_ID, valueHundredths: 300, meetingValueHundredths: 300 }] },
    ])
    prismaMock.academicAlertRule.findMany.mockResolvedValue([
      { type: 'ALERT_SUBJECTS', schoolYearId: null, threshold: 1, isActive: false },
    ])

    const res = await request(app()).get(url).set('Authorization', `Bearer ${tok()}`)
    expect(res.body.students[0].atRisk).toBe(false)
    expect(res.body.alertSubjectsThreshold).toBeNull()
  })

  it('sin R la materia queda pendiente: la C se muestra como propuesta y no promedia', async () => {
    prismaMock.gradeBook.findMany.mockResolvedValue([book({ id: 'gb-1' })])
    rosterMock.mockResolvedValue([
      { studentId: STUDENT_ID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      { gradeBookId: 'gb-1', status: 'OPEN', grades: [{ studentId: STUDENT_ID, valueHundredths: 300, meetingValueHundredths: null }] },
    ])

    const res = await request(app()).get(url).set('Authorization', `Bearer ${tok()}`)

    const row = res.body.students[0]
    expect(row.cells[0]).toMatchObject({ valueHundredths: null, proposedValueHundredths: 300, pending: true })
    expect(row.averageHundredths).toBeNull()
    expect(row.alertCount).toBe(0)
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

  beforeEach(() => {
    prismaMock.teacherMeetingRecord.findMany.mockResolvedValue([])
    prismaMock.academicPeriod.findMany.mockResolvedValue([])
  })

  it('arma trayectoria, histórico y evolución por ciclo', async () => {
    prismaMock.student.findUnique.mockResolvedValue({ id: STUDENT_ID, firstName: 'Ana', lastName: 'B', documentId: null, email: null })
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      { schoolYearId: 'sy-1', schoolYear: { id: 'sy-1', code: 2026, label: '2026' }, courseOffering: { course: { name: '3 EMS', level: 'EMS' } }, orientation: null, courseOrientation: { orientation: { name: 'Cs. de la Vida' } }, enrollmentStatus: 'ACTIVE' },
    ])
    const gradeBook = {
      subject: { name: 'Matemática' },
      schoolYear: { code: 2026, label: '2026' },
      courseOffering: { course: { name: '3 EMS' } },
      courseOrientation: null,
    }
    prismaMock.periodGrade.findMany.mockResolvedValue([
      { valueHundredths: 900, meetingValueHundredths: 900, conceptualJudgement: null, gradeBookPeriod: { period: { code: 'P1', name: 'Uno', sortOrder: 10, isMeeting: true }, gradeBook } },
      { valueHundredths: 700, meetingValueHundredths: 700, conceptualJudgement: null, gradeBookPeriod: { period: { code: 'P2', name: 'Dos', sortOrder: 20, isMeeting: true }, gradeBook } },
      { valueHundredths: 500, meetingValueHundredths: 500, conceptualJudgement: null, gradeBookPeriod: { period: { code: 'P3', name: 'Tres', sortOrder: 30, isMeeting: true }, gradeBook } },
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

  it('suma faltas, conducta, decisiones y las reuniones con boletín de cada año', async () => {
    prismaMock.student.findUnique.mockResolvedValue({ id: STUDENT_ID, firstName: 'Ana', lastName: 'B', documentId: null, email: null })
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      { schoolYearId: 'sy-1', schoolYear: { id: 'sy-1', code: 2026, label: '2026' }, courseOffering: { course: { name: '3 EMS', level: 'EMS' } }, orientation: null, courseOrientation: null, enrollmentStatus: 'ACTIVE' },
    ])
    prismaMock.periodGrade.findMany.mockResolvedValue([])
    prismaMock.studentAttendanceEntry.findMany.mockResolvedValue([
      { studentId: STUDENT_ID, status: 'ABSENT', absenceWeightHundredths: null, session: { occurrenceYmd: '2026-05-04' } },
      { studentId: STUDENT_ID, status: 'ABSENT_JUSTIFIED', absenceWeightHundredths: null, session: { occurrenceYmd: '2026-05-05' } },
    ])
    prismaMock.studentConductRecord.findMany.mockResolvedValue([
      { periodId: 'p-2', valueHundredths: 900, period: { name: '2.º semestre', sortOrder: 20, schoolYearId: 'sy-1' } },
      { periodId: 'p-1', valueHundredths: 300, period: { name: '1.er semestre', sortOrder: 10, schoolYearId: 'sy-1' } },
      { periodId: 'p-x', valueHundredths: 300, period: { name: 'De otro año', sortOrder: 10, schoolYearId: 'sy-0' } },
    ])
    prismaMock.teacherMeetingRecord.findMany.mockResolvedValue([
      { id: 'd-1', decision: 'Se cita a la familia.', createdAt: new Date('2026-06-10T12:00:00Z'), period: { name: '1.er semestre', schoolYearId: 'sy-1' }, createdBy: { name: 'Laura' } },
    ])
    prismaMock.academicPeriod.findMany.mockResolvedValue([
      { id: 'p-1', name: '1.er semestre', level: 'EMS', schoolYearId: 'sy-1', isMeeting: true, requiresGeneralGrade: true, requiresConceptualJudgement: true },
      { id: 'p-feb', name: 'Febrero', level: 'EMS', schoolYearId: 'sy-1', isMeeting: true, requiresGeneralGrade: true, requiresConceptualJudgement: false },
      { id: 'p-ebi', name: '1.ª Entrega', level: 'EBI', schoolYearId: 'sy-1', isMeeting: true, requiresGeneralGrade: true, requiresConceptualJudgement: true },
    ])

    const res = await request(app())
      .get(`/admin/gradebook/students/${STUDENT_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    const year = res.body.enrollments[0]
    expect(year.schoolYearId).toBe('sy-1')
    expect(year.absences).toEqual({ absenceHundredths: 200, justified: 1 })
    // En orden de la planilla y sólo los del año.
    expect(year.conduct.map((c: any) => c.periodName)).toEqual(['1.er semestre', '2.º semestre'])
    expect(year.conduct[0].label).toBe('3')
    // Boletín sólo de las reuniones de boletín de su nivel: sin febrero ni las de EBI.
    expect(year.reportCardPeriods).toEqual([{ id: 'p-1', name: '1.er semestre' }])
    expect(res.body.decisions[0]).toMatchObject({ decision: 'Se cita a la familia.', periodName: '1.er semestre', createdByName: 'Laura' })
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

  it('las decisiones son del grupo con su orientación: no se mezclan entre orientaciones', async () => {
    prismaMock.teacherMeetingRecord.findMany.mockResolvedValue([])
    await request(app())
      .get(`/admin/gradebook/meeting-records?courseOfferingId=${OFFERING_ID}&courseOrientationId=${CO_ID}&periodId=${PERIOD_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(prismaMock.teacherMeetingRecord.findMany.mock.calls[0][0].where).toEqual({
      courseOfferingId: OFFERING_ID,
      courseOrientationId: CO_ID,
      periodId: PERIOD_ID,
    })
  })

  it('un curso sin orientaciones sólo trae las decisiones sin orientación', async () => {
    prismaMock.teacherMeetingRecord.findMany.mockResolvedValue([])
    await request(app())
      .get(`/admin/gradebook/meeting-records?courseOfferingId=${OFFERING_ID}&periodId=${PERIOD_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(prismaMock.teacherMeetingRecord.findMany.mock.calls[0][0].where.courseOrientationId).toBeNull()
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

  it('por defecto sólo los períodos con reunión; con all=true, todos', async () => {
    prismaMock.academicPeriod.findMany.mockResolvedValue([])
    await request(app()).get('/admin/gradebook/periods').set('Authorization', `Bearer ${tok()}`)
    expect(prismaMock.academicPeriod.findMany.mock.calls[0][0].where.isMeeting).toBe(true)

    await request(app()).get('/admin/gradebook/periods?all=true').set('Authorization', `Bearer ${tok()}`)
    expect(prismaMock.academicPeriod.findMany.mock.calls[1][0].where).not.toHaveProperty('isMeeting')
  })

  it('con reportCard=true deja sólo las reuniones de boletín: sin exámenes ni APE', async () => {
    const meeting = { isMeeting: true, requiresGeneralGrade: true }
    prismaMock.academicPeriod.findMany.mockResolvedValue([
      { id: 'e1', name: '1.ª Entrega', level: 'EBI', ...meeting, requiresConceptualJudgement: true },
      { id: 'ape', name: 'APE diciembre', level: 'EBI', isMeeting: true, requiresGeneralGrade: false, requiresConceptualJudgement: false },
      { id: 's1', name: '1.er semestre', level: 'EMS', ...meeting, requiresConceptualJudgement: true },
      { id: 'exd', name: 'Exámenes diciembre', level: 'EMS', ...meeting, requiresConceptualJudgement: false },
    ])
    const res = await request(app()).get('/admin/gradebook/periods?reportCard=true').set('Authorization', `Bearer ${tok()}`)
    expect(res.body.data.map((p: { id: string }) => p.id)).toEqual(['e1', 's1'])
  })

  it('marca cuáles son de boletín: la carga y el cierre se controlan sólo en esas', async () => {
    prismaMock.academicPeriod.findMany.mockResolvedValue([
      { id: 'e1', name: '1.ª Entrega', level: 'EBI', isMeeting: true, requiresGeneralGrade: true, requiresConceptualJudgement: true },
      { id: 'exd', name: 'Exámenes diciembre', level: 'EMS', isMeeting: true, requiresGeneralGrade: true, requiresConceptualJudgement: false },
    ])
    const res = await request(app()).get('/admin/gradebook/periods').set('Authorization', `Bearer ${tok()}`)
    expect(res.body.data.map((p: { id: string; reportCard: boolean }) => [p.id, p.reportCard])).toEqual([
      ['e1', true],
      ['exd', false],
    ])
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

describe('conducta institucional', () => {
  const SY_ID = '11111111-1111-4111-8111-111111111111'
  const P_ID = '22222222-2222-4222-8222-222222222222'
  const S_ID = '33333333-3333-4333-8333-333333333333'

  const CONDUCT_LEVELS = [100, 200, 300, 400].map((v, i) => ({
    id: `c-${v}`,
    label: ['Mala', 'Regular', 'Buena', 'Muy buena'][i],
    minValueHundredths: v,
    maxValueHundredths: v,
  }))

  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (ops: unknown[]) => ops)
    prismaMock.studentConductRecord.upsert.mockResolvedValue({ id: 'c-1' })
    prismaMock.studentConductRecord.findMany.mockResolvedValue([])
    prismaMock.academicPeriod.findFirst.mockResolvedValue({ id: P_ID })
    prismaMock.gradingScale.findFirst.mockResolvedValue({ levels: CONDUCT_LEVELS })
  })

  it('guarda una nota por estudiante y período', async () => {
    // Es la conducta que adscripción lleva a la reunión: una sola, del liceo entero.
    const res = await request(app())
      .put('/admin/gradebook/conduct')
      .set('Authorization', `Bearer ${tok()}`)
      .send({
        schoolYearId: SY_ID,
        periodId: P_ID,
        entries: [{ studentId: S_ID, valueHundredths: 300, notes: 'Mejoró mucho' }],
      })

    expect(res.status).toBe(200)
    const call = prismaMock.studentConductRecord.upsert.mock.calls[0][0]
    expect(call.where.studentId_periodId).toEqual({ studentId: S_ID, periodId: P_ID })
    expect(call.update.valueHundredths).toBe(300)
  })

  it('exige el período al consultar', async () => {
    const res = await request(app()).get('/admin/gradebook/conduct').set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(400)
  })

  it('el período tiene que ser del ciclo indicado', async () => {
    prismaMock.academicPeriod.findFirst.mockResolvedValue(null)
    const res = await request(app())
      .put('/admin/gradebook/conduct')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ schoolYearId: SY_ID, periodId: P_ID, entries: [{ studentId: S_ID, valueHundredths: 300 }] })

    expect(res.status).toBe(404)
    expect(prismaMock.academicPeriod.findFirst.mock.calls[0][0].where).toEqual({ id: P_ID, schoolYearId: SY_ID })
    expect(prismaMock.studentConductRecord.upsert).not.toHaveBeenCalled()
  })

  it('sólo acepta valores de la escala de conducta', async () => {
    const res = await request(app())
      .put('/admin/gradebook/conduct')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ schoolYearId: SY_ID, periodId: P_ID, entries: [{ studentId: S_ID, valueHundredths: 250 }] })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('CONDUCT_OUT_OF_SCALE')
    expect(prismaMock.studentConductRecord.upsert).not.toHaveBeenCalled()
  })

  it('borrar la conducta (null) siempre vale', async () => {
    const res = await request(app())
      .put('/admin/gradebook/conduct')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ schoolYearId: SY_ID, periodId: P_ID, entries: [{ studentId: S_ID, valueHundredths: null }] })
    expect(res.status).toBe(200)
  })

  it('acepta 10 y rechaza 11 aunque falte la escala de conducta', async () => {
    prismaMock.gradingScale.findFirst.mockResolvedValue(null)
    for (const [valueHundredths, status] of [[1000, 200], [1100, 400], [0, 400], [250, 400]]) {
      const res = await request(app())
        .put('/admin/gradebook/conduct')
        .set('Authorization', `Bearer ${tok()}`)
        .send({ schoolYearId: SY_ID, periodId: P_ID, entries: [{ studentId: S_ID, valueHundredths }] })
      expect(res.status).toBe(status)
    }
  })

  it('rechaza un cuerpo sin estudiantes', async () => {
    const res = await request(app())
      .put('/admin/gradebook/conduct')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ schoolYearId: SY_ID, periodId: P_ID, entries: [] })

    expect(res.status).toBe(400)
    expect(prismaMock.studentConductRecord.upsert).not.toHaveBeenCalled()
  })
})

describe('la matriz sirve para la reunión', () => {
  const matrixUrl = `/admin/gradebook/group-matrix?courseOfferingId=${OFFERING_ID}&periodId=${PERIOD_ID}`

  it('trae rendimiento, conducta e inasistencias juntos', async () => {
    // Es lo que se mira en la reunión: las tres cosas del estudiante a la vez.
    rosterMock.mockResolvedValue([
      { studentId: STUDENT_ID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    prismaMock.studentConductRecord.findMany.mockResolvedValue([
      { studentId: STUDENT_ID, valueHundredths: 300 },
    ])
    prismaMock.studentAttendanceEntry.findMany.mockResolvedValue([
      { studentId: STUDENT_ID, status: 'ABSENT', absenceWeightHundredths: null, session: { occurrenceYmd: '2026-05-04' } },
      { studentId: STUDENT_ID, status: 'ABSENT', absenceWeightHundredths: 50, session: { occurrenceYmd: '2026-05-05' } },
    ])

    const res = await request(app()).get(matrixUrl).set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    const row = res.body.students[0]
    expect(row.conductValueHundredths).toBe(300)
    // 1 + 0,5 = 1,5 faltas
    expect(row.absenceHundredths).toBe(150)
  })

  it('el promedio se informa con un decimal: hace falta para escolaridad y abanderados', async () => {
    const res = await request(app()).get(matrixUrl).set('Authorization', `Bearer ${tok()}`)
    expect(res.body.averageDecimals).toBe(1)
  })

  it('las faltas de la reunión son del ciclo, no de una materia', async () => {
    rosterMock.mockResolvedValue([
      { studentId: STUDENT_ID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    await request(app()).get(matrixUrl).set('Authorization', `Bearer ${tok()}`)

    const where = prismaMock.studentAttendanceEntry.findMany.mock.calls[0][0].where
    expect(where.session).not.toHaveProperty('subjectId')
  })
})

describe('boletín', () => {
  const P_ID = '22222222-2222-4222-8222-222222222222'
  const ST_ID = '33333333-3333-4333-8333-333333333333'
  const PERIOD = { id: P_ID, name: 'Mayo', schoolYearId: 'sy-1', level: 'EMS' }

  function enrollment(over: any = {}) {
    return {
      enrollmentStatus: 'ACTIVE',
      courseOfferingId: OFFERING_ID,
      courseOrientationId: null,
      orientationId: null,
      courseOffering: { course: { level: 'EMS' } },
      ...over,
    }
  }

  beforeEach(() => {
    prismaMock.student.findUnique.mockResolvedValue({
      id: ST_ID,
      firstName: 'Ana',
      lastName: 'Díaz',
      documentId: '51234561',
      birthDate: null,
    })
    prismaMock.academicPeriod.findUnique.mockResolvedValue(PERIOD)
    prismaMock.studentEnrollment.findMany.mockResolvedValue([enrollment()])
    prismaMock.gradeBook.findMany.mockResolvedValue([
      book({ id: 'gb-1', subject: { id: 's-1', name: 'Matemática', sortOrder: 10 } }),
      book({ id: 'gb-2', subjectId: 's-2', subject: { id: 's-2', name: 'Historia', sortOrder: 20 } }),
    ])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      { gradeBookId: 'gb-1', grades: [{ studentId: ST_ID, valueHundredths: 800, meetingValueHundredths: 800, conceptualJudgement: 'Muy bien.', conductValueHundredths: 400 }] },
      { gradeBookId: 'gb-2', grades: [] },
    ])
    prismaMock.studentConductRecord.findMany.mockResolvedValue([{ studentId: ST_ID, valueHundredths: 300 }])
    prismaMock.studentAttendanceEntry.findMany.mockResolvedValue([
      { studentId: ST_ID, status: 'ABSENT', absenceWeightHundredths: 50, session: { occurrenceYmd: '2026-05-04' } },
      { studentId: ST_ID, status: 'ABSENT_JUSTIFIED', absenceWeightHundredths: null, session: { occurrenceYmd: '2026-05-05' } },
    ])
  })

  it('junta TODAS las materias del grupo en un solo documento', async () => {
    // Es lo que lo distingue del resto: las demás exportaciones son de una sola libreta.
    const res = await request(app())
      .get(`/admin/gradebook/report-card/${ST_ID}?periodId=${P_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    // El apellido con tilde viaja en `filename*`; el `filename` ASCII es el respaldo.
    expect(res.headers['content-disposition']).toContain(`filename*=UTF-8${"''"}boletin-D%C3%ADaz-Ana.pdf`)
    expect(res.headers['content-disposition']).toContain('filename="boletin-Diaz-Ana.pdf"')
    // Se consultaron las libretas del grupo, no una sola.
    expect(prismaMock.gradeBook.findMany.mock.calls[0][0].where).toEqual({ courseOfferingId: OFFERING_ID })
  })

  it('usa la matrícula del ciclo del período, aunque ya no esté activa', async () => {
    // El boletín de un período pasado sigue siendo del estudiante aunque después se haya ido.
    prismaMock.studentEnrollment.findMany.mockResolvedValue([enrollment({ enrollmentStatus: 'WITHDRAWN', courseOfferingId: 'off-2025' })])

    const res = await request(app())
      .get(`/admin/gradebook/report-card/${ST_ID}?periodId=${P_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(prismaMock.studentEnrollment.findMany.mock.calls[0][0].where).toEqual({ studentId: ST_ID, schoolYearId: 'sy-1' })
    expect(prismaMock.gradeBook.findMany.mock.calls[0][0].where).toEqual({ courseOfferingId: 'off-2025' })
  })

  it('prefiere la matrícula activa si en el año hubo más de una', async () => {
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      enrollment({ enrollmentStatus: 'TRANSFERRED', courseOfferingId: 'off-vieja' }),
      enrollment({ courseOfferingId: 'off-actual' }),
    ])
    await request(app()).get(`/admin/gradebook/report-card/${ST_ID}?periodId=${P_ID}`).set('Authorization', `Bearer ${tok()}`)
    expect(prismaMock.gradeBook.findMany.mock.calls[0][0].where).toEqual({ courseOfferingId: 'off-actual' })
  })

  it('exige el período', async () => {
    const res = await request(app())
      .get(`/admin/gradebook/report-card/${ST_ID}`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(400)
  })

  it('404 si el estudiante no existe', async () => {
    prismaMock.student.findUnique.mockResolvedValue(null)
    const res = await request(app())
      .get(`/admin/gradebook/report-card/${ST_ID}?periodId=${P_ID}`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(404)
  })

  it('409 si no estaba matriculado en ese ciclo: sin grupo no hay boletín', async () => {
    prismaMock.studentEnrollment.findMany.mockResolvedValue([])
    const res = await request(app())
      .get(`/admin/gradebook/report-card/${ST_ID}?periodId=${P_ID}`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('NO_ENROLLMENT')
  })

  it('409 si el período es de otro nivel', async () => {
    prismaMock.studentEnrollment.findMany.mockResolvedValue([enrollment({ courseOffering: { course: { level: 'EBI' } } })])
    const res = await request(app())
      .get(`/admin/gradebook/report-card/${ST_ID}?periodId=${P_ID}`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('LEVEL_MISMATCH')
  })

  describe('boletines del grupo', () => {
    const url = `/admin/gradebook/report-cards?courseOfferingId=${OFFERING_ID}&courseOrientationId=${CO_ID}&periodId=${P_ID}`

    beforeEach(() => {
      prismaMock.courseOffering.findUnique.mockResolvedValue({ schoolYearId: 'sy-1', course: { name: '3 EMS', level: 'EMS' } })
      rosterMock.mockResolvedValue([
        { studentId: ST_ID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'Díaz', documentId: null },
        { studentId: 'st-2', studentEnrollmentId: 'e2', firstName: 'Beto', lastName: 'Ruiz', documentId: null },
      ])
      prismaMock.student.findMany.mockResolvedValue([{ id: ST_ID, birthDate: null }])
    })

    it('arma un PDF con los boletines de todo el grupo', async () => {
      const res = await request(app()).get(url).set('Authorization', `Bearer ${tok()}`)

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('application/pdf')
      expect(rosterMock).toHaveBeenCalledWith({
        schoolYearId: 'sy-1',
        courseOfferingId: OFFERING_ID,
        courseOrientationId: CO_ID,
        orientationId: null,
      })
      // Las notas de los dos estudiantes en una sola consulta.
      expect(prismaMock.gradeBookPeriod.findMany.mock.calls[0][0].include.grades.where).toEqual({
        studentId: { in: [ST_ID, 'st-2'] },
      })
    })

    it('409 si el período no es del grupo', async () => {
      prismaMock.academicPeriod.findUnique.mockResolvedValue({ ...PERIOD, level: 'EBI' })
      const res = await request(app()).get(url).set('Authorization', `Bearer ${tok()}`)
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('PERIOD_MISMATCH')
    })

    it('404 si el grupo no tiene estudiantes', async () => {
      rosterMock.mockResolvedValue([])
      const res = await request(app()).get(url).set('Authorization', `Bearer ${tok()}`)
      expect(res.status).toBe(404)
      expect(res.body.code).toBe('EMPTY_GROUP')
    })

    it('400 sin período', async () => {
      const res = await request(app())
        .get(`/admin/gradebook/report-cards?courseOfferingId=${OFFERING_ID}`)
        .set('Authorization', `Bearer ${tok()}`)
      expect(res.status).toBe(400)
    })
  })
})

describe('control de libretas antes de la reunión', () => {
  const P_ID = '22222222-2222-4222-8222-222222222222'
  const ENTREGA = {
    id: P_ID,
    name: '1.ª Entrega',
    schoolYearId: 'sy-1',
    level: 'EBI',
    kind: 'ENTREGA',
    sortOrder: 4,
    requiresConceptualJudgement: true,
    requiresGeneralGrade: true,
    isMeeting: true,
  }
  const TRAMOS = [
    { id: 'marzo', kind: 'TRAMO', sortOrder: 2 },
    { id: 'mayo', kind: 'TRAMO', sortOrder: 3 },
    { id: P_ID, kind: 'ENTREGA', sortOrder: 4 },
  ]
  const gradedBook = (over: Record<string, unknown> = {}) => ({
    ...book({ id: 'gb-1' }),
    teacherUserId: 'u-1',
    teacher: { id: 'u-1', name: 'Ana Benítez' },
    periods: [
      {
        status: 'OPEN',
        groupReport: null,
        grades: [
          { studentId: 's1', meetingValueHundredths: 800, conductValueHundredths: null, conceptualJudgement: 'Bien' },
          // Un alumno dado de baja con nota no tapa al que falta.
          { studentId: 'baja', meetingValueHundredths: 700, conductValueHundredths: 700, conceptualJudgement: 'Bien' },
        ],
      },
    ],
    assessments: [{ grades: [{ studentId: 's1', valueHundredths: 700, scaleLevelId: null, isAbsent: false }] }],
    ...over,
  })
  const everyone = (value: Record<string, unknown>) => ['s1', 's2'].map((studentId) => ({ studentId, ...value }))

  beforeEach(() => {
    prismaMock.academicPeriod.findUnique = vi.fn().mockResolvedValue(ENTREGA)
    prismaMock.academicPeriod.findMany.mockResolvedValue(TRAMOS)
    rosterMock.mockResolvedValue([
      { studentId: 's1', studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
      { studentId: 's2', studentEnrollmentId: 'e2', firstName: 'Beto', lastName: 'C', documentId: null },
    ])
    prismaMock.gradeBook.findMany.mockResolvedValue([gradedBook()])
  })

  it('dice cuántos alumnos faltan en evaluaciones, R, C, juicio e informe, no sólo que falta algo', async () => {
    const res = await request(app())
      .get(`/admin/gradebook/completeness?periodId=${P_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.data[0]).toMatchObject({
      missingGrades: 1,
      missingConduct: 2,
      missingJudgements: 1,
      missingGroupReport: true,
      missingAssessmentGrades: 1,
      assessmentCount: 1,
      complete: false,
      teacherName: 'Ana Benítez',
    })
  })

  it('sólo mira libretas del nivel del período y evaluaciones de los tramos que cubre', async () => {
    await request(app()).get(`/admin/gradebook/completeness?periodId=${P_ID}`).set('Authorization', `Bearer ${tok()}`)

    const args = prismaMock.gradeBook.findMany.mock.calls[0][0]
    expect(args.where.courseOffering).toEqual({ isOffered: true, course: { level: 'EBI' } })
    expect(args.include.assessments.where).toEqual({ periodId: { in: ['marzo', 'mayo'] }, deletedAt: null })
  })

  it('con R, C, juicio e informe del grupo cargados está lista', async () => {
    prismaMock.gradeBook.findMany.mockResolvedValue([
      gradedBook({
        periods: [
          {
            status: 'OPEN',
            groupReport: 'El grupo avanzó.',
            grades: everyone({ meetingValueHundredths: 800, conductValueHundredths: 800, conceptualJudgement: 'Bien' }),
          },
        ],
        assessments: [{ grades: everyone({ valueHundredths: 700, scaleLevelId: null, isAbsent: false }) }],
      }),
    ])
    const res = await request(app()).get(`/admin/gradebook/completeness?periodId=${P_ID}`).set('Authorization', `Bearer ${tok()}`)
    expect(res.body.data[0].complete).toBe(true)
  })

  it('exige el período', async () => {
    const res = await request(app()).get('/admin/gradebook/completeness').set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(400)
  })

  it('avisa al docente con el detalle que arma el backend', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue({ id: 'gb-1', teacherUserId: 'u-1', subject: { name: 'Matemática' } })

    const res = await request(app())
      .post('/admin/gradebook/completeness/gb-1/request')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ periodId: P_ID })

    expect(res.status).toBe(200)
    expect(res.body.detail).toBe(
      '1.ª Entrega: 1 nota de evaluación sin cargar, 1 sin rendimiento (R), 2 sin conducta (C), 1 sin juicio conceptual y falta el informe del grupo.',
    )
  })

  it('no avisa si la libreta ya está completa', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue({ id: 'gb-1', teacherUserId: 'u-1', subject: { name: 'Matemática' } })
    prismaMock.gradeBook.findMany.mockResolvedValue([gradedBook({ periods: [{ status: 'CLOSED', grades: [] }] })])

    const res = await request(app())
      .post('/admin/gradebook/completeness/gb-1/request')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ periodId: P_ID })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ALREADY_COMPLETE')
  })

  it('no avisa si la libreta no tiene titular: no hay a quién', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue({ id: 'gb-1', teacherUserId: null, subject: { name: 'Matemática' } })

    const res = await request(app())
      .post('/admin/gradebook/completeness/gb-1/request')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ periodId: P_ID })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('NO_TEACHER')
  })

  it('exige el período para avisar', async () => {
    const res = await request(app())
      .post('/admin/gradebook/completeness/gb-1/request')
      .set('Authorization', `Bearer ${tok()}`)
      .send({})
    expect(res.status).toBe(400)
  })

  it('nombra la libreta con su orientación y pide el roster una vez por grupo', async () => {
    prismaMock.gradeBook.findMany.mockResolvedValue([
      gradedBook({ id: 'gb-1', courseOrientation: { orientation: { name: 'Científico' } } }),
      gradedBook({ id: 'gb-2', courseOrientation: { orientation: { name: 'Científico' } } }),
    ])
    const res = await request(app()).get(`/admin/gradebook/completeness?periodId=${P_ID}`).set('Authorization', `Bearer ${tok()}`)

    expect(res.body.data[0].orientationName).toBe('Científico')
    // Las dos libretas son del mismo grupo: el roster se consulta una sola vez.
    expect(rosterMock).toHaveBeenCalledTimes(1)
  })

  it('recuerda cuándo se avisó, por etapa, aunque se recargue la pantalla', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      { entityId: 'gb-1', occurredAt: new Date('2026-06-12T15:00:00Z'), metadata: { periodId: P_ID, stage: 'after' } },
      { entityId: 'gb-1', occurredAt: new Date('2026-06-10T15:00:00Z'), metadata: { periodId: P_ID } },
      { entityId: 'gb-1', occurredAt: new Date('2026-06-09T15:00:00Z'), metadata: { periodId: P_ID, stage: 'before' } },
    ])
    const res = await request(app()).get(`/admin/gradebook/completeness?periodId=${P_ID}`).set('Authorization', `Bearer ${tok()}`)

    expect(res.body.data[0].lastRequestedAt).toEqual({
      before: '2026-06-10T15:00:00.000Z',
      after: '2026-06-12T15:00:00.000Z',
    })
    expect(prismaMock.auditLog.findMany.mock.calls[0][0].where).toMatchObject({
      action: 'GRADEBOOK_COMPLETION_REQUESTED',
      entityType: 'GradeBook',
      entityId: { in: ['gb-1'] },
      metadata: { path: ['periodId'], equals: P_ID },
    })
  })

  it('después de la reunión avisa que falta cerrar', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue({ id: 'gb-1', teacherUserId: 'u-1', subject: { name: 'Matemática' } })
    prismaMock.inAppNotification.createMany.mockResolvedValue({ count: 1 })

    const res = await request(app())
      .post('/admin/gradebook/completeness/gb-1/request')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ periodId: P_ID, stage: 'after' })

    expect(res.status).toBe(200)
    expect(res.body.detail).toBe('1.ª Entrega: falta cerrar el período.')
    expect(prismaMock.inAppNotification.createMany.mock.calls[0][0].data[0].title).toBe('Falta cerrar Matemática')
  })

  it('después de la reunión, una libreta cerrada ya no se avisa', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue({ id: 'gb-1', teacherUserId: 'u-1', subject: { name: 'Matemática' } })
    prismaMock.gradeBook.findMany.mockResolvedValue([gradedBook({ periods: [{ status: 'CLOSED', grades: [] }] })])
    const res = await request(app())
      .post('/admin/gradebook/completeness/gb-1/request')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ periodId: P_ID, stage: 'after' })
    expect(res.status).toBe(409)
  })

  it('avisar a todos manda un aviso por docente, con todas sus libretas', async () => {
    prismaMock.inAppNotification.createMany.mockResolvedValue({ count: 1 })
    prismaMock.gradeBook.findMany.mockResolvedValue([
      gradedBook({ id: 'gb-mat', subject: { name: 'Matemática' } }),
      gradedBook({ id: 'gb-fis', subject: { name: 'Física' } }),
      gradedBook({ id: 'gb-his', subject: { name: 'Historia' }, teacherUserId: 'u-2', teacher: { id: 'u-2', name: 'Beto' } }),
      gradedBook({ id: 'gb-sin', subject: { name: 'Dibujo' }, teacherUserId: null, teacher: null }),
    ])

    const res = await request(app())
      .post('/admin/gradebook/completeness/request-all')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ periodId: P_ID })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ teachers: 2, gradeBooks: 3, withoutTeacher: 1 })
    const notices = prismaMock.inAppNotification.createMany.mock.calls.map((call: any[]) => call[0].data[0])
    expect(notices).toHaveLength(2)
    const ana = notices.find((n: any) => n.userId === 'u-1')
    expect(ana.title).toBe('1.ª Entrega: falta completar 2 libretas')
    expect(ana.body).toContain('Matemática')
    expect(ana.body).toContain('Física')
    // Cada libreta avisada queda en la auditoría, para que la pantalla muestre "Avisado el…".
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(3)
  })

  it('avisar a todos exige el período', async () => {
    const res = await request(app())
      .post('/admin/gradebook/completeness/request-all')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ stage: 'after' })
    expect(res.status).toBe(400)
  })

  describe('con un grupo elegido', () => {
    const OTHER_CO = '66666666-6666-4666-8666-666666666666'

    it('controla sus libretas y las de tronco común, no las de otra orientación', async () => {
      prismaMock.gradeBook.findMany.mockResolvedValue([
        gradedBook({ id: 'gb-propia', courseOrientationId: CO_ID }),
        gradedBook({ id: 'gb-comun' }),
        gradedBook({ id: 'gb-otra', courseOrientationId: OTHER_CO }),
      ])

      const res = await request(app())
        .get(`/admin/gradebook/completeness?periodId=${P_ID}&courseOfferingId=${OFFERING_ID}&courseOrientationId=${CO_ID}`)
        .set('Authorization', `Bearer ${tok()}`)

      expect(res.body.data.map((row: { gradeBookId: string }) => row.gradeBookId).sort()).toEqual(['gb-comun', 'gb-propia'])
      expect(prismaMock.gradeBook.findMany.mock.calls[0][0].where.courseOfferingId).toBe(OFFERING_ID)
    })

    it('sin orientación trae todas las libretas de la oferta', async () => {
      await request(app())
        .get(`/admin/gradebook/completeness?periodId=${P_ID}&courseOfferingId=${OFFERING_ID}`)
        .set('Authorization', `Bearer ${tok()}`)

      expect(prismaMock.gradeBook.findMany.mock.calls[0][0].where.courseOfferingId).toBe(OFFERING_ID)
    })

    it('avisar a todos avisa sólo por las libretas del grupo', async () => {
      prismaMock.inAppNotification.createMany.mockResolvedValue({ count: 1 })
      prismaMock.gradeBook.findMany.mockResolvedValue([
        gradedBook({ id: 'gb-propia', courseOrientationId: CO_ID }),
        gradedBook({ id: 'gb-otra', courseOrientationId: OTHER_CO, teacherUserId: 'u-2', teacher: { id: 'u-2', name: 'Beto' } }),
      ])

      const res = await request(app())
        .post('/admin/gradebook/completeness/request-all')
        .set('Authorization', `Bearer ${tok()}`)
        .send({ periodId: P_ID, courseOfferingId: OFFERING_ID, courseOrientationId: CO_ID })

      expect(res.body).toEqual({ teachers: 1, gradeBooks: 1, withoutTeacher: 0 })
      const notified = prismaMock.inAppNotification.createMany.mock.calls.map((call: any[]) => call[0].data[0].userId)
      expect(notified).toEqual(['u-1'])
    })
  })
})

describe('GET /endorsements — filtros y avance', () => {
  it('no corta filas antes de filtrar las pendientes: las más nuevas no se pierden', async () => {
    await request(app()).get('/admin/gradebook/endorsements?pending=true').set('Authorization', `Bearer ${tok()}`)
    expect(prismaMock.gradeBookPeriod.findMany.mock.calls[0][0].take).toBeUndefined()
  })

  it('con un grupo elegido trae sus libretas y las de tronco común, no las de otra orientación', async () => {
    const OTHER_CO = '66666666-6666-4666-8666-666666666666'
    const inBook = (id: string, courseOrientationId: string | null) => ({
      ...gbpRow().gradeBook,
      id,
      courseOfferingId: OFFERING_ID,
      courseOrientationId,
      orientationId: null,
    })
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      gbpRow([], { id: 'p-propia', gradeBookId: 'gb-co', gradeBook: inBook('gb-co', CO_ID) }),
      gbpRow([], { id: 'p-comun', gradeBookId: 'gb-comun', gradeBook: inBook('gb-comun', null) }),
      gbpRow([], { id: 'p-otra', gradeBookId: 'gb-otra', gradeBook: inBook('gb-otra', OTHER_CO) }),
    ])

    const res = await request(app())
      .get(`/admin/gradebook/endorsements?courseOfferingId=${OFFERING_ID}&courseOrientationId=${CO_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.body.data.map((row: any) => row.gradeBookPeriodId).sort()).toEqual(['p-comun', 'p-propia'])
    expect(prismaMock.gradeBookPeriod.findMany.mock.calls[0][0].where.gradeBook).toEqual({
      schoolYearId: 'sy-1',
      courseOfferingId: OFFERING_ID,
    })
  })

  it('marca el período que volvió a cerrarse después de la observación', async () => {
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      gbpRow([endorsement('JUDGEMENTS', 'OBSERVED', '2026-06-02T12:00:00Z', { observations: 'Falta el juicio.' })], {
        closedAt: new Date('2026-06-05T12:00:00Z'),
      }),
    ])
    const res = await request(app()).get('/admin/gradebook/endorsements').set('Authorization', `Bearer ${tok()}`)
    expect(res.body.data[0].reclosedAfterObservation).toBe(true)
  })
})

describe('POST /endorsements/bulk', () => {
  const READY = '77777777-7777-4777-8777-777777777777'
  const OBSERVED = '88888888-8888-4888-8888-888888888888'
  const DONE = '99999999-9999-4999-8999-999999999999'
  const MISSING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

  function actingAs(granted: string[]) {
    scopeMock.mockImplementation(async (_u: string, code: string) => (granted.includes(code) ? 'all' : null))
  }

  beforeEach(() => {
    prismaMock.endorsement.create.mockResolvedValue({ id: 'e-1' })
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      gbpRow([], { id: READY }),
      gbpRow([endorsement('CLOSURE', 'OBSERVED', '2026-06-02T12:00:00Z')], { id: OBSERVED }),
      gbpRow([endorsement('ALL', 'ENDORSED', '2026-06-03T12:00:00Z')], { id: DONE }),
    ])
  })

  it('visa lo que está listo y deja afuera, con su motivo, lo que no', async () => {
    const res = await request(app())
      .post('/admin/gradebook/endorsements/bulk')
      .set('Authorization', `Bearer ${tok('ADMIN', 'd-1')}`)
      .send({ gradeBookPeriodIds: [READY, OBSERVED, DONE, MISSING] })

    expect(res.status).toBe(200)
    expect(res.body.endorsed).toBe(1)
    expect(res.body.skipped).toEqual([
      { gradeBookPeriodId: OBSERVED, code: 'SECTIONS_OBSERVED' },
      { gradeBookPeriodId: DONE, code: 'ALREADY_ENDORSED' },
      { gradeBookPeriodId: MISSING, code: 'NOT_FOUND' },
    ])
    expect(prismaMock.endorsement.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.endorsement.create.mock.calls[0][0].data).toMatchObject({
      gradeBookPeriodId: READY,
      section: 'ALL',
      status: 'ENDORSED',
    })
    // Cada libreta visada en lote se audita y se avisa igual que de a una.
    expect(prismaMock.$executeRaw).toHaveBeenCalled()
    expect(prismaMock.inAppNotification.createMany.mock.calls[0][0].data[0]).toMatchObject({ type: 'GRADEBOOK_ENDORSED' })
  })

  it('un período abierto o de un ciclo archivado no se visa', async () => {
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      gbpRow([], { id: READY, status: 'REOPENED' }),
      gbpRow([], { id: OBSERVED, gradeBook: { ...gbpRow().gradeBook, status: 'ARCHIVED' } }),
    ])
    const res = await request(app())
      .post('/admin/gradebook/endorsements/bulk')
      .set('Authorization', `Bearer ${tok('ADMIN', 'd-1')}`)
      .send({ gradeBookPeriodIds: [READY, OBSERVED] })

    expect(res.body.endorsed).toBe(0)
    expect(res.body.skipped.map((s: any) => s.code)).toEqual(['PERIOD_NOT_CLOSED', 'SCHOOL_YEAR_CLOSED'])
    expect(prismaMock.endorsement.create).not.toHaveBeenCalled()
  })

  it('adscripción no visa en lote', async () => {
    actingAs(['gradebook.review'])
    const res = await request(app())
      .post('/admin/gradebook/endorsements/bulk')
      .set('Authorization', `Bearer ${tok('ADMIN', 'ads-1')}`)
      .send({ gradeBookPeriodIds: [READY] })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('CANNOT_ENDORSE')
    expect(prismaMock.endorsement.create).not.toHaveBeenCalled()
  })

  it('400 sin períodos', async () => {
    const res = await request(app())
      .post('/admin/gradebook/endorsements/bulk')
      .set('Authorization', `Bearer ${tok('ADMIN', 'd-1')}`)
      .send({ gradeBookPeriodIds: [] })
    expect(res.status).toBe(400)
  })
})

describe('registro de accesos a la libreta (RF-100)', () => {
  it('lista quién la abrió, de la más nueva a la más vieja', async () => {
    prismaMock.gradeBookAccessLog.findMany.mockResolvedValue([
      { id: 'l-1', user: { name: 'Ana G' }, roleCode: 'TEACHER', ip: '10.0.0.1', occurredAt: new Date('2026-05-10T15:00:00.000Z') },
    ])

    const res = await request(app())
      .get('/admin/gradebook/gradebooks/gb-1/access-log')
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.data[0]).toEqual({
      id: 'l-1',
      userName: 'Ana G',
      roleCode: 'TEACHER',
      ip: '10.0.0.1',
      occurredAt: '2026-05-10T15:00:00.000Z',
    })
    expect(prismaMock.gradeBookAccessLog.findMany.mock.calls[0][0]).toMatchObject({
      where: { gradeBookId: 'gb-1' },
      orderBy: { occurredAt: 'desc' },
    })
  })

  it('un docente no lo ve: es de supervisión', async () => {
    scopeMock.mockResolvedValue('own')
    const res = await request(app())
      .get('/admin/gradebook/gradebooks/gb-1/access-log')
      .set('Authorization', `Bearer ${tok('TEACHER', 't-1')}`)
    expect(res.status).toBe(403)
  })
})
