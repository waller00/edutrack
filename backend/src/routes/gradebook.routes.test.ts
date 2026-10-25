import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { signAccessToken } from '../test-utils/bearer-token.js'

const { prismaMock, rosterMock, accessMock, scopeMock, saveGradesMock, previewMock, loadReportMock, dayOccurrenceMock, findSessionMock, saveRollCallMock } = vi.hoisted(() => ({
  prismaMock: {
    gradeBook: { findMany: vi.fn(), findUnique: vi.fn() },
    substitution: { findMany: vi.fn() },
    assessment: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
    gradeBookPeriod: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    periodGrade: { findMany: vi.fn(), upsert: vi.fn() },
    periodGradeRevision: { create: vi.fn(), findMany: vi.fn() },
    gradeRevision: { create: vi.fn(), findMany: vi.fn() },
    gradeBookPlanning: { findUnique: vi.fn(), upsert: vi.fn() },
    student: { findUnique: vi.fn(), findMany: vi.fn() },
    studentAccommodation: { updateMany: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    courseDevelopmentEntry: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), aggregate: vi.fn() },
    gradeBookMessage: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    gradeBookAccessLog: { create: vi.fn() },
    assessmentGrade: { findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), count: vi.fn() },
    studentAttendanceEntry: { groupBy: vi.fn(), findMany: vi.fn() },
    studentPhoto: { findMany: vi.fn(), findUnique: vi.fn() },
    inAppNotification: { createMany: vi.fn() },
    $transaction: vi.fn(),
    academicPeriod: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    gradingScale: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    activityType: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    teacherMeetingRecord: { findMany: vi.fn() },
    studentEnrollment: { findFirst: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(1),
  },
  saveGradesMock: vi.fn(),
  previewMock: vi.fn(),
  loadReportMock: vi.fn(),
  rosterMock: vi.fn(),
  accessMock: vi.fn(),
  scopeMock: vi.fn(),
  dayOccurrenceMock: vi.fn(),
  findSessionMock: vi.fn(),
  saveRollCallMock: vi.fn(),
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/school-year-service.js', () => ({
  resolveSchoolYearIdForList: vi.fn().mockResolvedValue('sy-1'),
}))
vi.mock('../services/student-attendance/roster.js', () => ({
  loadRosterForScope: rosterMock,
  canResolveRoster: (e: any) => Boolean(e.schoolYearId && e.courseOfferingId),
}))
vi.mock('../services/gradebook/access.js', async () => ({
  ...(await vi.importActual<object>('../services/gradebook/access.js')),
  resolveGradeBookAccess: accessMock,
}))
vi.mock('../services/gradebook/absences-day.js', async () => {
  const actual = await vi.importActual<any>('../services/gradebook/absences-day.js')
  return {
    ...actual,
    resolveGradeBookDayOccurrence: dayOccurrenceMock,
  }
})
vi.mock('../services/student-attendance/roll-call.js', async () => {
  const actual = await vi.importActual<any>('../services/student-attendance/roll-call.js')
  return {
    ...actual,
    findSession: findSessionMock,
    saveRollCall: saveRollCallMock,
  }
})
vi.mock('../config/system-settings.js', () => ({
  getGradeBookSettings: vi.fn().mockResolvedValue({ editWindowDays: 30 }),
  getStudentRollCallSettings: vi.fn().mockResolvedValue({ editWindowHours: 48 }),
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
  // Las transacciones interactivas corren el callback sobre el mismo mock.
  prismaMock.$transaction.mockImplementation(async (arg: any) => (typeof arg === 'function' ? arg(prismaMock) : arg))
  prismaMock.studentAttendanceEntry.groupBy.mockResolvedValue([])
  prismaMock.studentAttendanceEntry.findMany.mockResolvedValue([])
  prismaMock.studentPhoto.findMany.mockResolvedValue([])
  prismaMock.studentPhoto.findUnique.mockResolvedValue(null)
  prismaMock.student.findMany.mockResolvedValue([])
  prismaMock.studentAccommodation.updateMany.mockResolvedValue({ count: 0 })
  prismaMock.gradeBookPeriod.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.teacherMeetingRecord.findMany.mockResolvedValue([])
  prismaMock.studentEnrollment.findFirst.mockResolvedValue(null)
  prismaMock.inAppNotification.createMany.mockResolvedValue({ count: 0 })
  dayOccurrenceMock.mockResolvedValue({ kind: 'no_class' })
  findSessionMock.mockResolvedValue(null)
  saveRollCallMock.mockResolvedValue({ id: 'sess-1' })
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
        // Cubre hoy: la suplencia está abierta.
        date: new Date(Date.now() - 3_600_000),
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
    expect(res.body.access).toEqual({ level: 'OWNER', canGrade: true, substituteUntil: null })
    expect(res.body.students[0].hasPhoto).toBe(false)
    expect(res.body.students[0].badges).toEqual([])
  })

  it('arma chips ADEC/Gen en el roster cuando hay dato', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([
      { studentId: 's1', studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    prismaMock.student.findMany.mockResolvedValue([
      {
        id: 's1',
        liceoAccessNotes: 'Nota Gen',
        accommodations: [{ validFrom: null, validUntil: null }],
      },
    ])

    const res = await request(app()).get(`/gradebook/${GB_ID}`).set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.students[0].badges).toEqual(['ADEC', 'GEN'])
  })

  it('el detalle de faltas por materia suma lo mismo que el acumulado (las tardes también)', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([
      { studentId: 's1', studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    const session = (subjectId: string, name: string) => ({
      occurrenceYmd: '2026-05-04',
      startAt: new Date('2026-05-04T11:00:00.000Z'),
      endAt: new Date('2026-05-04T12:00:00.000Z'),
      subjectId,
      subject: { name },
      event: { title: name },
    })
    prismaMock.studentAttendanceEntry.findMany.mockResolvedValue([
      { id: 'm1', status: 'LATE', note: null, absenceWeightHundredths: null, session: session('mat', 'Matemática') },
      { id: 'm2', status: 'LATE', note: null, absenceWeightHundredths: null, session: session('mat', 'Matemática') },
      { id: 'h1', status: 'ABSENT', note: null, absenceWeightHundredths: null, session: session('his', 'Historia') },
    ])

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/students/s1/absences`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.overall.absenceHundredths).toBe(200)
    const bySubject = Object.fromEntries(
      res.body.bySubject.map((s: { subjectId: string; absenceHundredths: number }) => [s.subjectId, s.absenceHundredths]),
    )
    expect(bySubject).toEqual({ mat: 100, his: 100 })
  })

  it('cuenta las faltas en unidades, con la media falta', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([
      { studentId: 's1', studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
      { studentId: 's2', studentEnrollmentId: 'e2', firstName: 'Beto', lastName: 'C', documentId: null },
    ])
    const day = { session: { occurrenceYmd: '2026-05-04' } }
    prismaMock.studentAttendanceEntry.findMany.mockResolvedValue([
      { studentId: 's1', status: 'ABSENT', absenceWeightHundredths: null, ...day },
      { studentId: 's1', status: 'ABSENT', absenceWeightHundredths: 50, ...day },
      { studentId: 's1', status: 'ABSENT_JUSTIFIED', absenceWeightHundredths: null, ...day },
      { studentId: 's1', status: 'LATE', absenceWeightHundredths: null, ...day },
      { studentId: 's2', status: 'PRESENT', absenceWeightHundredths: null, ...day },
    ])

    const res = await request(app()).get(`/gradebook/${GB_ID}`).set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    // 1 + 0,5 + 1 (la justificada cuenta) + 0,5 (la tarde es media falta) = 3
    expect(res.body.students[0]).toMatchObject({
      studentId: 's1',
      absences: '3',
      absenceHundredths: 300,
      justifiedCount: 1,
      lates: 1,
    })
    expect(res.body.students[1]).toMatchObject({ studentId: 's2', absences: '0', absenceHundredths: 0 })
  })

  it('en ciclo básico la falta es del día: tarde y justificada valen media', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue({
      ...ROW,
      courseOffering: { ...ROW.courseOffering, course: { id: 'c-7', name: '7 EBI', code: '7EBI', level: 'EBI' } },
    })
    rosterMock.mockResolvedValue([
      { studentId: 's1', studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    const on = (ymd: string, status: string) => ({
      studentId: 's1',
      status,
      absenceWeightHundredths: null,
      session: { occurrenceYmd: ymd },
    })
    prismaMock.studentAttendanceEntry.findMany.mockResolvedValue([
      // Lunes: falta a una sola materia → 1
      on('2026-05-04', 'PRESENT'),
      on('2026-05-04', 'ABSENT'),
      // Martes: dos tardes → ½
      on('2026-05-05', 'LATE'),
      on('2026-05-05', 'LATE'),
      // Miércoles: tarde + ausencia → 1, no 1½
      on('2026-05-06', 'LATE'),
      on('2026-05-06', 'ABSENT'),
      // Jueves: justificada → ½
      on('2026-05-07', 'ABSENT_JUSTIFIED'),
    ])

    const res = await request(app()).get(`/gradebook/${GB_ID}`).set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.students[0]).toMatchObject({ absenceHundredths: 300, absences: '3', lates: 3, justifiedCount: 1 })
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
    expect(res.body.access).toEqual({ level: 'SUPERVISION', canGrade: false, substituteUntil: null })
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

  it('es del grupo salvo que la carta diga que es una nota suelta', async () => {
    await request(app()).post(`/gradebook/${GB_ID}/assessments`).set('Authorization', `Bearer ${tok()}`).send(body)
    await request(app())
      .post(`/gradebook/${GB_ID}/assessments`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ ...body, scope: 'INDIVIDUAL' })

    expect(prismaMock.assessment.create.mock.calls[0][0].data.scope).toBe('GROUP')
    expect(prismaMock.assessment.create.mock.calls[1][0].data.scope).toBe('INDIVIDUAL')
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

  it('administración carga notas en la libreta del docente: tiene gradebook.grade', async () => {
    scopeMock.mockResolvedValue('all')

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/assessments/${ASSESSMENT_ID}/grades`)
      .set('Authorization', `Bearer ${tok('ADMIN', 'a-1')}`)
      .send({ entries, reason: 'reclamo del estudiante' })

    expect(res.status).toBe(200)
    expect(saveGradesMock).toHaveBeenCalled()
  })

  it('dirección y adscripción no cargan notas: no tienen gradebook.grade', async () => {
    scopeMock.mockResolvedValue('all')

    for (const role of ['DIRECCION', 'ADSCRIPTO']) {
      const res = await request(app())
        .put(`/gradebook/${GB_ID}/assessments/${ASSESSMENT_ID}/grades`)
        .set('Authorization', `Bearer ${tok(role, `${role}-1`)}`)
        .send({ entries, reason: 'reclamo del estudiante' })
      expect(res.status, role).toBe(403)
    }
    expect(saveGradesMock).not.toHaveBeenCalled()
  })

  it('un perfil a medida con grade y manage corrige fuera de plazo, con origen ADMIN_CORRECTION', async () => {
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'))
    scopeMock.mockResolvedValue('all')
    const custom = signAccessToken({
      sub: 'a-1',
      email: 'a-1@example.com',
      role: 'ADMIN',
      permissions: { 'gradebook.grade': 'all' },
    })

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/assessments/${ASSESSMENT_ID}/grades`)
      .set('Authorization', `Bearer ${custom}`)
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

  it('manda la escala del nivel y las opciones de conducta', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    prismaMock.academicPeriod.findMany.mockResolvedValue([])
    prismaMock.gradingScale.findMany.mockResolvedValue([])
    prismaMock.activityType.findMany.mockResolvedValue([])
    prismaMock.gradingScale.findUnique.mockResolvedValue({ id: 'sc-12', code: 'NUMERICA_1_12', maxValueHundredths: 1200, levels: [] })
    prismaMock.gradingScale.findFirst.mockResolvedValue({
      code: 'CONDUCTA',
      levels: [
        { minValueHundredths: 100, maxValueHundredths: 100, label: 'Mala' },
        { minValueHundredths: 400, maxValueHundredths: 400, label: 'Muy buena' },
      ],
    })

    const res = await request(app()).get(`/gradebook/${GB_ID}/options`).set('Authorization', `Bearer ${tok()}`)

    // ROW es de bachillerato: con esta escala el docente puede poner 11 y 12.
    expect(prismaMock.gradingScale.findUnique.mock.calls[0][0].where).toEqual({ code: 'NUMERICA_1_12' })
    expect(res.body.periodScale).toMatchObject({ id: 'sc-12', maxValueHundredths: 1200 })
    expect(res.body.conduct).toEqual(Array.from({ length: 10 }, (_, i) => ({ valueHundredths: (i + 1) * 100, label: String(i + 1) })))
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
  // El cierre escribe en una transacción interactiva: el callback corre sobre el mismo mock.
  prismaMock.$transaction.mockImplementation(async (arg: any) => (typeof arg === 'function' ? arg(prismaMock) : arg))
  vi.setSystemTime(new Date('2026-05-20T12:00:00.000Z'))
}

// R (rendimiento) y C (conducta) cargados, con juicio.
const COMPLETE = [{ studentId: STUDENT_A, meetingValueHundredths: 800, conductValueHundredths: 800, conceptualJudgement: 'Progresa bien.' }]

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
    expect(prismaMock.gradeBookPeriod.updateMany.mock.calls[0][0].data.status).toBe('CLOSED')
    expect(prismaMock.gradeBookPeriod.updateMany.mock.calls[0][0].where).toEqual({ id: 'gbp-1', status: { not: 'CLOSED' } })
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

  it('si otra persona lo cerró en el medio, no cierra dos veces ni duplica la auditoría', async () => {
    readyForClosure({ saved: COMPLETE })
    prismaMock.gradeBookPeriod.updateMany.mockResolvedValueOnce({ count: 0 })

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/close`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ALREADY_CLOSED')
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled()
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
    readyForClosure({ saved: [{ studentId: STUDENT_A, meetingValueHundredths: 800, conceptualJudgement: null }] })
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
      .send({ entries: [{ studentId: STUDENT_A, meetingValueHundredths: 800, conceptualJudgement: 'Progresa bien.' }] })

    const create = prismaMock.periodGrade.upsert.mock.calls[0][0].create
    expect(create).toMatchObject({ studentLastName: 'Benítez', studentFirstName: 'Ana' })
  })

  it('rechaza escribir en un período cerrado', async () => {
    readyForClosure({ state: { id: 'gbp-1', status: 'CLOSED', closedAt: new Date(), closedLate: false, reopenedAt: null, reopenReason: null } })
    const res = await request(app())
      .put(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/grades`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries: [{ studentId: STUDENT_A, meetingValueHundredths: 800, conceptualJudgement: 'Progresa bien.' }] })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('PERIOD_CLOSED')
  })

  it('un período REOPENED vuelve a admitir escritura', async () => {
    readyForClosure({ state: { id: 'gbp-1', status: 'REOPENED', closedAt: new Date(), closedLate: false, reopenedAt: new Date(), reopenReason: 'error' } })
    const res = await request(app())
      .put(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/grades`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries: [{ studentId: STUDENT_A, meetingValueHundredths: 800, conceptualJudgement: 'Progresa bien.' }] })
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

  it('la conducta es una nota del 1 al 10 aunque el catálogo sea ordinal', async () => {
    readyForClosure()
    prismaMock.gradingScale.findFirst.mockResolvedValue({
      code: 'CONDUCTA',
      levels: [{ minValueHundredths: 300, maxValueHundredths: 300, label: 'Buena' }],
    })
    const put = (conductValueHundredths: number) =>
      request(app())
        .put(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/grades`)
        .set('Authorization', `Bearer ${tok()}`)
        .send({ entries: [{ studentId: STUDENT_A, conductValueHundredths }] })

    const wrong = await put(250)
    expect(wrong.status).toBe(400)
    expect(wrong.body.code).toBe('CONDUCT_OUT_OF_SCALE')

    expect((await put(300)).status).toBe(200)
    expect(prismaMock.periodGrade.upsert.mock.calls[0][0].update).toMatchObject({ conductValueHundredths: 300 })
    expect((await put(1000)).status).toBe(200)
    expect((await put(1100)).status).toBe(400)
  })

  it('no escribe en un período que todavía no empezó, igual que el cierre por alumno', async () => {
    readyForClosure()
    prismaMock.academicPeriod.findFirst.mockResolvedValue({ ...PERIOD, startsOn: new Date('2026-09-01T12:00:00.000Z') })
    const res = await request(app())
      .put(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/grades`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries: COMPLETE })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('PERIOD_NOT_ENABLED')
  })

  it('sólo busca períodos del nivel de la libreta', async () => {
    readyForClosure()
    await request(app()).get(`/gradebook/${GB_ID}/periods/${PERIOD_ID}`).set('Authorization', `Bearer ${tok()}`)
    expect(prismaMock.academicPeriod.findFirst.mock.calls[0][0].where).toMatchObject({ level: 'EMS' })
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
  prismaMock.academicPeriod.findUnique.mockResolvedValue({ schoolYearId: 'sy-1', level: 'EMS', isActive: true, kind: 'TRAMO' })
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

  it('acepta una escala que empieza en 0: tiene rango', async () => {
    readyForImport()
    prismaMock.gradingScale.findUnique.mockResolvedValue({ ...SCALE_ROW, minValueHundredths: 0 })

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/moodle/import`)
      .set('Authorization', `Bearer ${tok()}`)
      .send(importBody)

    expect(res.status).toBe(200)
    // 100/100 sobre 0-12 sigue siendo 12.
    expect(saveGradesMock.mock.calls[0][0].entries).toEqual([{ studentId: STUDENT_A, valueHundredths: 1200 }])
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

  it('la sección del docente trae los hilos que abrió la supervisión (también Administración)', async () => {
    prismaMock.gradeBookMessage.findMany.mockResolvedValue([
      { id: 'd1', parentId: null, authorRoleCode: 'DIRECCION', body: 'Te falta el informe' },
      { id: 'ad1', parentId: null, authorRoleCode: 'ADMIN', body: 'Te faltó cargar la planificación' },
      { id: 'a1', parentId: null, authorRoleCode: 'ADSCRIPTO', body: 'Otra cosa' },
      { id: 't1', parentId: null, authorRoleCode: 'TEACHER', body: 'Nota para mí' },
      { id: 'r1', parentId: 'd1', authorRoleCode: 'TEACHER', body: 'Ya lo cargo' },
    ])

    for (const from of ['SUPERVISION', 'DIRECCION']) {
      const res = await request(app()).get(`/gradebook/${GB_ID}/messages?from=${from}`).set('Authorization', `Bearer ${tok()}`)
      expect(res.body.data.map((m: { id: string }) => m.id), from).toEqual(['d1', 'ad1', 'a1', 'r1'])
    }
  })

  it('la respuesta del docente le avisa al director que abrió el hilo', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    prismaMock.gradeBookMessage.findFirst.mockResolvedValue({ id: 'd1', authorUserId: 'd-1' })

    await request(app())
      .post(`/gradebook/${GB_ID}/messages`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ body: 'Ya lo cargué.', parentId: '99999999-9999-4999-8999-999999999999' })

    const rows = prismaMock.inAppNotification.createMany.mock.calls.flatMap(([arg]) => arg.data)
    expect(rows).toEqual([
      expect.objectContaining({ userId: 'd-1', type: 'GRADEBOOK_MESSAGE', actionUrl: `/libreta/${GB_ID}/visado` }),
    ])
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
    prismaMock.gradingScale.findUnique.mockResolvedValue({ decimals: 0, levels: [] })
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

  it('describe R con la escala del nivel, no con la de alguna evaluación', async () => {
    for (const path of ['xlsx', 'pdf']) {
      prismaMock.gradingScale.findUnique.mockClear()
      const res = await request(app())
        .get(`/gradebook/${GB_ID}/exports/${path}`)
        .set('Authorization', `Bearer ${tok()}`)

      expect(res.status).toBe(200)
      // ROW es de bachillerato: 1–12, aunque haya una escala activa de 1–10 antes.
      expect(prismaMock.gradingScale.findUnique.mock.calls[0][0].where).toEqual({ code: 'NUMERICA_1_12' })
    }
    // La única escala que se busca "la primera que haya" es la de conducta, para la columna C.
    for (const [args] of prismaMock.gradingScale.findFirst.mock.calls) {
      expect(args.where).toEqual({ code: 'CONDUCTA' })
    }
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
    prismaMock.gradingScale.findUnique.mockResolvedValue({ decimals: 0, levels: [] })
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([])
    rosterMock.mockResolvedValue([])

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/exports/pdf`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(200)
  })
})

describe('supervisión: Dirección y Adscripción ven la libreta pero no la editan', () => {
  const STUDENT_ID = '99999999-9999-4999-8999-999999999999'
  const DIR = () => tok('DIRECCION', 'd-1')

  /**
   * Acceso de dirección sobre una libreta ajena: lee, no planifica ni califica. El director avisa
   * al docente (mensajes, observaciones de visado); no corrige por él.
   */
  function asDireccion() {
    // Libreta viva de otro docente: el director nunca es el titular.
    prismaMock.gradeBook.findUnique.mockResolvedValue({ ...ROW, teacherUserId: 'otro-docente' })
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue({ id: 'gbp-1', status: 'OPEN' })
    accessMock.mockResolvedValue({
      level: 'SUPERVISION',
      canRead: true,
      canGrade: false,
      canPlan: false,
    })
  }

  it('NO puede editar la planificación de una libreta ajena', async () => {
    asDireccion()

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/planning`)
      .set('Authorization', `Bearer ${DIR()}`)
      .send({ formative: 'Ajuste de dirección' })

    expect(res.status).toBe(403)
    expect(prismaMock.gradeBookPlanning.upsert).not.toHaveBeenCalled()
  })

  it('NO puede registrar ni borrar el desarrollo del curso', async () => {
    asDireccion()

    const created = await request(app())
      .post(`/gradebook/${GB_ID}/development`)
      .set('Authorization', `Bearer ${DIR()}`)
      .send({ date: '2026-05-12', hoursTaught: 2, hoursNotTaught: 0, description: 'Revisión' })
    const removed = await request(app()).delete(`/gradebook/${GB_ID}/development/dev-1`).set('Authorization', `Bearer ${DIR()}`)

    expect(created.status).toBe(403)
    expect(removed.status).toBe(403)
    expect(prismaMock.courseDevelopmentEntry.create).not.toHaveBeenCalled()
  })

  it('NO puede cargar la calificación ni el juicio de un período', async () => {
    asDireccion()

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/grades`)
      .set('Authorization', `Bearer ${DIR()}`)
      .send({ entries: [{ studentId: STUDENT_ID, valueHundredths: 800, conceptualJudgement: 'Muy bien' }] })

    expect(res.status).toBe(403)
    expect(prismaMock.periodGrade.upsert).not.toHaveBeenCalled()
  })

  it('NO puede tocar la carta del alumno (C, R, juicio)', async () => {
    asDireccion()

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/students/${STUDENT_ID}/closure`)
      .set('Authorization', `Bearer ${DIR()}`)
      .send({ entries: [{ periodId: PERIOD_ID, meetingValueHundredths: 800 }] })

    expect(res.status).toBe(403)
    expect(prismaMock.periodGrade.upsert).not.toHaveBeenCalled()
  })

  it('NO puede crear evaluaciones', async () => {
    asDireccion()

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/assessments`)
      .set('Authorization', `Bearer ${DIR()}`)
      .send({ periodId: PERIOD_ID, date: '2026-05-10', title: 'Escrito', gradingScaleId: SCALE_ID })

    expect(res.status).toBe(403)
    expect(prismaMock.assessment.create).not.toHaveBeenCalled()
  })

  it('la pantalla le muestra la planificación y el desarrollo de sólo lectura', async () => {
    asDireccion()
    prismaMock.gradeBookPlanning.findUnique.mockResolvedValue({
      gradeBookId: GB_ID,
      formative: 'Unidad 1',
      replanning: null,
      attachments: null,
      updatedAt: new Date('2026-05-02T15:00:00.000Z'),
      updatedBy: { name: 'Ana G' },
    })
    prismaMock.courseDevelopmentEntry.findMany.mockResolvedValue([])
    prismaMock.courseDevelopmentEntry.aggregate.mockResolvedValue({ _sum: { hoursTaught: 0, hoursNotTaught: 0 } })

    const planning = await request(app()).get(`/gradebook/${GB_ID}/planning`).set('Authorization', `Bearer ${DIR()}`)
    const development = await request(app()).get(`/gradebook/${GB_ID}/development`).set('Authorization', `Bearer ${DIR()}`)

    expect(planning.status).toBe(200)
    expect(planning.body.canEdit).toBe(false)
    expect(planning.body.data).toMatchObject({ updatedByName: 'Ana G', updatedAt: '2026-05-02T15:00:00.000Z' })
    expect(development.body.canEdit).toBe(false)
  })

  it('adscripción tampoco edita la planificación ni crea evaluaciones', async () => {
    asDireccion()
    const ADS = tok('ADSCRIPTO', 'a-1')

    const planning = await request(app())
      .put(`/gradebook/${GB_ID}/planning`)
      .set('Authorization', `Bearer ${ADS}`)
      .send({ formative: 'Ajuste' })
    const assessment = await request(app())
      .post(`/gradebook/${GB_ID}/assessments`)
      .set('Authorization', `Bearer ${ADS}`)
      .send({ periodId: PERIOD_ID, date: '2026-05-10', title: 'Escrito', gradingScaleId: SCALE_ID })

    expect(planning.status).toBe(403)
    expect(assessment.status).toBe(403)
    expect(prismaMock.gradeBookPlanning.upsert).not.toHaveBeenCalled()
    expect(prismaMock.assessment.create).not.toHaveBeenCalled()
  })

  it('administración sí edita la planificación del docente, y queda auditado', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue({ ...ROW, teacherUserId: 'otro-docente' })
    accessMock.mockResolvedValue({ level: 'SUPERVISION', canRead: true, canGrade: true, canPlan: true })
    prismaMock.gradeBookPlanning.upsert.mockResolvedValue({ gradeBookId: GB_ID })

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/planning`)
      .set('Authorization', `Bearer ${tok('ADMIN', 'admin-1')}`)
      .send({ formative: 'Ajuste' })

    expect(res.status).toBe(200)
    expect(prismaMock.gradeBookPlanning.upsert).toHaveBeenCalled()
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
    // El titular escribiendo su planificación no es una corrección: no se audita.
    expect(prismaMock.auditLog.create.mock.calls.some(([arg]) => arg.data.action === 'GRADEBOOK_PLANNING_UPDATED')).toBe(false)
  })
})

describe('desarrollo del curso', () => {
  const ENTRY = {
    id: 'dev-1',
    gradeBookId: GB_ID,
    date: new Date('2026-05-12T12:00:00Z'),
    hoursTaught: 2,
    hoursNotTaught: 0,
    description: 'Revisión',
    attachments: null,
  }

  beforeEach(() => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    accessMock.mockResolvedValue({ level: 'OWNER', canRead: true, canGrade: true, canPlan: true })
  })

  it('un registro se corrige sin borrarlo, y queda auditado', async () => {
    ;(prismaMock.courseDevelopmentEntry as any).findFirst = vi.fn().mockResolvedValue(ENTRY)
    ;(prismaMock.courseDevelopmentEntry as any).update = vi.fn().mockResolvedValue({ ...ENTRY, hoursTaught: 3 })

    const res = await request(app())
      .patch(`/gradebook/${GB_ID}/development/dev-1`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ hoursTaught: 3 })

    expect(res.status).toBe(200)
    expect((prismaMock.courseDevelopmentEntry as any).update.mock.calls[0][0]).toEqual({
      where: { id: 'dev-1' },
      data: { hoursTaught: 3 },
    })
    await vi.waitFor(() =>
      expect(prismaMock.auditLog.create.mock.calls.some(([arg]) => arg.data.action === 'GRADEBOOK_DEVELOPMENT_UPDATED')).toBe(true),
    )
  })

  it('borrar queda auditado con lo que se borró', async () => {
    ;(prismaMock.courseDevelopmentEntry as any).findFirst = vi.fn().mockResolvedValue(ENTRY)
    ;(prismaMock.courseDevelopmentEntry as any).delete = vi.fn().mockResolvedValue(ENTRY)

    const res = await request(app()).delete(`/gradebook/${GB_ID}/development/dev-1`).set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    // Auditoría garantizada (se espera el INSERT): los valores del SQL llevan la acción y lo borrado.
    const values = prismaMock.$executeRaw.mock.calls.flatMap(([, ...rest]) => rest)
    expect(values).toContain('GRADEBOOK_DEVELOPMENT_DELETED')
    expect(values.some((v) => typeof v === 'string' && v.includes('"description":"Revisión"'))).toBe(true)
  })

  it('con el ciclo cerrado dice eso, no "no sos docente"', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue({ ...ROW, status: 'ARCHIVED' })
    accessMock.mockResolvedValue({ level: 'OWNER', canRead: true, canGrade: false, canPlan: false })

    const res = await request(app()).delete(`/gradebook/${GB_ID}/development/dev-1`).set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('SCHOOL_YEAR_CLOSED')
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
    liceoAccessNotes: 'Observación de prueba para Gen.',
    liceoAccessNotesUpdatedAt: new Date('2026-03-13T12:24:07Z'),
    liceoAccessNotesUpdatedBy: { name: 'Admin Principal', firstName: 'Admin', lastName: 'Principal', username: 'admin' },
    photo: { mimeType: 'image/jpeg', byteSize: 1000, updatedAt: new Date('2026-03-01T12:00:00Z') },
    accommodations: [
      {
        id: 'ad-1',
        kind: 'CURRICULAR',
        summary: 'Consignas por escrito.',
        externalUrl: 'https://drive.example/informe',
        validFrom: null,
        validUntil: null,
        createdAt: new Date('2026-03-01T12:00:00Z'),
        updatedAt: new Date('2026-03-01T12:00:00Z'),
        teacherSeenAt: null,
        createdBy: { name: 'Admin Principal', firstName: 'Admin', lastName: 'Principal', username: 'admin' },
        updatedBy: null,
        teacherSeenBy: null,
      },
      // Vencida: no le llega al docente.
      {
        id: 'ad-vieja',
        kind: 'EVALUATION',
        summary: 'Del año pasado.',
        externalUrl: null,
        validFrom: null,
        validUntil: new Date('2025-12-01T12:00:00Z'),
        createdAt: new Date('2025-01-01T12:00:00Z'),
        updatedAt: new Date('2025-01-01T12:00:00Z'),
        teacherSeenAt: null,
        createdBy: null,
        updatedBy: null,
        teacherSeenBy: null,
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
    // Copia: la ruta marca `teacherSeenAt` sobre las filas que recibe.
    prismaMock.student.findUnique.mockResolvedValue(structuredClone(STUDENT))
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

  it('el docente que abre la hoja deja la adecuación vigente como vista', async () => {
    setup()

    await request(app())
      .get(`/gradebook/${GB_ID}/students/${STUDENT_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(prismaMock.studentAccommodation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['ad-1'] } } }),
    )
  })

  it('si la abre la supervisión no cuenta como "visto por docente"', async () => {
    setup()
    accessMock.mockResolvedValue({ level: 'SUPERVISION', canRead: true, canGrade: false, canPlan: false })

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/students/${STUDENT_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(prismaMock.studentAccommodation.updateMany).not.toHaveBeenCalled()
    expect(res.body.accommodations[0].teacherSeenAt).toBeNull()
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

  it('incluye observaciones generales y distintivos ADEC/Gen', async () => {
    setup()

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/students/${STUDENT_ID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.body.generalNotes).toBe('Observación de prueba para Gen.')
    expect(res.body.badges).toEqual(['ADEC', 'GEN'])
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

describe('inasistencias diarias de la libreta', () => {
  const SID = '22222222-2222-4222-8222-222222222222'

  beforeEach(() => {
    // Dentro de la ventana de 48 h de una clase del 14/9.
    vi.setSystemTime(new Date('2026-09-14T18:00:00.000Z'))
  })

  it('GET /absences/day sin clase marca hasClass false y canMark si hay ancla', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([
      { studentId: SID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    dayOccurrenceMock.mockResolvedValue({
      kind: 'no_class',
      anchorEvent: { id: 'ev-anchor' },
    })
    findSessionMock.mockResolvedValue(null)

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/absences/day?date=2026-09-14`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.hasClass).toBe(false)
    expect(res.body.canMark).toBe(true)
    expect(res.body.noClassReason).toBe('Sin horario')
    expect(res.body.eventId).toBe('ev-anchor')
    expect(res.body.students[0]).toMatchObject({ studentId: SID, dayMark: null })
  })

  function classOn14() {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([
      { studentId: SID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    dayOccurrenceMock.mockResolvedValue({
      kind: 'class',
      event: { id: 'ev-1' },
      startAt: new Date('2026-09-14T12:00:00Z'),
      endAt: new Date('2026-09-14T13:00:00Z'),
      occurrenceCount: 1,
    })
    findSessionMock.mockResolvedValue(null)
  }

  it('PUT /absences/day: el docente no gradúa la falta, aunque mande un peso', async () => {
    classOn14()

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/absences/day`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({
        date: '2026-09-14',
        entries: [{ studentId: SID, status: 'ABSENT', absenceWeightHundredths: 50 }],
      })

    expect(res.status).toBe(200)
    const [entry] = saveRollCallMock.mock.calls[0][0].entries
    expect(entry).toMatchObject({ studentId: SID, status: 'ABSENT' })
    // Graduarla es de adscripción al justificar: la libreta no la pisa.
    expect(entry.absenceWeightHundredths).toBeUndefined()
    expect(saveRollCallMock.mock.calls[0][0]).toMatchObject({ outsideWindow: false })
  })

  it('PUT /absences/day respeta la ventana de 48 h del pase de lista', async () => {
    classOn14()
    vi.setSystemTime(new Date('2026-09-20T12:00:00.000Z'))

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/absences/day`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ date: '2026-09-14', entries: [{ studentId: SID, status: 'ABSENT' }] })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('WINDOW_EXPIRED')
    expect(saveRollCallMock).not.toHaveBeenCalled()
  })

  it('PUT /absences/day: una planilla cerrada por administración no se edita', async () => {
    classOn14()
    findSessionMock.mockResolvedValue({ takenAt: null, lockedAt: new Date('2026-09-14T14:00:00.000Z'), entries: [] })

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/absences/day`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ date: '2026-09-14', entries: [{ studentId: SID, status: 'LATE' }] })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('LOCKED')
  })

  it('administración edita fuera de plazo, y queda marcado para la auditoría', async () => {
    classOn14()
    vi.setSystemTime(new Date('2026-09-20T12:00:00.000Z'))
    scopeMock.mockResolvedValue('all')

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/absences/day`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ date: '2026-09-14', entries: [{ studentId: SID, status: 'LATE' }] })

    expect(res.status).toBe(200)
    expect(saveRollCallMock.mock.calls[0][0]).toMatchObject({ outsideWindow: true, actedAsAdmin: true })
  })

  it('GET /absences/day dice que no se puede marcar y por qué', async () => {
    classOn14()
    vi.setSystemTime(new Date('2026-09-20T12:00:00.000Z'))

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/absences/day?date=2026-09-14`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.body).toMatchObject({ hasClass: true, canMark: false, markBlockedReason: 'WINDOW_EXPIRED' })
  })

  it('PUT /absences/day: la lista de una clase que no empezó todavía no abre', async () => {
    classOn14()
    vi.setSystemTime(new Date('2026-09-14T11:00:00.000Z')) // 08:00; la clase es a las 09:00

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/absences/day`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ date: '2026-09-14', entries: [{ studentId: SID, status: 'ABSENT' }] })

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({
      code: 'NOT_STARTED',
      message: 'La lista se abre a las 08:50, 10 minutos antes de la clase.',
    })
    expect(saveRollCallMock).not.toHaveBeenCalled()
  })

  it('GET /absences/day dice desde cuándo abre la lista', async () => {
    classOn14()
    vi.setSystemTime(new Date('2026-09-14T11:00:00.000Z'))

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/absences/day?date=2026-09-14`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.body).toMatchObject({
      canMark: false,
      markBlockedReason: 'NOT_STARTED',
      opensAt: '2026-09-14T11:50:00.000Z',
    })
  })

  it('PUT /absences/day sin peso no pisa el que haya fijado adscripción', async () => {
    // El docente ya no elige "media falta": una ausencia sin peso viaja como undefined.
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([
      { studentId: SID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    dayOccurrenceMock.mockResolvedValue({
      kind: 'class',
      event: { id: 'ev-1' },
      startAt: new Date('2026-09-14T12:00:00Z'),
      endAt: new Date('2026-09-14T13:00:00Z'),
      occurrenceCount: 1,
    })

    await request(app())
      .put(`/gradebook/${GB_ID}/absences/day`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ date: '2026-09-14', entries: [{ studentId: SID, status: 'ABSENT' }] })

    const [entry] = saveRollCallMock.mock.calls[0][0].entries
    expect(entry).toMatchObject({ studentId: SID, status: 'ABSENT' })
    expect(entry.absenceWeightHundredths).toBeUndefined()
  })

  it('PUT /absences/day en S/H usa el evento ancla', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([
      { studentId: SID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    dayOccurrenceMock.mockResolvedValue({
      kind: 'no_class',
      anchorEvent: { id: 'ev-anchor' },
    })

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/absences/day`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({
        date: '2026-09-14',
        entries: [{ studentId: SID, status: 'ABSENT', absenceWeightHundredths: 100 }],
      })

    expect(res.status).toBe(200)
    expect(saveRollCallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ id: 'ev-anchor' }),
        occurrenceYmd: '2026-09-14',
      }),
    )
  })

  it('GET historial del alumno exige roster', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([])

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/students/${SID}/absences`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('STUDENT_NOT_IN_ROSTER')
  })
})

describe('cierre por alumno', () => {
  const SID = '22222222-2222-4222-8222-222222222222'
  const PERIOD_ID = '33333333-3333-4333-8333-333333333333'

  it('GET /students/:id/closure lista períodos con nota y juicio', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([
      { studentId: SID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    prismaMock.academicPeriod.findMany.mockResolvedValue([
      {
        id: PERIOD_ID,
        code: 'MAY',
        name: 'Mayo',
        startsOn: new Date('2026-03-01T12:00:00.000Z'),
        endsOn: null,
        closesOn: null,
        requiresGeneralGrade: true,
        requiresConceptualJudgement: true,
      },
    ])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      {
        periodId: PERIOD_ID,
        status: 'OPEN',
        closedAt: null,
        closedLate: false,
        grades: [{ valueHundredths: 700, conceptualJudgement: 'Bien' }],
      },
    ])
    prismaMock.assessment.findMany.mockResolvedValue([])

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/students/${SID}/closure`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.student.studentId).toBe(SID)
    expect(res.body.periods).toHaveLength(1)
    expect(res.body.periods[0]).toMatchObject({
      periodId: PERIOD_ID,
      valueHundredths: 700,
      conceptualJudgement: 'Bien',
      canEdit: true,
      meetingJudgement: null,
    })
    expect(res.body.periods[0]).toHaveProperty('closedAt')
  })

  it('GET /students/:id/closure: el juicio de grupo es el de la orientación del alumno', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([
      { studentId: SID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    prismaMock.academicPeriod.findMany.mockResolvedValue([])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([])
    prismaMock.assessment.findMany.mockResolvedValue([])
    prismaMock.studentEnrollment.findFirst.mockResolvedValue({ courseOrientationId: 'co-cientifico' })

    await request(app())
      .get(`/gradebook/${GB_ID}/students/${SID}/closure`)
      .set('Authorization', `Bearer ${tok()}`)

    // Una libreta de tronco común la cursan varias orientaciones: "todo el grupo" es el del alumno.
    expect(prismaMock.teacherMeetingRecord.findMany.mock.calls[0][0].where).toEqual({
      courseOfferingId: 'off-1',
      OR: [{ studentId: SID }, { studentId: null, courseOrientationId: 'co-cientifico' }],
    })
  })

  it('GET /students/:id/closure marca canEdit=false si el período no empezó', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([
      { studentId: SID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: null },
    ])
    prismaMock.academicPeriod.findMany.mockResolvedValue([
      {
        id: PERIOD_ID,
        code: 'APE_FEB',
        name: 'APE Febrero',
        startsOn: new Date('2099-02-01T12:00:00.000Z'),
        endsOn: null,
        closesOn: null,
        requiresGeneralGrade: true,
        requiresConceptualJudgement: false,
      },
    ])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([])
    prismaMock.assessment.findMany.mockResolvedValue([])
    prismaMock.teacherMeetingRecord.findMany.mockResolvedValue([])
    prismaMock.studentPhoto.findUnique.mockResolvedValue(null)

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/students/${SID}/closure`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.periods[0].canEdit).toBe(false)
  })

  it('PUT /students/:id/closure guarda rendimiento y juicio', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([
      { studentId: SID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: '1' },
    ])
    prismaMock.academicPeriod.findMany.mockResolvedValue([
      { id: PERIOD_ID, code: 'MAY', name: 'Mayo', startsOn: new Date('2026-03-01T12:00:00.000Z') },
    ])
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue({
      id: 'gbp-1',
      status: 'OPEN',
    })
    prismaMock.periodGrade.upsert.mockResolvedValue({})

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/students/${SID}/closure`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({
        entries: [{ periodId: PERIOD_ID, valueHundredths: 800, conceptualJudgement: 'Muy bien' }],
      })

    expect(res.status).toBe(200)
    expect(res.body.saved).toBe(1)
    expect(prismaMock.periodGrade.upsert).toHaveBeenCalled()
  })

  it('PUT /students/:id/closure rechaza períodos que aún no empezaron', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([
      { studentId: SID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: '1' },
    ])
    prismaMock.academicPeriod.findMany.mockResolvedValue([
      { id: PERIOD_ID, code: 'APE_FEB', name: 'APE Febrero', startsOn: new Date('2099-02-01T12:00:00.000Z') },
    ])
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue({
      id: 'gbp-1',
      status: 'OPEN',
    })

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/students/${SID}/closure`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({
        entries: [{ periodId: PERIOD_ID, valueHundredths: 800, conceptualJudgement: 'No debería' }],
      })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('PERIOD_NOT_ENABLED')
    expect(prismaMock.periodGrade.upsert).not.toHaveBeenCalled()
  })

  it('PUT /students/:id/closure no graba nada si un período está cerrado, aunque otro esté abierto', async () => {
    const CLOSED_ID = '44444444-4444-4444-8444-444444444444'
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([{ studentId: SID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: '1' }])
    prismaMock.academicPeriod.findMany.mockResolvedValue([
      { id: PERIOD_ID, code: 'MAY', name: 'Mayo', startsOn: new Date('2026-03-01T12:00:00.000Z') },
      { id: CLOSED_ID, code: 'JUN', name: 'Junio', startsOn: new Date('2026-03-01T12:00:00.000Z') },
    ])
    prismaMock.gradeBookPeriod.findUnique
      .mockResolvedValueOnce({ id: 'gbp-1', status: 'OPEN' })
      .mockResolvedValueOnce({ id: 'gbp-2', status: 'CLOSED' })

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/students/${SID}/closure`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries: [{ periodId: PERIOD_ID, valueHundredths: 800 }, { periodId: CLOSED_ID, valueHundredths: 900 }] })

    expect(res.status).toBe(409)
    // Antes Mayo ya quedaba grabado cuando Junio daba el error.
    expect(prismaMock.periodGrade.upsert).not.toHaveBeenCalled()
  })

  it('PUT /students/:id/closure deja historial al corregir la R', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    rosterMock.mockResolvedValue([{ studentId: SID, studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'B', documentId: '1' }])
    prismaMock.academicPeriod.findMany.mockResolvedValue([
      { id: PERIOD_ID, code: 'MAY', name: 'Mayo', startsOn: new Date('2026-03-01T12:00:00.000Z') },
    ])
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue({ id: 'gbp-1', status: 'OPEN' })
    prismaMock.periodGrade.findMany.mockResolvedValue([
      { studentId: SID, valueHundredths: 800, meetingValueHundredths: 900, conductValueHundredths: null, conceptualJudgement: null },
    ])

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/students/${SID}/closure`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries: [{ periodId: PERIOD_ID, meetingValueHundredths: 700 }] })

    expect(res.body.revisions).toBe(1)
    expect(prismaMock.periodGradeRevision.create.mock.calls[0][0].data).toMatchObject({
      gradeBookPeriodId: 'gbp-1',
      studentId: SID,
      origin: 'TEACHER',
      previousMeetingValueHundredths: 900,
      newMeetingValueHundredths: 700,
      changedByUserId: 'teacher-1',
    })
  })
})

describe('historial de notas', () => {
  const SID = '22222222-2222-4222-8222-222222222222'

  it('borrar una nota deja la revisión antes de borrarla', async () => {
    readyForAssessments()
    prismaMock.gradeBookPeriod.findUnique.mockResolvedValue({ status: 'OPEN' })
    prismaMock.assessmentGrade.findUnique.mockResolvedValue({ id: 'ag-1', valueHundredths: 700, scaleLevelId: null, isAbsent: false })
    prismaMock.assessmentGrade.count.mockResolvedValue(0)

    const res = await request(app())
      .delete(`/gradebook/${GB_ID}/assessments/${ASSESSMENT_ID}/grades/${SID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(prismaMock.gradeRevision.create.mock.calls[0][0].data).toMatchObject({
      assessmentGradeId: 'ag-1',
      assessmentId: ASSESSMENT_ID,
      studentId: SID,
      previousValueHundredths: 700,
      newValueHundredths: null,
      reason: 'Nota borrada',
    })
    expect(prismaMock.gradeRevision.create.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.assessmentGrade.delete.mock.invocationCallOrder[0],
    )
  })

  it('GET /:id/history junta las correcciones de notas y de C y R del alumno', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    prismaMock.assessment.findMany.mockResolvedValue([
      { id: 'a-1', title: 'Escrito 1', date: new Date('2026-04-10T12:00:00.000Z'), deletedAt: null },
    ])
    prismaMock.gradeRevision.findMany.mockResolvedValue([
      {
        id: 'r-1',
        assessmentId: 'a-1',
        assessmentGradeId: null,
        assessmentGrade: null,
        previousValueHundredths: 700,
        newValueHundredths: null,
        previousIsAbsent: false,
        newIsAbsent: false,
        reason: 'Nota borrada',
        origin: 'TEACHER',
        changedBy: { name: 'Ana G' },
        changedAt: new Date('2026-04-12T15:00:00.000Z'),
      },
    ])
    prismaMock.periodGradeRevision.findMany.mockResolvedValue([
      {
        id: 'p-1',
        gradeBookPeriod: { period: { name: '1.ª Entrega' } },
        previousMeetingValueHundredths: 900,
        newMeetingValueHundredths: 700,
        judgementChanged: false,
        origin: 'TEACHER',
        changedBy: { name: 'Ana G' },
        changedAt: new Date('2026-05-02T15:00:00.000Z'),
      },
    ])

    const res = await request(app())
      .get(`/gradebook/${GB_ID}/history?studentId=${SID}`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.grades[0]).toMatchObject({ assessmentTitle: 'Escrito 1', deleted: true, changedByName: 'Ana G' })
    expect(res.body.periods[0]).toMatchObject({ periodName: '1.ª Entrega', newMeetingValueHundredths: 700 })
    // Sólo de esta libreta: las evaluaciones se buscan por la libreta, también las dadas de baja.
    expect(prismaMock.assessment.findMany.mock.calls[0][0].where).toEqual({ gradeBookId: GB_ID })
  })

  it('GET /:id/history pide el alumno', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    const res = await request(app()).get(`/gradebook/${GB_ID}/history`).set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('STUDENT_REQUIRED')
  })
})

// ─── Estructura de la planilla: tramos, entregas, C y R ─────────────────────

describe('planilla del liceo: tramos y entregas', () => {
  const ENTREGA = {
    ...PERIOD,
    code: 'ENTREGA_1',
    name: '1.ª Entrega (1.ª Reunión)',
    kind: 'ENTREGA',
    sortOrder: 30,
    isMeeting: true,
    judgementLabel: 'Informe de actuación',
  }
  const OPEN_STATE = {
    id: 'gbp-e1',
    status: 'OPEN',
    closedAt: null,
    closedLate: false,
    reopenedAt: null,
    reopenReason: null,
    groupReport: 'El grupo trabajó bien.',
  }

  it('no deja cargar evaluaciones en una entrega', async () => {
    readyForAssessments()
    prismaMock.academicPeriod.findUnique.mockResolvedValue({ schoolYearId: 'sy-1', level: 'EMS', isActive: true, kind: 'ENTREGA' })

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/assessments`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ periodId: PERIOD_ID, date: '2026-05-10', title: 'Escrito', gradingScaleId: SCALE_ID })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('PERIOD_NOT_GRADABLE')
    expect(prismaMock.assessment.create).not.toHaveBeenCalled()
  })

  it('Moodle tampoco importa a una entrega', async () => {
    readyForImport()
    prismaMock.academicPeriod.findUnique.mockResolvedValue({ schoolYearId: 'sy-1', level: 'EMS', isActive: true, kind: 'ENTREGA' })

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/moodle/import`)
      .set('Authorization', `Bearer ${tok()}`)
      .send(importBody)

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('PERIOD_NOT_GRADABLE')
  })

  it('una entrega no cierra sin la conducta (C)', async () => {
    readyForClosure({ saved: [{ ...COMPLETE[0], conductValueHundredths: null }], state: OPEN_STATE })
    prismaMock.academicPeriod.findFirst.mockResolvedValue(ENTREGA)

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/close`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('MISSING_CONDUCT')
    expect(prismaMock.gradeBookPeriod.update).not.toHaveBeenCalled()
  })

  it('una reunión de boletín no cierra sin el informe del grupo', async () => {
    readyForClosure({ saved: COMPLETE, state: { ...OPEN_STATE, groupReport: null } })
    prismaMock.academicPeriod.findFirst.mockResolvedValue(ENTREGA)

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/close`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('MISSING_GROUP_REPORT')
  })

  it('el docente guarda el informe del grupo', async () => {
    readyForClosure({ state: OPEN_STATE })
    prismaMock.academicPeriod.findFirst.mockResolvedValue({ ...ENTREGA, startsOn: new Date('2026-03-01T12:00:00.000Z') })
    prismaMock.gradeBookPeriod.update.mockResolvedValue({ groupReport: 'Buen grupo.', groupReportUpdatedAt: new Date('2026-05-20T12:00:00.000Z') })

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/group-report`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ body: '  Buen grupo.  ' })

    expect(res.status).toBe(200)
    expect(prismaMock.gradeBookPeriod.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'gbp-e1' },
      data: { groupReport: 'Buen grupo.', groupReportUpdatedByUserId: 'teacher-1' },
    })
    expect(res.body.data.body).toBe('Buen grupo.')
  })

  it('Dirección no escribe el informe del grupo', async () => {
    readyForClosure({ state: OPEN_STATE })
    prismaMock.academicPeriod.findFirst.mockResolvedValue(ENTREGA)

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/group-report`)
      .set('Authorization', `Bearer ${tok('DIRECCION', 'd-1')}`)
      .send({ body: 'Lo escribo yo' })

    expect(res.status).toBe(403)
    expect(prismaMock.gradeBookPeriod.update).not.toHaveBeenCalled()
  })

  it('un período cerrado no deja cambiar el informe', async () => {
    readyForClosure({ state: { ...OPEN_STATE, status: 'CLOSED' } })
    prismaMock.academicPeriod.findFirst.mockResolvedValue({ ...ENTREGA, startsOn: new Date('2026-03-01T12:00:00.000Z') })

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/group-report`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ body: 'Tarde' })

    expect(res.status).toBe(409)
    expect(prismaMock.gradeBookPeriod.update).not.toHaveBeenCalled()
  })

  it('cerrar la entrega cierra también los tramos que informa', async () => {
    readyForClosure({ saved: COMPLETE })
    prismaMock.academicPeriod.findFirst.mockResolvedValue(ENTREGA)
    prismaMock.gradeBookPeriod.findUnique
      .mockResolvedValueOnce(OPEN_STATE)
      .mockResolvedValueOnce({ id: 'gbp-marabr', status: 'OPEN' })
    prismaMock.academicPeriod.findMany.mockResolvedValue([
      { id: 'p-diag', code: 'MODULO_INTRODUCTORIO', kind: 'DIAGNOSTICO', sortOrder: 10 },
      { id: 'p-marabr', code: 'MARZO_ABRIL', kind: 'TRAMO', sortOrder: 20 },
      { id: PERIOD_ID, code: 'ENTREGA_1', kind: 'ENTREGA', sortOrder: 30 },
      { id: 'p-mayjun', code: 'MAYO_JUNIO', kind: 'TRAMO', sortOrder: 40 },
    ])
    prismaMock.gradeBookPeriod.update.mockResolvedValue({})

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/close`)
      .set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.coveredPeriodCodes).toEqual(['MARZO_ABRIL'])
    // La entrega se cierra con el update condicional; los tramos que informa, después.
    expect(prismaMock.gradeBookPeriod.updateMany.mock.calls[0][0].where.id).toBe('gbp-e1')
    const closedTramos = prismaMock.gradeBookPeriod.update.mock.calls.map((call: any) => call[0].where.id)
    expect(closedTramos).toEqual(['gbp-marabr'])
  })

  it('guardar sólo R no borra la C que ya estaba', async () => {
    readyForClosure()
    await request(app())
      .put(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/grades`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries: [{ studentId: STUDENT_A, meetingValueHundredths: 700 }] })

    const update = prismaMock.periodGrade.upsert.mock.calls[0][0].update
    expect(update).toMatchObject({ meetingValueHundredths: 700 })
    expect(update).not.toHaveProperty('valueHundredths')
    expect(update).not.toHaveProperty('conceptualJudgement')
  })

  it('rechaza C o R fuera de la escala del nivel', async () => {
    readyForClosure()
    prismaMock.gradingScale.findUnique.mockResolvedValue({
      name: 'Numérica 1 a 12',
      minValueHundredths: 100,
      maxValueHundredths: 1200,
      levels: [],
    })

    const res = await request(app())
      .put(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/grades`)
      .set('Authorization', `Bearer ${tok()}`)
      .send({ entries: [{ studentId: STUDENT_A, meetingValueHundredths: 1300 }] })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALUE_OUT_OF_SCALE')
    expect(prismaMock.periodGrade.upsert).not.toHaveBeenCalled()
  })

  it('la carta trae C, R, texto y el estado de cada período', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    prismaMock.assessment.findMany.mockResolvedValue([])
    prismaMock.assessmentGrade.findMany.mockResolvedValue([])
    prismaMock.academicPeriod.findMany.mockResolvedValue([
      { id: 'p-open', startsOn: new Date('2026-03-01T12:00:00.000Z') },
      { id: 'p-closed', startsOn: new Date('2026-03-01T12:00:00.000Z') },
    ])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      {
        periodId: 'p-closed',
        status: 'CLOSED',
        grades: [{ studentId: STUDENT_A, valueHundredths: 700, meetingValueHundredths: 800, conceptualJudgement: 'Bien.' }],
      },
    ])
    vi.setSystemTime(new Date('2026-05-20T12:00:00.000Z'))

    const res = await request(app()).get(`/gradebook/${GB_ID}/grades-board`).set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.periodGrades).toEqual([
      { periodId: 'p-closed', studentId: STUDENT_A, valueHundredths: 700, meetingValueHundredths: 800, conceptualJudgement: 'Bien.' },
    ])
    expect(res.body.periodStates).toEqual([
      { periodId: 'p-open', status: 'OPEN', canEdit: true },
      { periodId: 'p-closed', status: 'CLOSED', canEdit: false },
    ])
  })
})

describe('reabrir una entrega', () => {
  const closed = { id: 'gbp-1', status: 'CLOSED', closedAt: new Date('2026-06-01T12:00:00Z'), closedLate: false, reopenedAt: null, reopenReason: null }

  it('reabre también los tramos que su cierre congeló y le avisa al docente', async () => {
    readyForClosure({ state: closed })
    prismaMock.academicPeriod.findFirst.mockResolvedValue({ ...PERIOD, kind: 'ENTREGA', sortOrder: 30, code: 'E1', name: '1.ª Entrega' })
    prismaMock.academicPeriod.findMany.mockResolvedValue([
      { id: 'tramo-1', code: 'MAR-ABR', kind: 'TRAMO', sortOrder: 10 },
      { id: 'tramo-2', code: 'MAY', kind: 'TRAMO', sortOrder: 20 },
      { id: PERIOD_ID, code: 'E1', kind: 'ENTREGA', sortOrder: 30 },
    ])
    // Sólo el primer tramo seguía cerrado: el otro ya se había reabierto antes.
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([{ id: 'gbp-t1', periodId: 'tramo-1' }])
    prismaMock.gradeBookPeriod.update.mockResolvedValue({})
    prismaMock.inAppNotification.createMany.mockResolvedValue({ count: 1 })

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/reopen`)
      .set('Authorization', `Bearer ${tok('ADMIN', 'a-1')}`)
      .send({ reason: 'Adscripción observó el juicio de Benítez' })

    expect(res.status).toBe(200)
    expect(res.body.coveredPeriodCodes).toEqual(['MAR-ABR'])
    expect(prismaMock.gradeBookPeriod.findMany.mock.calls[0][0].where).toMatchObject({
      gradeBookId: GB_ID,
      periodId: { in: ['tramo-1', 'tramo-2'] },
      status: 'CLOSED',
    })
    const updated = prismaMock.gradeBookPeriod.update.mock.calls.map((call: any[]) => [call[0].where.id, call[0].data.status])
    expect(updated).toEqual([
      ['gbp-1', 'REOPENED'],
      ['gbp-t1', 'REOPENED'],
    ])
    // El aviso sale en segundo plano: se espera y se busca por tipo, no por posición.
    const reopenNotice = () =>
      prismaMock.inAppNotification.createMany.mock.calls
        .flatMap((call: any[]) => call[0].data)
        .find((n: any) => n.type === 'GRADEBOOK_PERIOD_REOPENED')
    await vi.waitFor(() => expect(reopenNotice()).toBeDefined())
    expect(reopenNotice()).toMatchObject({ userId: 'teacher-1' })
    expect(reopenNotice().body).toContain('Adscripción observó el juicio de Benítez')
  })

  it('un tramo o una reunión sin tramos no toca otros períodos', async () => {
    readyForClosure({ state: closed })
    prismaMock.gradeBookPeriod.update.mockResolvedValue({})

    const res = await request(app())
      .post(`/gradebook/${GB_ID}/periods/${PERIOD_ID}/reopen`)
      .set('Authorization', `Bearer ${tok('ADMIN', 'a-1')}`)
      .send({ reason: 'error de carga detectado por dirección' })

    expect(res.body.coveredPeriodCodes).toEqual([])
    expect(prismaMock.academicPeriod.findMany).not.toHaveBeenCalled()
    expect(prismaMock.gradeBookPeriod.update).toHaveBeenCalledTimes(1)
  })
})

describe('GET /:id/endorsements (visado visto desde la libreta)', () => {
  function endorsedRow(over: any = {}) {
    return {
      id: 'gbp-1',
      gradeBookId: GB_ID,
      status: 'REOPENED',
      closedAt: new Date('2026-06-01T12:00:00Z'),
      closedLate: false,
      updatedAt: new Date('2026-06-03T12:00:00Z'),
      reopenReason: 'Corregir el juicio',
      period: { id: PERIOD_ID, code: 'E1', name: '1.ª Entrega', sortOrder: 30 },
      gradeBook: {
        subject: { id: 'sub-1', name: 'Matemática' },
        teacher: { id: 'teacher-1', name: 'Ana G' },
        courseOffering: { course: { name: '3 EMS' } },
        courseOrientation: null,
      },
      endorsements: [
        {
          section: 'JUDGEMENTS',
          status: 'OBSERVED',
          occurredAt: new Date('2026-06-02T12:00:00Z'),
          observations: 'Falta el juicio de Benítez.',
          actorRoleCode: 'ADSCRIPTO',
          actor: { name: 'Laura Adscripta' },
        },
      ],
      ...over,
    }
  }

  it('el docente ve lo que le observaron, aunque el período esté reabierto para corregir', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([endorsedRow()])

    const res = await request(app()).get(`/gradebook/${GB_ID}/endorsements`).set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(prismaMock.gradeBookPeriod.findMany.mock.calls[0][0].where).toEqual({
      gradeBookId: GB_ID,
      period: { isMeeting: true },
    })
    const row = res.body.data[0]
    expect(row.periodStatus).toBe('REOPENED')
    expect(row.reopenReason).toBe('Corregir el juicio')
    expect(row.sections.find((s: any) => s.section === 'JUDGEMENTS')).toMatchObject({
      status: 'OBSERVED',
      observations: 'Falta el juicio de Benítez.',
    })
    expect(row.history[0]).toMatchObject({ section: 'JUDGEMENTS', status: 'OBSERVED', actorName: 'Laura Adscripta' })
  })

  it('el motivo de reapertura sólo viaja mientras el período sigue reabierto', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([endorsedRow({ status: 'CLOSED' })])
    const res = await request(app()).get(`/gradebook/${GB_ID}/endorsements`).set('Authorization', `Bearer ${tok()}`)
    expect(res.body.data[0].reopenReason).toBeNull()
  })

  it('403 si no es su libreta', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    accessMock.mockResolvedValue({ level: 'NONE', canRead: false, canGrade: false })
    const res = await request(app()).get(`/gradebook/${GB_ID}/endorsements`).set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(403)
    expect(prismaMock.gradeBookPeriod.findMany).not.toHaveBeenCalled()
  })
})

describe('suplente: ve y carga sólo sus notas', () => {
  const SUBSTITUTE = {
    level: 'SUBSTITUTE',
    canRead: true,
    canGrade: true,
    canPlan: false,
    ownWorkOnly: true,
    substituteUntil: new Date('2026-05-27T02:59:59.999Z'),
  }
  const subTok = () => tok('TEACHER', 'suplente-1')

  beforeEach(() => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    accessMock.mockResolvedValue(SUBSTITUTE)
  })

  it('lo del titular le queda cerrado: planificación, períodos, cierre, mensajes, historia y exportaciones', async () => {
    for (const path of ['planning', 'development', 'periods', 'messages', 'endorsements', 'exports/xlsx']) {
      const res = await request(app()).get(`/gradebook/${GB_ID}/${path}`).set('Authorization', `Bearer ${subTok()}`)
      expect(res.status, path).toBe(403)
      expect(res.body.code, path).toBe('SUBSTITUTE_OWN_WORK_ONLY')
    }
  })

  it('el encabezado dice que es una suplencia y hasta cuándo', async () => {
    const res = await request(app()).get(`/gradebook/${GB_ID}`).set('Authorization', `Bearer ${subTok()}`)
    expect(res.status).toBe(200)
    expect(res.body.access).toMatchObject({
      level: 'SUBSTITUTE',
      ownWorkOnly: true,
      substituteUntil: '2026-05-27T02:59:59.999Z',
    })
  })

  it('la carta le trae sólo sus evaluaciones, sin C, R ni juicios', async () => {
    prismaMock.assessment.findMany.mockResolvedValue([])
    prismaMock.assessmentGrade.findMany.mockResolvedValue([])
    prismaMock.academicPeriod.findMany.mockResolvedValue([])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([
      { periodId: 'p-1', status: 'OPEN', grades: [{ studentId: STUDENT_A, meetingValueHundredths: 800, conceptualJudgement: 'Bien.' }] },
    ])

    const res = await request(app()).get(`/gradebook/${GB_ID}/grades-board`).set('Authorization', `Bearer ${subTok()}`)

    expect(res.status).toBe(200)
    expect(res.body.periodGrades).toEqual([])
    expect(prismaMock.assessment.findMany.mock.calls[0][0].where).toMatchObject({ createdByUserId: 'suplente-1' })
    expect(prismaMock.assessmentGrade.findMany.mock.calls[0][0].where.assessment).toMatchObject({
      createdByUserId: 'suplente-1',
    })
  })

  it('una evaluación del titular no existe para él', async () => {
    prismaMock.assessment.findFirst.mockResolvedValue(null)
    const res = await request(app())
      .get(`/gradebook/${GB_ID}/assessments/${'66666666-6666-4666-8666-666666666666'}/grades`)
      .set('Authorization', `Bearer ${subTok()}`)
    expect(res.status).toBe(404)
    expect(prismaMock.assessment.findFirst.mock.calls[0][0].where).toMatchObject({ createdByUserId: 'suplente-1' })
  })

  it('agrega sus notas: la evaluación queda a su nombre', async () => {
    readyForAssessments()
    prismaMock.assessment.create.mockResolvedValue(ASSESSMENT)
    const res = await request(app())
      .post(`/gradebook/${GB_ID}/assessments`)
      .set('Authorization', `Bearer ${subTok()}`)
      .send({ periodId: PERIOD_ID, date: '2026-05-10', title: 'Escrito de la suplencia', gradingScaleId: SCALE_ID })
    expect(res.status).toBe(201)
    expect(prismaMock.assessment.create.mock.calls[0][0].data.createdByUserId).toBe('suplente-1')
  })
})

describe('el titular ve quién cargó cada nota', () => {
  it('marca las del suplente', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue(ROW)
    prismaMock.assessment.findMany.mockResolvedValue([
      { id: 'a-1', periodId: 'p-1', date: new Date('2026-05-10T12:00:00.000Z'), title: 'Escrito', scope: 'GROUP', activityType: null, gradingScale: null, period: null, createdBy: { id: 'suplente-1', name: 'Bruno Suplente', firstName: null, lastName: null } },
      { id: 'a-2', periodId: 'p-1', date: new Date('2026-05-11T12:00:00.000Z'), title: 'Oral', scope: 'GROUP', activityType: null, gradingScale: null, period: null, createdBy: { id: 'teacher-1', name: 'Ana G', firstName: null, lastName: null } },
    ])
    prismaMock.assessmentGrade.findMany.mockResolvedValue([])
    prismaMock.academicPeriod.findMany.mockResolvedValue([])
    prismaMock.gradeBookPeriod.findMany.mockResolvedValue([])
    prismaMock.substitution.findMany.mockResolvedValue([{ substituteUserId: 'suplente-1' }])

    const res = await request(app()).get(`/gradebook/${GB_ID}/grades-board`).set('Authorization', `Bearer ${tok()}`)

    expect(res.status).toBe(200)
    expect(res.body.assessments.map((a: any) => a.author)).toEqual([
      { id: 'suplente-1', name: 'Bruno Suplente', isSubstitute: true },
      { id: 'teacher-1', name: 'Ana G', isSubstitute: false },
    ])
  })
})

describe('GET /gradebook/mine: la suplencia es provisoria', () => {
  const coveredEvent = { schoolYearId: 'sy-1', courseOfferingId: 'off-1', subjectId: 'sub-1', orientationId: null, courseOrientationId: null }

  it('una suplencia vencida no pone la libreta en la lista', async () => {
    prismaMock.substitution.findMany.mockResolvedValue([{ date: new Date('2020-03-10T03:00:00.000Z'), event: coveredEvent }])
    prismaMock.gradeBook.findMany.mockResolvedValue([])
    await request(app()).get('/gradebook/mine').set('Authorization', `Bearer ${tok('TEACHER', 'suplente-1')}`)
    expect(prismaMock.gradeBook.findMany.mock.calls[0][0].where.OR[1]).toEqual({ scopeKey: { in: [] } })
  })

  it('una suplencia abierta trae la fecha en que se le cierra', async () => {
    prismaMock.substitution.findMany.mockResolvedValue([{ date: new Date(Date.now() - 3_600_000), event: coveredEvent }])
    prismaMock.gradeBook.findMany.mockResolvedValue([{ ...ROW, teacherUserId: 'teacher-1' }])
    const res = await request(app()).get('/gradebook/mine').set('Authorization', `Bearer ${tok('TEACHER', 'suplente-1')}`)
    expect(res.status).toBe(200)
    expect(res.body.data[0].substitution.until).toEqual(expect.any(String))
  })
})
