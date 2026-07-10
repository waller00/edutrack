import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { resolveMoodleAcademicScope } from '../integrations/moodle/scope.js'
import {
  buildGradeWorkbook,
  parseGradeWorkbook,
  type GradeWorkbookEntry,
} from '../services/grades/gradeSheet.js'
import type { MoodleAssignment } from '../integrations/moodle/grades.js'

vi.mock('../middlewares/auth.js', () => ({
  authGuard: (req: any, _res: any, next: () => void) => {
    req.user = { sub: 'admin-1', id: 'admin-1', role: 'ADMIN' }
    next()
  },
  requirePermission: () => (_req: any, _res: any, next: () => void) => next(),
}))

const {
  prismaMock,
  auditMock,
  mappedIds,
  assignmentsByCourse,
  listAssignmentsMock,
  getGradesMock,
  saveGradeMock,
  enrolledMock,
} = vi.hoisted(() => {
  const mappedIds = new Map<string, number>()
  const assignmentsByCourse = new Map<number, unknown[]>()
  return {
    prismaMock: {
      courseOffering: { findUnique: vi.fn() },
      courseOrientation: { findUnique: vi.fn() },
      orientation: { findUnique: vi.fn() },
      subject: { findUnique: vi.fn(), findMany: vi.fn() },
      studentEnrollment: { findMany: vi.fn() },
    },
    auditMock: vi.fn(),
    mappedIds,
    assignmentsByCourse,
    listAssignmentsMock: vi.fn(async (courseId: number) => assignmentsByCourse.get(courseId) ?? []),
    getGradesMock: vi.fn(async () => new Map<number, number>()),
    saveGradeMock: vi.fn(async () => undefined),
    enrolledMock: vi.fn(async () => new Set<number>()),
  }
})

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/audit-log.js', () => ({ recordAuditEvent: auditMock }))
vi.mock('../integrations/moodle/client.js', () => ({ isMoodleIntegrationEnabled: () => true }))
vi.mock('../integrations/moodle/object-map.js', () => ({
  getMappedId: vi.fn(async (type: string, key: string) => mappedIds.get(`${type}:${key}`) ?? null),
}))
vi.mock('../integrations/moodle/enrolments.js', () => ({
  getEnrolledUserIds: enrolledMock,
}))
vi.mock('../integrations/moodle/student-users.js', () => ({
  studentIdnumber: (id: string) => `et-student-${id}`,
}))
vi.mock('../integrations/moodle/grades.js', () => ({
  listCourseAssignments: listAssignmentsMock,
  getAssignmentGrades: getGradesMock,
  saveAssignmentGrade: saveGradeMock,
}))

import gradesRoutes from './grades.js'

function app() {
  const a = express()
  a.use(express.json({ limit: '5mb' }))
  a.use('/grades', gradesRoutes)
  return a
}

/** Junta la respuesta binaria (xlsx) en un Buffer. */
const binaryParser = (res: any, cb: (err: unknown, body: Buffer) => void) => {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

const OFF = '11111111-1111-4111-8111-111111111111'
const SUB1 = '22222222-2222-4222-8222-222222222222'
const SUB2 = '33333333-3333-4333-8333-333333333333'
const SUB3 = '99999999-9999-4999-8999-999999999999' // sin curso Moodle
const CO1 = '44444444-4444-4444-8444-444444444444' // CourseOrientation
const OR1 = '55555555-5555-4555-8555-555555555555' // Orientation de catálogo
const ST1 = '66666666-6666-4666-8666-666666666666'
const ST2 = '77777777-7777-4777-8777-777777777777'

const subjectNames: Record<string, string> = { [SUB1]: 'Matemática', [SUB2]: 'Física', [SUB3]: 'Danza' }

function scopeIdnumber(subjectId: string, courseOrientationId: string | null = null): string {
  const scope = resolveMoodleAcademicScope({
    schoolYearId: 'sy-1',
    courseOfferingId: OFF,
    subjectId,
    orientationId: null,
    courseOrientationId,
  })
  return scope!.idnumber
}

const pointAssignment = (id: number, name: string, maxGrade = 100): MoodleAssignment => ({
  id,
  cmid: id * 10,
  name,
  maxGrade,
  gradeType: 'point',
})

describe('grades routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mappedIds.clear()
    assignmentsByCourse.clear()

    prismaMock.courseOffering.findUnique.mockResolvedValue({
      id: OFF,
      courseId: 'course-1',
      schoolYearId: 'sy-1',
      course: { name: '2 EMS', level: null },
      schoolYear: { label: 'Ciclo lectivo 2026' },
    })
    prismaMock.courseOrientation.findUnique.mockResolvedValue({
      courseId: 'course-1',
      orientation: { name: 'Ciencias' },
    })
    prismaMock.orientation.findUnique.mockResolvedValue({ name: 'Ciencias' })
    prismaMock.subject.findUnique.mockImplementation(async ({ where }: any) =>
      subjectNames[where.id] ? { id: where.id, name: subjectNames[where.id] } : null,
    )
    prismaMock.subject.findMany.mockResolvedValue([
      { id: SUB1, name: subjectNames[SUB1] },
      { id: SUB2, name: subjectNames[SUB2] },
      { id: SUB3, name: subjectNames[SUB3] },
    ])
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      { student: { id: ST1, firstName: 'Ana', lastName: 'Pérez' } },
      { student: { id: ST2, firstName: 'Beto', lastName: 'Díaz' } },
    ])

    // Cursos Moodle sincronizados: SUB1 y SUB2 generales; SUB1 también por orientación CO1.
    mappedIds.set(`SUBJECT_COURSE:${scopeIdnumber(SUB1)}`, 101)
    mappedIds.set(`SUBJECT_COURSE:${scopeIdnumber(SUB2)}`, 102)
    mappedIds.set(`SUBJECT_COURSE:${scopeIdnumber(SUB1, CO1)}`, 201)
    mappedIds.set(`STUDENT:${ST1}`, 9001)
    mappedIds.set(`STUDENT:${ST2}`, 9002)

    assignmentsByCourse.set(101, [
      pointAssignment(5, 'Prueba 1'),
      { id: 7, cmid: 70, name: 'Rúbrica', maxGrade: null, gradeType: 'scale' },
    ])
    assignmentsByCourse.set(102, [pointAssignment(6, 'Parcial', 12)])
    assignmentsByCourse.set(201, [pointAssignment(9, 'Prueba orientada')])

    enrolledMock.mockResolvedValue(new Set([9001, 9002]))
    getGradesMock.mockResolvedValue(new Map([[9001, 80]]))
  })

  describe('GET /grades/activities', () => {
    it('lista las tareas del curso Moodle de la asignatura', async () => {
      const res = await request(app()).get(`/grades/activities?courseOfferingId=${OFF}&subjectId=${SUB1}`)
      expect(res.status).toBe(200)
      expect(res.body.assignments).toHaveLength(2)
      expect(listAssignmentsMock).toHaveBeenCalledWith(101)
    })

    it('usa el curso de la orientación cuando está sincronizado', async () => {
      const res = await request(app()).get(
        `/grades/activities?courseOfferingId=${OFF}&subjectId=${SUB1}&courseOrientationId=${CO1}&orientationId=${OR1}`,
      )
      expect(res.status).toBe(200)
      expect(listAssignmentsMock).toHaveBeenCalledWith(201)
      expect(res.body.courseLabel).toContain('Ciencias')
    })

    it('409 cuando el curso no está sincronizado', async () => {
      mappedIds.delete(`SUBJECT_COURSE:${scopeIdnumber(SUB1)}`)
      const res = await request(app()).get(`/grades/activities?courseOfferingId=${OFF}&subjectId=${SUB1}`)
      expect(res.status).toBe(409)
    })
  })

  describe('GET /grades/sheet', () => {
    it('400 si se filtra por tarea sin asignatura', async () => {
      const res = await request(app()).get(`/grades/sheet?courseOfferingId=${OFF}&assignmentId=5`)
      expect(res.status).toBe(400)
    })

    it('tarea puntual: una hoja con roster, nota actual y metadatos', async () => {
      const res = await request(app())
        .get(`/grades/sheet?courseOfferingId=${OFF}&subjectId=${SUB1}&assignmentId=5`)
        .buffer(true)
        .parse(binaryParser)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('spreadsheetml')

      const sheets = await parseGradeWorkbook(res.body as Buffer)
      expect(sheets).toHaveLength(1)
      expect(sheets[0].meta).toEqual({
        subjectId: SUB1,
        assignmentId: 5,
        courseOrientationId: null,
        orientationId: null,
      })
      expect(sheets[0].rows.map((r) => r.idnumber)).toEqual([`et-student-${ST1}`, `et-student-${ST2}`])
    })

    it('curso entero: una hoja por tarea calificable, salteando asignaturas sin curso Moodle', async () => {
      const res = await request(app())
        .get(`/grades/sheet?courseOfferingId=${OFF}`)
        .buffer(true)
        .parse(binaryParser)
      expect(res.status).toBe(200)

      const sheets = await parseGradeWorkbook(res.body as Buffer)
      // SUB1: sólo "Prueba 1" (la rúbrica queda afuera); SUB2: "Parcial"; SUB3 (Danza) sin curso → salteada.
      expect(sheets.map((s) => s.meta?.assignmentId)).toEqual([5, 6])
      expect(sheets.map((s) => s.meta?.subjectId)).toEqual([SUB1, SUB2])
    })

    it('con orientación: usa el curso orientado y cae al general cuando no existe', async () => {
      const res = await request(app())
        .get(`/grades/sheet?courseOfferingId=${OFF}&courseOrientationId=${CO1}&orientationId=${OR1}`)
        .buffer(true)
        .parse(binaryParser)
      expect(res.status).toBe(200)

      const sheets = await parseGradeWorkbook(res.body as Buffer)
      // SUB1 resuelve al curso orientado (tarea 9); SUB2 no tiene curso orientado → cae al general (tarea 6).
      expect(sheets.map((s) => s.meta?.assignmentId)).toEqual([9, 6])
      expect(sheets[0].meta?.courseOrientationId).toBe(CO1)
      expect(sheets[1].meta?.courseOrientationId).toBeNull()
    })

    it('409 si la asignatura elegida no está sincronizada', async () => {
      const res = await request(app()).get(`/grades/sheet?courseOfferingId=${OFF}&subjectId=${SUB3}`)
      expect(res.status).toBe(409)
    })

    it('404 con mensaje accionable cuando los cursos no tienen tareas', async () => {
      assignmentsByCourse.clear()
      const res = await request(app()).get(`/grades/sheet?courseOfferingId=${OFF}`)
      expect(res.status).toBe(404)
      expect(res.body.message).toContain('no tienen tareas')
    })

    it('404 distinto cuando ninguna asignatura está sincronizada', async () => {
      mappedIds.clear()
      const res = await request(app()).get(`/grades/sheet?courseOfferingId=${OFF}`)
      expect(res.status).toBe(404)
      expect(res.body.message).toContain('sincronizada')
    })
  })

  describe('POST /grades/sheet/upload', () => {
    const students = [
      { name: 'Pérez, Ana', idnumber: `et-student-${ST1}`, currentGrade: 80, hasMoodleAccount: true },
      { name: 'Díaz, Beto', idnumber: `et-student-${ST2}`, currentGrade: null, hasMoodleAccount: true },
    ]

    function workbookEntry(assignment: MoodleAssignment, subjectId: string): GradeWorkbookEntry {
      return {
        courseLabel: 'x',
        assignment,
        students,
        meta: { subjectId, assignmentId: assignment.id, courseOrientationId: null, orientationId: null },
        sheetTitle: assignment.name,
      }
    }

    async function fillGrades(buffer: Buffer, grades: Array<Array<number | string>>): Promise<string> {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(buffer)
      grades.forEach((sheetGrades, sheetIdx) => {
        sheetGrades.forEach((grade, rowIdx) => {
          if (grade !== '') wb.worksheets[sheetIdx].getRow(3 + rowIdx).getCell(4).value = grade
        })
      })
      return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')
    }

    it('multi-hoja: escribe cada hoja en su tarea y reporta errores por hoja/fila', async () => {
      const buffer = await buildGradeWorkbook([
        workbookEntry(pointAssignment(5, 'Prueba 1'), SUB1),
        workbookEntry(pointAssignment(6, 'Parcial', 12), SUB2),
      ])
      // Hoja 1: Ana 95, Beto 150 (fuera de rango). Hoja 2: sólo Beto 10.
      const fileBase64 = await fillGrades(buffer, [[95, 150], ['', 10]])

      const res = await request(app())
        .post('/grades/sheet/upload')
        .send({ courseOfferingId: OFF, fileBase64 })
      expect(res.status).toBe(200)
      expect(res.body.updatedCount).toBe(2)
      expect(saveGradeMock).toHaveBeenCalledWith(5, 9001, 95)
      expect(saveGradeMock).toHaveBeenCalledWith(6, 9002, 10)
      expect(res.body.errors).toHaveLength(1)
      expect(res.body.errors[0]).toMatchObject({ sheet: 'Prueba 1', row: 4 })
      expect(res.body.errors[0].message).toContain('fuera de rango')
      expect(auditMock).toHaveBeenCalled()
    })

    it('planilla legada sin metadatos: usa asignatura y tarea del request', async () => {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      const sheet = wb.addWorksheet('Notas')
      sheet.addRow(['Alumno', 'idnumber', 'Nota actual', 'Nota nueva'])
      sheet.addRow(['Ana', `et-student-${ST1}`, 80, 91])
      const fileBase64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')

      const res = await request(app())
        .post('/grades/sheet/upload')
        .send({ courseOfferingId: OFF, subjectId: SUB1, assignmentId: 5, fileBase64 })
      expect(res.status).toBe(200)
      expect(res.body.updatedCount).toBe(1)
      expect(saveGradeMock).toHaveBeenCalledWith(5, 9001, 91)
    })

    it('hoja sin metadatos y sin filtros: error legible sin escribir nada', async () => {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      const sheet = wb.addWorksheet('Notas')
      sheet.addRow(['Alumno', 'idnumber', 'Nota actual', 'Nota nueva'])
      sheet.addRow(['Ana', `et-student-${ST1}`, 80, 91])
      const fileBase64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')

      const res = await request(app()).post('/grades/sheet/upload').send({ courseOfferingId: OFF, fileBase64 })
      expect(res.status).toBe(200)
      expect(res.body.updatedCount).toBe(0)
      expect(saveGradeMock).not.toHaveBeenCalled()
      expect(res.body.errors[0].message).toContain('identificar la tarea')
    })

    it('hoja de una tarea de escala: error por hoja, no 422 global', async () => {
      const buffer = await buildGradeWorkbook([
        workbookEntry({ id: 7, cmid: 70, name: 'Rúbrica', maxGrade: null, gradeType: 'scale' }, SUB1),
        workbookEntry(pointAssignment(5, 'Prueba 1'), SUB1),
      ])
      const fileBase64 = await fillGrades(buffer, [[1, ''], [95, '']])

      const res = await request(app())
        .post('/grades/sheet/upload')
        .send({ courseOfferingId: OFF, fileBase64 })
      expect(res.status).toBe(200)
      expect(res.body.updatedCount).toBe(1)
      expect(saveGradeMock).toHaveBeenCalledWith(5, 9001, 95)
      expect(res.body.errors[0]).toMatchObject({ sheet: 'Rúbrica' })
      expect(res.body.errors[0].message).toContain('calificación numérica')
    })
  })
})
