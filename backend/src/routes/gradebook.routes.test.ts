import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { signAccessToken } from '../test-utils/bearer-token.js'

const { prismaMock, rosterMock, accessMock, scopeMock, saveGradesMock, previewMock, loadReportMock } = vi.hoisted(() => ({
  prismaMock: {
    gradeBook: { findMany: vi.fn(), findUnique: vi.fn() },
    substitution: { findMany: vi.fn() },
    assessment: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
    gradeBookPeriod: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    periodGrade: { findMany: vi.fn(), upsert: vi.fn() },
    gradeBookPlanning: { findUnique: vi.fn(), upsert: vi.fn() },
    student: { findUnique: vi.fn() },
    studentPhoto: { findUnique: vi.fn() },
    courseDevelopmentEntry: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), aggregate: vi.fn() },
    gradeBookMessage: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    gradeBookAccessLog: { create: vi.fn() },
    assessmentGrade: { findMany: vi.fn() },
    studentAttendanceEntry: { groupBy: vi.fn(), findMany: vi.fn() },
    inAppNotification: { createMany: vi.fn() },
    $transaction: vi.fn(),
    academicPeriod: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    gradingScale: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    activityType: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(1),
  },
  saveGradesMock: vi.fn(),
  previewMock: vi.fn(),
  loadReportMock: vi.fn(),
  rosterMock: vi.fn(),
  accessMock: vi.fn(),
  scopeMock: vi.fn(),
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/school-year-service.js', () => ({
  resolveSchoolYearIdForList: vi.fn().mockResolvedValue('sy-1'),
}))
vi.mock('../services/student-attendance/roster.js', () => ({
  loadRosterForScope: rosterMock,
  canResolveRoster: (e: any) => Boolean(e.schoolYearId && e.courseOfferingId),
}))
vi.mock('../services/gradebook/access.js', () => ({ resolveGradeBookAccess: accessMock }))
vi.mock('../config/system-settings.js', () => ({
  getGradeBookSettings: vi.fn().mockResolvedValue({ editWindowDays: 30 }),
}))
vi.mock('../services/gradebook/moodle-import.js', async () => {
  const actual = await vi.importActual<any>('../services/gradebook/moodle-import.js')
  return { ...actual, buildImportPreview: previewMock, loadMoodleReport: loadReportMock }
})
vi.mock('../services/gradebook/grading.js', async () => {
  const actual = await vi.importActual<any>('../services/gradebook/grading.js')
  return { ...actual, saveGrades: saveGradesMock }
})
vi.mock('../middlewares/auth.js', async () => {
  const actual = await vi.importActual<any>('../middlewares/auth.js')
  return { ...actual, userPermissionScope: scopeMock }
})

import gradebookRoutes from './gradebook.js'

function app() {
  const a = express()
  a.use(express.json())
  a.use(cookieParser())
  a.use('/gradebook', gradebookRoutes)
  return a
}

const tok = (role = 'TEACHER', sub = 'teacher-1') =>
  signAccessToken({ sub, email: 't@t.com', role: role as 'TEACHER' })

const GB_ID = '11111111-1111-4111-8111-111111111111'

const ROW = {
  id: GB_ID,
  status: 'ACTIVE',
  scopeKey: 'et-subject-offering-off-1-sub-1',
  schoolYearId: 'sy-1',
  courseOfferingId: 'off-1',
  subjectId: 'sub-1',
  orientationId: null,
  courseOrientationId: null,
  teacherUserId: 'teacher-1',
  subject: { id: 'sub-1', name: 'Matemática', code: 'MAT' },
  orientation: null,
  courseOrientation: null,
  courseOffering: {
    id: 'off-1',
    course: { id: 'c-1', name: '3 EMS', code: '3EMS', level: 'EMS' },
    schoolYear: { id: 'sy-1', code: 2026, label: '2026' },
  },
  teacher: { id: 'teacher-1', name: 'Ana G', username: 'ana.g' },
}

beforeEach(() => {
  vi.clearAllMocks()
  scopeMock.mockResolvedValue('own')
  accessMock.mockResolvedValue({ level: 'OWNER', canRead: true, canGrade: true })
  prismaMock.substitution.findMany.mockResolvedValue([])
  rosterMock.mockResolvedValue([])
  // El registro de acceso (RF-100) y los avisos son fire-and-forget: el mock igual tiene que
  // devolver una promesa, porque el código encadena `.catch()` para no tumbar la lectura.
  prismaMock.gradeBookAccessLog.create.mockResolvedValue({ id: 'log-1' })
  prismaMock.studentAttendanceEntry.groupBy.mockResolvedValue([])
  prismaMock.studentAttendanceEntry.findMany.mockResolvedValue([])
  prismaMock.inAppNotification.createMany.mockResolvedValue({ count: 0 })
})

describe('permisos', () => {
  it('sin sesión responde 401', async () => {
    const res = await request(app()).get('/gradebook/mine')
    expect(res.status).toBe(401)
  })

  it('un alcance nulo o desconocido falla cerrado: filtra por lo propio, no abre todo', async () => {
    // Es la rama que importa: si `userPermissionScope` devuelve null (permiso revocado entre el
    // guard y la consulta), la libreta ajena no puede quedar visible por omisión.
    scopeMock.mockResolvedValue(null)
    prismaMock.gradeBook.findMany.mockResolvedValue([])

    const res = await request(app()).get('/gradebook/mine').set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(prismaMock.gradeBook.findMany.mock.calls[0][0].where.OR).toBeDefined()
  })
})

describe('GET /gradebook/mine', () => {
  it('con alcance own filtra por titular y por suplencias', async () => {
    prismaMock.gradeBook.findMany.mockResolvedValue([ROW])
    const res = await request(app()).get('/gradebook/mine').set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    const where = prismaMock.gradeBook.findMany.mock.calls[0][0].where
    expect(where.schoolYearId).toBe('sy-1')
    expect(where.OR[0]).toEqual({ teacherUserId: 'teacher-1' })
  })

  it('las libretas suplidas se buscan por scopeKey, no por (oferta, asignatura)', async () => {
    // Si se filtrara por oferta+asignatura, un suplente de una orientación vería las otras.
    prismaMock.substitution.findMany.mockResolvedValue([
      {
        event: {
          schoolYearId: 'sy-1',
          courseOfferingId: 'off-1',
          subjectId: 'sub-1',
          orientationId: null,
          courseOrientationId: 'co-a',
        },
      },
    ])
    prismaMock.gradeBook.findMany.mockResolvedValue([])

    await request(app()).get('/gradebook/mine').set('Authorization', `Bearer ${tok()}`)

    const where = prismaMock.gradeBook.findMany.mock.calls[0][0].where
    expect(where.OR[1]).toEqual({
      scopeKey: { in: ['et-subject-offering-off-1-sub-1-corientation-co-a'] },
    })
  })

  it('con alcance all no filtra por docente', async () => {
    scopeMock.mockResolvedValue('all')
    prismaMock.gradeBook.findMany.mockResolvedValue([])

    await request(app()).get('/gradebook/mine').set('Authorization', `Bearer ${tok('ADMIN', 'a-1')}`)

    expect(prismaMock.gradeBook.findMany.mock.calls[0][0].where).toEqual({ schoolYearId: 'sy-1' })
    expect(prismaMock.substitution.findMany).not.toHaveBeenCalled()
  })

  it('devuelve el encabezado con curso, asignatura y ciclo', async () => {
    prismaMock.gradeBook.findMany.mockResolvedValue([ROW])
    const res = await request(app()).get('/gradebook/mine').set('Authorization', `Bearer ${tok()}`)

    expect(res.body.data[0]).toMatchObject({
      id: GB_ID,
      subject: { name: 'Matemática' },
      course: { name: '3 EMS' },
      schoolYear: { code: 2026 },
    })
  })
})

describe('GET /gradebook/:id', () => {
  it('rechaza un id que no es uuid con 400, no con 404', async () => {
    const res = await request(app()).get('/gradebook/no-es-uuid').set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(400)
  })

  it('404 si la libreta no existe', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(null)
    const res = await request(app()).get(`/gradebook/${GB_ID}`).set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(404)
  })

  it('403 con código semántico si no es su libreta', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    accessMock.mockResolvedValue({ level: 'NONE', canRead: false, canGrade: false })

    const res = await request(app()).get(`/gradebook/${GB_ID}`).set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('NOT_ASSIGNED')
  })

  it('devuelve encabezado, cohorte y si puede calificar', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([
      { studentId: 's1', studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
      { studentId: 's2', studentEnrollmentId: 'e2', firstName: 'Beto', lastName: 'C', documentId: null },
    ])

    const res = await request(app()).get(`/gradebook/${GB_ID}`).set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.studentCount).toBe(2)
    expect(res.body.access).toEqual({ level: 'OWNER', canGrade: true })
  })

  it('cuenta las faltas en unidades, con la media falta', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([
      { studentId: 's1', studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
      { studentId: 's2', studentEnrollmentId: 'e2', firstName: 'Beto', lastName: 'C', documentId: null },
    ])
    prismaMock.studentAttendanceEntry.findMany.mockResolvedValue([
      { studentId: 's1', status: 'ABSENT', absenceWeightHundredths: null },
      { studentId: 's1', status: 'ABSENT', absenceWeightHundredths: 50 },
      { studentId: 's1', status: 'ABSENT_JUSTIFIED', absenceWeightHundredths: null },
      { studentId: 's1', status: 'LATE', absenceWeightHundredths: null },
      { studentId: 's2', status: 'PRESENT', absenceWeightHundredths: null },
    ])

    const res = await request(app()).get(`/gradebook/${GB_ID}`).set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    // 1 + 0,5 + 1 (la justificada cuenta) = 2,5
    expect(res.body.students[0]).toMatchObject({
      studentId: 's1',
      absences: '2,5',
      absenceHundredths: 250,
      justifiedCount: 1,
      lates: 1,
    })
    expect(res.body.students[1]).toMatchObject({ studentId: 's2', absences: '0', absenceHundredths: 0 })
  })

  it('las faltas son GLOBALES del ciclo, no de la asignatura', async () => {
    // El liceo cuenta las faltas del estudiante en el liceo. Antes esto filtraba por `subjectId`
    // y cada docente veía sólo las suyas, que es justo lo contrario de lo que sirve para detectar
    // a quien está faltando.
    prismaMock.gradeBook.findUnique.mockResolvedValue({
      ...ROW,
      courseOrientationId: 'co-a',
      courseOrientation: { id: 'co-a', orientation: { id: 'o-a', name: 'Ciencias de la Vida' } },
    })
    rosterMock.mockResolvedValue([
      { studentId: 's1', studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])

    await request(app()).get(`/gradebook/${GB_ID}`).set('Authorization', `Bearer ${tok()}`)

    const where = prismaMock.studentAttendanceEntry.findMany.mock.calls[0][0].where
    expect(where.studentId).toEqual({ in: ['s1'] })
    expect(where.session).toEqual({ schoolYearId: 'sy-1' })
    expect(where.session).not.toHaveProperty('subjectId')
    expect(where.session).not.toHaveProperty('courseOfferingId')
  })

  it('resuelve la cohorte con la precedencia de orientación de la libreta', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue({
      ...ROW,
      courseOrientationId: 'co-a',
      courseOrientation: { id: 'co-a', orientation: { id: 'o-a', name: 'Ciencias de la Vida' } },
    })

    const res = await request(app()).get(`/gradebook/${GB_ID}`).set('Authorization', `Bearer ${tok()}`)

    expect(rosterMock).toHaveBeenCalledWith({
      schoolYearId: 'sy-1',
      courseOfferingId: 'off-1',
      orientationId: null,
      courseOrientationId: 'co-a',
    })
    expect(res.body.orientation).toBe('Ciencias de la Vida')
  })

  it('409 NO_COHORT si la libreta no tiene oferta', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue({ ...ROW, courseOfferingId: null })
    const res = await request(app()).get(`/gradebook/${GB_ID}`).set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('NO_COHORT')
  })

  it('supervisión lee pero el encabezado dice que no califica', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    accessMock.mockResolvedValue({ level: 'SUPERVISION', canRead: true, canGrade: false })

    const res = await request(app()).get(`/gradebook/${GB_ID}`).set('Authorization', `Bearer ${tok('DIRECCION', 'd-1')}`)

    expect(res.status).toBe(200)
    expect(res.body.access).toEqual({ level: 'SUPERVISION', canGrade: false })
  })
})

// ─── Evaluaciones y calificaciones ──────────────────────────────────────────

const ASSESSMENT_ID = '22222222-2222-4222-8222-222222222222'
const PERIOD_ID = '33333333-3333-4333-8333-333333333333'
const SCALE_ID = '44444444-4444-4444-8444-444444444444'

const SCALE = {
  id: SCALE_ID,
  name: 'Numérica 1 a 10',
  kind: 'NUMERIC',
  decimals: 0,
  minValueHundredths: 100,
  maxValueHundredths: 1000,
  levels: [{ id: 'l-alto', minValueHundredths: 600, maxValueHundredths: 1000 }],
}

const ASSESSMENT = {
  id: ASSESSMENT_ID,
  gradeBookId: GB_ID,
  periodId: PERIOD_ID,
  date: new Date('2026-05-10T12:00:00.000Z'),
  title: 'Escrito 1',
  description: null,
  notes: null,
  source: 'MANUAL',
  period: { id: PERIOD_ID, name: 'Mayo', code: 'MAYO' },
  activityType: null,
  gradingScale: SCALE,
  _count: { grades: 0 },
}

function readyForAssessments() {
  prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
  prismaMock.assessment.findFirst.mockResolvedValue(ASSESSMENT)
  prismaMock.academicPeriod.findUnique.mockResolvedValue({
    schoolYearId: 'sy-1',
    level: 'EMS',
    isActive: true,
  })
  vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'))
}

describe('POST /:id/assessments', () => {
  const body = { periodId: PERIOD_ID, date: '2026-05-10', title: 'Escrito 1', gradingScaleId: SCALE_ID }

  beforeEach(() => {
    readyForAssessments()
    prismaMock.assessment.create.mockResolvedValue(ASSESSMENT)
  })

  it('crea la evaluación guardando la fecha al mediodía UTC', async () => {
    const res = await request(app())
      .post(`/gradebook/${GB_ID}/assessments`)
      .set('Authorization', `Bearer ${tok()}`)
      .send(body)

    expect(res.status).toBe(201)
    expect(prismaMock.assessment.create.mock.calls[0][0].data.date.toISOString()).toBe('2026-05-10T12:00:00.000Z')
  })

  it('rechaza un período de otro ciclo lectivo', async () => {
    prismaMock.academicPeriod.findUnique.mockResolvedValue({ schoolYearId: 'otro', level: 'EMS', isActive: true })

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/assessments`)
      .set('Authorization', `Bearer ${tok()}`)
      .send(body)

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('PERIOD_MISMATCH')
  })

  it('rechaza un período de EBI en una libreta de EMS', async () => {
    prismaMock.academicPeriod.findUnique.mockResolvedValue({ schoolYearId: 'sy-1', level: 'EBI', isActive: true })

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/assessments`)
      .set('Authorization', `Bearer ${tok()}`)
      .send(body)

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('PERIOD_MISMATCH')
  })

  it('quien no puede calificar recibe 403', async () => {
    accessMock.mockResolvedValue({ level: 'SUPERVISION', canRead: true, canGrade: false })

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/assessments`)
      .set('Authorization', `Bearer ${tok('DIRECCION', 'd-1')}`)
      .send(body)

    expect(res.status).toBe(403)
    expect(prismaMock.assessment.create).not.toHaveBeenCalled()
  })
})

describe('DELETE /:id/assessments/:assessmentId', () => {
  beforeEach(() => {
    readyForAssessments()
    prismaMock.assessment.update.mockResolvedValue(ASSESSMENT)
  })

  it('da de baja lógica en vez de destruir', async () => {
    const res = await request(app())
      .delete(`/gradebook/${GB_ID}/assessments/${ASSESSMENT_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(prismaMock.assessment.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date)
  })

  it('la baja se audita esperando el write, no fire-and-forget', async () => {
    await request(app())
      .delete(`/gradebook/${GB_ID}/assessments/${ASSESSMENT_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(prismaMock.$executeRaw).toHaveBeenCalled()
  })
})

describe('PUT /:id/assessments/:assessmentId/grades', () => {
  const entries = [{ studentId: '55555555-5555-4555-8555-555555555555', valueHundredths: 700 }]

  beforeEach(() => {
    readyForAssessments()
    rosterMock.mockResolvedValue([])
    saveGradesMock.mockResolvedValue({ created: 1, updated: 0, unchanged: 0, revisions: 0 })
  })

  it('guarda con origen TEACHER dentro del plazo', async () => {
    const res = await request(app())
      .put(`/gradebook/${GB_ID}/assessments/${ASSESSMENT_ID}/grades`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries })

    expect(res.status).toBe(200)
    expect(saveGradesMock.mock.calls[0][0].origin).toBe('TEACHER')
  })

  it('bloquea al titular fuera de plazo con código semántico', async () => {
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'))
    scopeMock.mockImplementation(async (_u: string, code: string) => (code === 'gradebook.manage' ? null : 'own'))

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/assessments/${ASSESSMENT_ID}/grades`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('WINDOW_EXPIRED')
    expect(saveGradesMock).not.toHaveBeenCalled()
  })

  it('administración con gradebook.manage corrige fuera de plazo, con origen ADMIN_CORRECTION', async () => {
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'))
    scopeMock.mockResolvedValue('all')

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/assessments/${ASSESSMENT_ID}/grades`)
      .set('Authorization', `Bearer ${tok('ADMIN', 'a-1')}`)
      .send({ entries, reason: 'reclamo del estudiante' })

    expect(res.status).toBe(200)
    expect(saveGradesMock.mock.calls[0][0]).toMatchObject({
      origin: 'ADMIN_CORRECTION',
      reason: 'reclamo del estudiante',
    })
    // Escritura excepcional: la auditoría se espera.
    expect(prismaMock.$executeRaw).toHaveBeenCalled()
  })

  it('traduce STUDENT_NOT_IN_ROSTER a 409 con el detalle', async () => {
    const { GradingError } = await vi.importActual<any>('../services/gradebook/grading.js')
    saveGradesMock.mockRejectedValue(
      new GradingError(409, 'STUDENT_NOT_IN_ROSTER', 'Hay estudiantes ajenos.', { studentIds: ['x'] }),
    )

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/assessments/${ASSESSMENT_ID}/grades`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('STUDENT_NOT_IN_ROSTER')
    expect(res.body.detail).toEqual({ studentIds: ['x'] })
  })

  it('rechaza un lote vacío', async () => {
    const res = await request(app())
      .put(`/gradebook/${GB_ID}/assessments/${ASSESSMENT_ID}/grades`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries: [] })

    expect(res.status).toBe(400)
  })
})

describe('GET /:id/assessments/:assessmentId/grades', () => {
  it('devuelve la cohorte, lo cargado y el estado de la ventana', async () => {
    readyForAssessments()
    rosterMock.mockResolvedValue([
      { studentId: 's1', studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    prismaMock.assessmentGrade.findMany.mockResolvedValue([
      { studentId: 's1', valueHundredths: 700, scaleLevelId: 'l-alto', isAbsent: false, comment: null, gradedAt: new Date() },
    ])

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/assessments/${ASSESSMENT_ID}/grades`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.students).toHaveLength(1)
    expect(res.body.grades[0].valueHundredths).toBe(700)
    expect(res.body.permissions).toMatchObject({ canEdit: true, blockedReason: null, outsideWindow: false })
  })
})

describe('GET /:id/options', () => {
  it('acota los períodos al ciclo y al nivel de la libreta', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    prismaMock.academicPeriod.findMany.mockResolvedValue([])
    prismaMock.gradingScale.findMany.mockResolvedValue([])
    prismaMock.activityType.findMany.mockResolvedValue([])

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/options`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    // La libreta es de 3 EMS: no deben ofrecerse los períodos de EBI.
    expect(prismaMock.academicPeriod.findMany.mock.calls[0][0].where).toMatchObject({
      schoolYearId: 'sy-1',
      isActive: true,
      level: 'EMS',
    })
  })

  it('ofrece los tipos globales más los propios del docente', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    prismaMock.academicPeriod.findMany.mockResolvedValue([])
    prismaMock.gradingScale.findMany.mockResolvedValue([])
    prismaMock.activityType.findMany.mockResolvedValue([])

    await request(app()).get(`/gradebook/${GB_ID}/options`).set('Authorization', `Bearer ${tok()}`)

    expect(prismaMock.activityType.findMany.mock.calls[0][0].where.OR).toEqual([
      { scope: 'GLOBAL' },
      { scope: 'TEACHER', ownerUserId: 'teacher-1' },
    ])
  })
})

// ─── Cierre de período ──────────────────────────────────────────────────────

const PERIOD = {
  id: PERIOD_ID,
  code: 'MAYO',
  name: 'Mayo',
  schoolYearId: 'sy-1',
  level: 'EMS',
  isActive: true,
  closesOn: new Date('2026-06-08T12:00:00.000Z'),
  requiresGeneralGrade: true,
  requiresConceptualJudgement: true,
}

const STUDENT_A = '55555555-5555-4555-8555-555555555555'

function readyForClosure(over: { state?: any; saved?: any[] } = {}) {
  prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
  prismaMock.academicPeriod.findFirst.mockResolvedValue(PERIOD)
  prismaMock.gradeBookPeriod.findUnique.mockResolvedValue(over.state ?? { id: 'gbp-1', status: 'OPEN', closedAt: null, closedLate: false, reopenedAt: null, reopenReason: null })
  prismaMock.periodGrade.findMany.mockResolvedValue(over.saved ?? [])
  prismaMock.assessment.findMany.mockResolvedValue([])
  rosterMock.mockResolvedValue([
    { studentId: STUDENT_A, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'Benítez', documentId: null },
  ])
  prismaMock.$transaction.mockResolvedValue([])
  vi.setSystemTime(new Date('2026-05-20T12:00:00.000Z'))
}

const COMPLETE = [{ studentId: STUDENT_A, valueHundredths: 800, conceptualJudgement: 'Progresa bien.' }]

describe('GET /:id/periods/:periodId', () => {
  it('devuelve los bloqueos que impiden cerrar', async () => {
    readyForClosure()
    const res = await request(app())
      .get(`/gradebook/${GB_ID}/periods/${PERIOD_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.blockers.map((b: any) => b.code).sort()).toEqual(['MISSING_GRADES', 'MISSING_JUDGEMENT'])
  })

  it('con todo cargado no hay bloqueos', async () => {
    readyForClosure({ saved: COMPLETE })
    const res = await request(app())
      .get(`/gradebook/${GB_ID}/periods/${PERIOD_ID}`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.body.blockers).toEqual([])
  })

  it('el promedio sugerido se calcula y no se persiste', async () => {
    readyForClosure()
    prismaMock.assessment.findMany.mockResolvedValue([
      {
        grades: [
          { studentId: STUDENT_A, valueHundredths: 600, isAbsent: false },
          { studentId: STUDENT_A, valueHundredths: 800, isAbsent: false },
          // Una ausencia no promedia como cero.
          { studentId: STUDENT_A, valueHundredths: null, isAbsent: true },
        ],
        gradingScale: { levels: [] },
      },
    ])

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/periods/${PERIOD_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    // La libreta del docente NO promedia: el liceo lo pidió explícitamente. Se informa cuántas
    // notas cargó, que sirve para ver a quién le falta, pero ningún promedio.
    expect(res.body.students[0]).not.toHaveProperty('suggestedAverageHundredths')
    expect(res.body.students[0].assessmentCount).toBe(2)
  })

  it('un período cerrado no es editable', async () => {
    readyForClosure({ state: { id: 'gbp-1', status: 'CLOSED', closedAt: new Date(), closedLate: false, reopenedAt: null, reopenReason: null }, saved: COMPLETE })
    const res = await request(app())
      .get(`/gradebook/${GB_ID}/periods/${PERIOD_ID}`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.body.canEdit).toBe(false)
  })
})

describe('POST /:id/periods/:periodId/close', () => {
  it('rechaza el cierre e informa qué falta', async () => {
    readyForClosure()
    const res = await request(app())
      .post(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/close`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('MISSING_GRADES')
    expect(res.body.detail.blockers).toHaveLength(2)
    expect(prismaMock.gradeBookPeriod.update).not.toHaveBeenCalled()
  })

  it('cierra cuando está todo y audita esperando el write', async () => {
    readyForClosure({ saved: COMPLETE })
    prismaMock.gradeBookPeriod.update.mockResolvedValue({})

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/close`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(prismaMock.gradeBookPeriod.update.mock.calls[0][0].data.status).toBe('CLOSED')
    expect(prismaMock.$executeRaw).toHaveBeenCalled()
  })

  it('marca el cierre fuera de plazo', async () => {
    readyForClosure({ saved: COMPLETE })
    vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'))
    prismaMock.gradeBookPeriod.update.mockResolvedValue({})

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/close`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.body.closedLate).toBe(true)
  })

  it('no vuelve a cerrar un período ya cerrado', async () => {
    readyForClosure({ state: { id: 'gbp-1', status: 'CLOSED', closedAt: new Date(), closedLate: false, reopenedAt: null, reopenReason: null }, saved: COMPLETE })
    const res = await request(app())
      .post(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/close`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ALREADY_CLOSED')
  })

  it('un período que no exige juicio cierra sin él', async () => {
    readyForClosure({ saved: [{ studentId: STUDENT_A, valueHundredths: 800, conceptualJudgement: null }] })
    prismaMock.academicPeriod.findFirst.mockResolvedValue({ ...PERIOD, requiresConceptualJudgement: false })
    prismaMock.gradeBookPeriod.update.mockResolvedValue({})

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/close`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(200)
  })
})

describe('PUT /:id/periods/:periodId/grades', () => {
  it('guarda con snapshot de identidad', async () => {
    readyForClosure()
    await request(app())
      .put(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/grades`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries: COMPLETE })

    const create = prismaMock.periodGrade.upsert.mock.calls[0][0].create
    expect(create).toMatchObject({ studentLastName: 'Benítez', studentFirstName: 'Ana' })
  })

  it('rechaza escribir en un período cerrado', async () => {
    readyForClosure({ state: { id: 'gbp-1', status: 'CLOSED', closedAt: new Date(), closedLate: false, reopenedAt: null, reopenReason: null } })
    const res = await request(app())
      .put(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/grades`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries: COMPLETE })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('PERIOD_CLOSED')
  })

  it('un período REOPENED vuelve a admitir escritura', async () => {
    readyForClosure({ state: { id: 'gbp-1', status: 'REOPENED', closedAt: new Date(), closedLate: false, reopenedAt: new Date(), reopenReason: 'error' } })
    const res = await request(app())
      .put(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/grades`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries: COMPLETE })
    expect(res.status).toBe(200)
  })

  it('rechaza a un estudiante ajeno al grupo', async () => {
    readyForClosure()
    const res = await request(app())
      .put(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/grades`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries: [{ studentId: '99999999-9999-4999-8999-999999999999', valueHundredths: 700 }] })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('STUDENT_NOT_IN_ROSTER')
  })
})

describe('POST /:id/periods/:periodId/reopen', () => {
  const closed = { id: 'gbp-1', status: 'CLOSED', closedAt: new Date('2026-06-01T12:00:00Z'), closedLate: false, reopenedAt: null, reopenReason: null }

  it('exige motivo', async () => {
    readyForClosure({ state: closed })
    const res = await request(app())
      .post(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/reopen`)
      .set('Authorization', `Bearer ${tok('ADMIN', 'a-1')}`)
      .send({})
    expect(res.status).toBe(400)
  })

  it('reabre conservando el cierre previo', async () => {
    readyForClosure({ state: closed })
    prismaMock.gradeBookPeriod.update.mockResolvedValue({})

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/reopen`)
      .set('Authorization', `Bearer ${tok('ADMIN', 'a-1')}`)
      .send({ reason: 'error de carga detectado por dirección' })

    expect(res.status).toBe(200)
    const data = prismaMock.gradeBookPeriod.update.mock.calls[0][0].data
    expect(data.status).toBe('REOPENED')
    // El cierre anterior NO se borra: es lo que sostiene el visado histórico (RF-083).
    expect(data).not.toHaveProperty('closedAt')
    expect(data).not.toHaveProperty('closedByUserId')
  })

  it('no reabre lo que no está cerrado', async () => {
    readyForClosure()
    const res = await request(app())
      .post(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/reopen`)
      .set('Authorization', `Bearer ${tok('ADMIN', 'a-1')}`)
      .send({ reason: 'porque sí, quiero probar' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('NOT_CLOSED')
  })

  it('un docente no puede reabrir: exige gradebook.manage con alcance all', async () => {
    readyForClosure({ state: closed })
    const res = await request(app())
      .post(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/reopen`)
      .set('Authorization', `Bearer ${tok('TEACHER', 'teacher-1')}`)
      .send({ reason: 'quiero corregir una nota' })
    expect(res.status).toBe(403)
  })
})

describe('período cerrado congela las evaluaciones', () => {
  it('no se puede editar una nota parcial de un período cerrado', async () => {
    readyForAssessments()
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue({ status: 'CLOSED' })

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/assessments/${ASSESSMENT_ID}/grades`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries: [{ studentId: STUDENT_A, valueHundredths: 700 }] })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('PERIOD_CLOSED')
  })
})

// ─── Importación desde Moodle ───────────────────────────────────────────────

const SCALE_ROW = {
  id: SCALE_ID,
  kind: 'NUMERIC',
  minValueHundredths: 100,
  maxValueHundredths: 1200,
  levels: [],
}

const MOODLE_ITEM = {
  id: 10,
  name: 'Parcial 1',
  itemType: 'mod',
  itemModule: 'assign',
  gradeMin: 0,
  gradeMax: 100,
  hidden: false,
}

function readyForImport(periodStatus: string | null = null) {
  prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
  prismaMock.gradeBookPeriod.findUnique.mockResolvedValue(periodStatus ? { status: periodStatus } : null)
  prismaMock.gradingScale.findUnique.mockResolvedValue(SCALE_ROW)
  prismaMock.assessment.findUnique.mockResolvedValue(null)
  prismaMock.assessment.create.mockResolvedValue({ id: ASSESSMENT_ID })
  rosterMock.mockResolvedValue([
    { studentId: STUDENT_A, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
  ])
  loadReportMock.mockResolvedValue({
    moodleCourseId: 7,
    report: {
      items: [MOODLE_ITEM],
      grades: [{ moodleUserId: 101, idnumber: `et-student-${STUDENT_A}`, itemId: 10, raw: 100 }],
    },
  })
  saveGradesMock.mockResolvedValue({ created: 1, updated: 0, unchanged: 0, revisions: 0 })
}

const importBody = { moodleGradeItemIds: [10], periodId: PERIOD_ID, gradingScaleId: SCALE_ID }

describe('GET /:id/moodle/preview', () => {
  it('devuelve lo que traería sin escribir nada', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([])
    previewMock.mockResolvedValue({ moodleCourseId: 7, items: [], studentsWithoutMoodleAccount: 0 })

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/moodle/preview`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.moodleCourseId).toBe(7)
    expect(prismaMock.assessment.create).not.toHaveBeenCalled()
  })

  it('sin Moodle configurado responde 409, no rompe la libreta', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([])
    const { GradingError } = await vi.importActual<any>('../services/gradebook/grading.js')
    previewMock.mockRejectedValue(new GradingError(409, 'MOODLE_DISABLED', 'Moodle no configurado.'))

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/moodle/preview`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('MOODLE_DISABLED')
  })

  it('quien no califica no puede previsualizar', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    accessMock.mockResolvedValue({ level: 'SUPERVISION', canRead: true, canGrade: false })

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/moodle/preview`)
      .set('Authorization', `Bearer ${tok('DIRECCION', 'd-1')}`)

    expect(res.status).toBe(403)
  })
})

describe('POST /:id/moodle/import', () => {
  it('crea la evaluación con el ítem de Moodle y convierte a la escala destino', async () => {
    readyForImport()

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/moodle/import`)
      .set('Authorization', `Bearer ${tok()}`)
      .send(importBody)

    expect(res.status).toBe(200)
    expect(prismaMock.assessment.create.mock.calls[0][0].data).toMatchObject({
      source: 'MOODLE_IMPORT',
      moodleGradeItemId: 10,
      title: 'Parcial 1',
    })
    // 100/100 en Moodle sobre una escala 1-12 son 12, no 100.
    expect(saveGradesMock.mock.calls[0][0].entries).toEqual([
      { studentId: STUDENT_A, valueHundredths: 1200 },
    ])
  })

  it('reimportar el mismo ítem no crea una segunda evaluación', async () => {
    readyForImport()
    prismaMock.assessment.findUnique.mockResolvedValue({ id: ASSESSMENT_ID, deletedAt: null })

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/moodle/import`)
      .set('Authorization', `Bearer ${tok()}`)
      .send(importBody)

    expect(res.status).toBe(200)
    expect(prismaMock.assessment.create).not.toHaveBeenCalled()
  })

  it('la reimportación deja revisión con origen MOODLE_IMPORT', async () => {
    readyForImport()
    await request(app())
      .post(`/gradebook/${GB_ID}/moodle/import`)
      .set('Authorization', `Bearer ${tok()}`)
      .send(importBody)

    expect(saveGradesMock.mock.calls[0][0].origin).toBe('MOODLE_IMPORT')
  })

  it('NO toca un período cerrado: avisa y no fuerza', async () => {
    readyForImport('CLOSED')

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/moodle/import`)
      .set('Authorization', `Bearer ${tok()}`)
      .send(importBody)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('PERIOD_CLOSED')
    expect(saveGradesMock).not.toHaveBeenCalled()
  })

  it('rechaza una escala sin rango numérico', async () => {
    readyForImport()
    prismaMock.gradingScale.findUnique.mockResolvedValue({ ...SCALE_ROW, maxValueHundredths: null })

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/moodle/import`)
      .set('Authorization', `Bearer ${tok()}`)
      .send(importBody)

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('SCALE_WITHOUT_RANGE')
  })

  it('sólo importa los ítems pedidos', async () => {
    readyForImport()
    loadReportMock.mockResolvedValue({
      moodleCourseId: 7,
      report: {
        items: [MOODLE_ITEM, { ...MOODLE_ITEM, id: 11, name: 'Foro' }],
        grades: [{ moodleUserId: 101, idnumber: `et-student-${STUDENT_A}`, itemId: 10, raw: 100 }],
      },
    })

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/moodle/import`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ ...importBody, moodleGradeItemIds: [10] })

    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].moodleGradeItemId).toBe(10)
  })

  it('audita la importación esperando el write', async () => {
    readyForImport()
    await request(app())
      .post(`/gradebook/${GB_ID}/moodle/import`)
      .set('Authorization', `Bearer ${tok()}`)
      .send(importBody)

    expect(prismaMock.$executeRaw).toHaveBeenCalled()
  })
})

// ─── Mensajería y trazabilidad de acceso ────────────────────────────────────

describe('registro de acceso (RF-100)', () => {
  it('cada apertura de la libreta queda registrada', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([])

    await request(app()).get(`/gradebook/${GB_ID}`).set('Authorization', `Bearer ${tok()}`)

    expect(prismaMock.gradeBookAccessLog.create.mock.calls[0][0].data).toMatchObject({
      gradeBookId: GB_ID,
      userId: 'teacher-1',
      roleCode: 'TEACHER',
    })
  })

  it('si el registro falla, la lectura igual responde', async () => {
    // Es un registro de consulta, de alto volumen: no puede tumbar la libreta.
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([])
    prismaMock.gradeBookAccessLog.create.mockRejectedValue(new Error('db caída'))

    const res = await request(app()).get(`/gradebook/${GB_ID}`).set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(200)
  })
})

describe('mensajería (RF-090)', () => {
  beforeEach(() => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    prismaMock.gradeBookMessage.create.mockResolvedValue({
      id: 'msg-1',
      body: 'Consulta sobre el cierre.',
      author: { id: 'teacher-1', name: 'Ana G' },
    })
  })

  it('lista el hilo en orden cronológico', async () => {
    prismaMock.gradeBookMessage.findMany.mockResolvedValue([])
    await request(app()).get(`/gradebook/${GB_ID}/messages`).set('Authorization', `Bearer ${tok()}`)
    expect(prismaMock.gradeBookMessage.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' })
  })

  it('publica congelando el rol del autor', async () => {
    const res = await request(app())
      .post(`/gradebook/${GB_ID}/messages`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ body: 'Consulta sobre el cierre.' })

    expect(res.status).toBe(201)
    expect(prismaMock.gradeBookMessage.create.mock.calls[0][0].data).toMatchObject({
      gradeBookId: GB_ID,
      authorUserId: 'teacher-1',
      authorRoleCode: 'TEACHER',
    })
  })

  it('rechaza un mensaje vacío', async () => {
    const res = await request(app())
      .post(`/gradebook/${GB_ID}/messages`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ body: '   ' })
    expect(res.status).toBe(400)
  })

  it('no deja responder a un mensaje de otra libreta', async () => {
    // Un hilo que cruza libretas filtraría contenido de un grupo a otro.
    prismaMock.gradeBookMessage.findFirst.mockResolvedValue(null)

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/messages`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ body: 'Respondo.', parentId: '99999999-9999-4999-8999-999999999999' })

    expect(res.status).toBe(404)
    expect(prismaMock.gradeBookMessage.create).not.toHaveBeenCalled()
  })

  it('avisa al titular, salvo que sea quien escribió', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    await request(app())
      .post(`/gradebook/${GB_ID}/messages`)
      .set('Authorization', `Bearer ${tok('DIRECCION', 'd-1')}`)
      .send({ body: 'Revisá el cierre.' })

    expect(prismaMock.inAppNotification.createMany).toHaveBeenCalled()
    const rows = prismaMock.inAppNotification.createMany.mock.calls[0][0].data
    expect(rows[0]).toMatchObject({ userId: 'teacher-1', type: 'GRADEBOOK_MESSAGE' })
  })

  it('quien escribe no se autonotifica', async () => {
    await request(app())
      .post(`/gradebook/${GB_ID}/messages`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ body: 'Anoto algo.' })
    expect(prismaMock.inAppNotification.createMany).not.toHaveBeenCalled()
  })
})

// ─── Exportaciones (RF-120) ─────────────────────────────────────────────────

import { exportFilename } from './gradebook.js'

describe('exportFilename', () => {
  it('quita acentos y separadores para un nombre de archivo seguro', () => {
    expect(exportFilename(['Matemática', '3 EMS', 'Ciencias de la Vida', '2026'], 'xlsx')).toBe(
      'matematica-3-ems-ciencias-de-la-vida-2026.xlsx',
    )
  })

  it('no deja que un nombre con barras arme una ruta', () => {
    expect(exportFilename(['../../etc/passwd'], 'pdf')).toBe('etc-passwd.pdf')
  })

  it('con partes vacías cae a un nombre por defecto', () => {
    expect(exportFilename(['', ''], 'pdf')).toBe('libreta.pdf')
  })
})

describe('exportaciones de la libreta', () => {
  beforeEach(() => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    prismaMock.assessment.findFirst.mockResolvedValue(null)
    prismaMock.gradingScale.findFirst.mockResolvedValue({ decimals: 0, levels: [] })
    prismaMock.assessment.findMany.mockResolvedValue([])
    prismaMock.assessmentGrade.findMany.mockResolvedValue([])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([])
    rosterMock.mockResolvedValue([
      { studentId: STUDENT_A, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'Benítez', documentId: null },
    ])
  })

  it('el Excel se descarga con su tipo y nombre', async () => {
    const res = await request(app())
      .get(`/gradebook/${GB_ID}/exports/xlsx`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('spreadsheetml')
    expect(res.headers['content-disposition']).toContain('matematica-3-ems')
  })

  it('el PDF de la libreta se descarga como PDF', async () => {
    const res = await request(app())
      .get(`/gradebook/${GB_ID}/exports/pdf`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
  })

  it('el informe individual falla claro si el alumno no tiene cierres', async () => {
    const res = await request(app())
      .get(`/gradebook/${GB_ID}/exports/students/${STUDENT_A}/pdf`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(404)
    expect(res.body.message).toContain('no tiene cierres')
  })

  it('genera el informe individual cuando hay cierre', async () => {
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      {
        period: { name: 'Mayo', sortOrder: 20 },
        endorsements: [{ status: 'ENDORSED' }],
        grades: [
          {
            studentId: STUDENT_A,
            studentLastName: 'Benítez',
            studentFirstName: 'Ana',
            studentDocumentId: null,
            valueHundredths: 800,
            conceptualJudgement: 'Progresa bien.',
          },
        ],
      },
    ])

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/exports/students/${STUDENT_A}/pdf`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toContain('benitez-ana')
  })

  it('quien no accede a la libreta tampoco la exporta', async () => {
    accessMock.mockResolvedValue({ level: 'NONE', canRead: false, canGrade: false })
    const res = await request(app())
      .get(`/gradebook/${GB_ID}/exports/pdf`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(403)
  })
})

describe('ciclo archivado (RF-110, RF-111)', () => {
  const ARCHIVED = { ...ROW, status: 'ARCHIVED' }

  it('la libreta se sigue consultando', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ARCHIVED)
    rosterMock.mockResolvedValue([])
    accessMock.mockResolvedValue({ level: 'OWNER', canRead: true, canGrade: false })

    const res = await request(app()).get(`/gradebook/${GB_ID}`).set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.access.canGrade).toBe(false)
  })

  it('no se escriben mensajes nuevos', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ARCHIVED)

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/messages`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ body: 'Consulta tardía.' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('SCHOOL_YEAR_CLOSED')
    expect(prismaMock.gradeBookMessage.create).not.toHaveBeenCalled()
  })

  it('el hilo anterior se sigue leyendo', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ARCHIVED)
    prismaMock.gradeBookMessage.findMany.mockResolvedValue([])

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/messages`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(200)
  })

  it('la exportación sigue disponible: consultar el histórico incluye poder imprimirlo', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ARCHIVED)
    prismaMock.assessment.findFirst.mockResolvedValue(null)
    prismaMock.gradingScale.findFirst.mockResolvedValue({ decimals: 0, levels: [] })
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([])
    rosterMock.mockResolvedValue([])

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/exports/pdf`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(200)
  })
})

describe('dirección: edita la libreta salvo calificaciones y juicios', () => {
  const STUDENT_ID = '99999999-9999-4999-8999-999999999999'

  /**
   * Acceso de dirección sobre una libreta ajena: lee y planifica, no califica.
   * Lo que se prueba acá es el **cableado de cada ruta** —cuál mira `canPlan` y cuál `canGrade`—;
   * que dirección resuelva así está probado aparte en `access.test.ts`.
   */
  function asDireccion() {
    // Libreta viva de otro docente: el director nunca es el titular.
    prismaMock.gradeBook.findUnique.mockResolvedValue({ ...ROW, teacherUserId: 'otro-docente' })
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue({ id: 'gbp-1', status: 'OPEN' })
    accessMock.mockResolvedValue({
      level: 'SUPERVISION',
      canRead: true,
      canGrade: false,
      canPlan: true,
    })
  }

  it('puede editar la planificación de una libreta ajena', async () => {
    asDireccion()
    prismaMock.gradeBookPlanning.upsert.mockResolvedValue({
      gradeBookId: GB_ID,
      formative: 'Ajuste de dirección',
      replanning: null,
      attachments: null,
    })

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/planning`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ formative: 'Ajuste de dirección' })

    expect(res.status).toBe(200)
    expect(prismaMock.gradeBookPlanning.upsert).toHaveBeenCalled()
  })

  it('puede registrar el desarrollo del curso', async () => {
    asDireccion()
    prismaMock.courseDevelopmentEntry.create.mockResolvedValue({
      id: 'dev-1',
      date: new Date('2026-05-12T12:00:00Z'),
      hoursTaught: 2,
      hoursNotTaught: 0,
      description: 'Revisión',
      attachments: null,
    })

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/development`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ date: '2026-05-12', hoursTaught: 2, hoursNotTaught: 0, description: 'Revisión' })

    expect(res.status).toBe(201)
  })

  it('NO puede cargar la calificación ni el juicio de un período', async () => {
    // Es la mitad que el liceo quiere protegida: la nota y el juicio son del docente.
    asDireccion()

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/grades`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries: [{ studentId: STUDENT_ID, valueHundredths: 800, conceptualJudgement: 'Muy bien' }] })

    expect(res.status).toBe(403)
    expect(prismaMock.periodGrade.upsert).not.toHaveBeenCalled()
  })

  it('NO puede crear evaluaciones', async () => {
    asDireccion()

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/assessments`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ periodId: PERIOD_ID, date: '2026-05-10', title: 'Escrito', gradingScaleId: SCALE_ID })

    expect(res.status).toBe(403)
    expect(prismaMock.assessment.create).not.toHaveBeenCalled()
  })

  it('el docente sigue pudiendo las dos cosas', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    accessMock.mockResolvedValue({ level: 'OWNER', canRead: true, canGrade: true, canPlan: true })
    prismaMock.gradeBookPlanning.upsert.mockResolvedValue({ gradeBookId: GB_ID })

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/planning`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ formative: 'Unidad 1' })

    expect(res.status).toBe(200)
  })
})

describe('hoja del estudiante dentro de la libreta', () => {
  const STUDENT_ID = '99999999-9999-4999-8999-999999999999'

  const STUDENT = {
    id: STUDENT_ID,
    firstName: 'Ana',
    lastName: 'Díaz',
    documentId: '51234561',
    birthDate: new Date('2010-03-12T12:00:00Z'),
    admittedFrom: 'Escuela 42',
    photo: { mimeType: 'image/jpeg', byteSize: 1000, updatedAt: new Date('2026-03-01T12:00:00Z') },
    accommodations: [
      {
        id: 'ad-1',
        kind: 'CURRICULAR',
        summary: 'Consignas por escrito.',
        externalUrl: 'https://drive.example/informe',
        validFrom: null,
        validUntil: null,
      },
      // Vencida: no le llega al docente.
      {
        id: 'ad-vieja',
        kind: 'EVALUATION',
        summary: 'Del año pasado.',
        externalUrl: null,
        validFrom: null,
        validUntil: new Date('2025-12-01T12:00:00Z'),
      },
    ],
    pendingSubjects: [
      {
        id: 'p-1',
        origin: 'FAILED_THIS_YEAR',
        apeDecember: 'FAILED',
        apeFebruary: null,
        resolvedAt: null,
        subject: { id: 'sub-9', name: 'Historia' },
        schoolYear: { id: 'sy-0', code: 2025 },
      },
    ],
    enrollments: [
      { schoolYearId: 'sy-1', academicResult: null, apeReferred: true, schoolYear: { code: 2026 } },
      { schoolYearId: 'sy-0', academicResult: 'PROMOTED_WITH_PENDING', apeReferred: false, schoolYear: { code: 2025 } },
    ],
  }

  function setup() {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    accessMock.mockResolvedValue({ level: 'OWNER', canRead: true, canGrade: true, canPlan: true })
    rosterMock.mockResolvedValue([
      { studentId: STUDENT_ID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'Díaz', documentId: null },
    ])
    prismaMock.student.findUnique.mockResolvedValue(STUDENT)
  }

  it('entrega los datos que administración cargó, con la foto', async () => {
    setup()

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/students/${STUDENT_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.student).toMatchObject({ firstName: 'Ana', documentId: '51234561' })
    expect(res.body.student.birthDate).toBe('2010-03-12T12:00:00.000Z')
    expect(res.body.student.photo.mimeType).toBe('image/jpeg')
    expect(res.body.apeReferred).toBe(true)
  })

  it('muestra cómo promovió el año anterior, no el resultado del corriente', async () => {
    setup()

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/students/${STUDENT_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.body.admission).toEqual({
      kind: 'PROMOTION',
      label: 'Promovido con materias pendientes en 2025',
    })
  })

  it('lista las materias que arrastra con su resultado de APE', async () => {
    setup()

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/students/${STUDENT_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.body.pendingSubjects).toEqual([
      {
        id: 'p-1',
        subjectName: 'Historia',
        schoolYearCode: 2025,
        origin: 'FAILED_THIS_YEAR',
        apeDecember: 'FAILED',
        apeFebruary: null,
      },
    ])
  })

  it('sólo entrega las adecuaciones vigentes', async () => {
    setup()

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/students/${STUDENT_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.body.accommodations).toHaveLength(1)
    expect(res.body.accommodations[0]).toMatchObject({
      id: 'ad-1',
      externalUrl: 'https://drive.example/informe',
    })
  })

  it('sirve la foto al docente, que no tiene permiso sobre la ruta de administración', async () => {
    setup()
    const bytes = Buffer.from([0xff, 0xd8, 0xff])
    prismaMock.studentPhoto.findUnique.mockResolvedValue({
      bytes,
      mimeType: 'image/jpeg',
      byteSize: bytes.length,
      updatedAt: new Date('2026-03-01T12:00:00Z'),
    })

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/students/${STUDENT_ID}/photo`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('image/jpeg')
    expect(res.headers['cache-control']).toContain('private')
  })

  it('la foto también respeta el roster', async () => {
    setup()
    rosterMock.mockResolvedValue([])

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/students/${STUDENT_ID}/photo`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(403)
    expect(prismaMock.studentPhoto.findUnique).not.toHaveBeenCalled()
  })

  it('nunca devuelve un estudiante fuera del grupo de esta libreta', async () => {
    // Con `gradebook.read` propio, un docente no puede consultar por id a cualquier alumno.
    setup()
    rosterMock.mockResolvedValue([])

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/students/${STUDENT_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('STUDENT_NOT_IN_ROSTER')
    expect(prismaMock.student.findUnique).not.toHaveBeenCalled()
  })
})
