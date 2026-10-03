import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { signAccessToken } from '../test-utils/bearer-token.js'

const db = vi.hoisted(() => ({
  student: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  studentTuitionMonth: { groupBy: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  schoolYear: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('../db/prisma.js', () => ({ prisma: db }))
import routes from './admin-tuition.js'
import { authGuard, requirePermission } from '../middlewares/auth.js'

const app = express()
app.use(express.json())
app.use('/admin/tuition', authGuard, requirePermission('students.manage', 'all'), routes)
const studentId = '44444444-4444-4444-8444-444444444444'
const token = () => `Bearer ${signAccessToken({ sub: 'admin', email: 'admin@test.com', role: 'ADMIN' })}`
const path = `/admin/tuition/${studentId}/2026/3`
const payment = { status: 'paid', paidAt: '2026-03-12', amountCents: 350050, notes: 'Transferencia' }

beforeEach(() => {
  vi.resetAllMocks()
  db.student.count.mockResolvedValue(30)
  db.student.findMany.mockResolvedValue([{ id: studentId, firstName: 'Ana', lastName: 'Díaz', enrollments: [], tuitionMonths: [] }])
  db.student.findUnique.mockResolvedValue({ id: studentId })
  db.schoolYear.findUnique.mockResolvedValue({ id: 'cycle-2026' })
  db.studentTuitionMonth.groupBy.mockResolvedValue([
    { paid: true, _count: { _all: 20, amountCents: 19 }, _sum: { amountCents: 6650000 } },
    { paid: false, _count: { _all: 4, amountCents: 2 }, _sum: { amountCents: 700000 } },
  ])
  db.studentTuitionMonth.upsert.mockImplementation(async (args) => args.create)
  db.$transaction.mockImplementation((queries) => Promise.all(queries))
})

describe('listado de mensualidades', () => {
  it('calcula el resumen sobre toda la búsqueda, independiente de la página y del estado', async () => {
    db.student.count.mockResolvedValueOnce(30).mockResolvedValueOnce(4)
    const response = await request(app).get('/admin/tuition?year=2026&month=3&status=pending&page=2&pageSize=2').set('Authorization', token())
    expect(response.status).toBe(200)
    expect(response.body.summary).toEqual({ students: 30, paid: 20, pending: 4, none: 6, collectedCents: 6650000, pendingCents: 700000, paidWithoutAmount: 1, pendingWithoutAmount: 2 })
    expect(response.body.total).toBe(4)
    expect(response.body.data[0].course).toBeNull()
    expect(db.student.findMany.mock.calls[0][0]).toMatchObject({ skip: 2, take: 2, where: { AND: [expect.anything(), { tuitionMonths: { some: { year: 2026, month: 3, paid: false } } }] } })
    expect(db.studentTuitionMonth.groupBy.mock.calls[0][0].where).not.toHaveProperty('paid')
  })
  it('sin registrar busca la ausencia de cuota, sin confundirla con pendiente', async () => {
    await request(app).get('/admin/tuition?year=2025&month=8&status=none').set('Authorization', token())
    const args = db.student.findMany.mock.calls[0][0]
    expect(args.where.AND[1]).toEqual({ tuitionMonths: { none: { year: 2025, month: 8 } } })
    expect(args.select.tuitionMonths.where).toEqual({ year: 2025 })
    expect(args.select.enrollments.where.schoolYear).toEqual({ code: 2025 })
  })
  it('aplica curso y año a la misma matrícula', async () => {
    const courseId = '55555555-5555-4555-8555-555555555555'
    await request(app).get(`/admin/tuition?year=2025&month=8&courseId=${courseId}&q=Ana`).set('Authorization', token())
    expect(db.student.findMany.mock.calls[0][0].where.AND[0].AND[0]).toEqual({ enrollments: { some: { schoolYear: { code: 2025 }, courseOffering: { courseId } } } })
  })
  it.each(['month=13', 'month=1.5', 'year=abc', 'page=0', 'pageSize=101', 'status=unknown'])('rechaza filtros inválidos: %s', async (invalid) => {
    const params = new URLSearchParams('year=2026&month=3')
    const [key, value] = invalid.split('='); params.set(key, value)
    expect((await request(app).get(`/admin/tuition?${params}`).set('Authorization', token())).status).toBe(400)
    expect(db.student.findMany).not.toHaveBeenCalled()
  })
})

describe('registro de una mensualidad', () => {
  it('actualiza exclusivamente el estudiante, año y mes elegidos, con centavos y fecha exactos', async () => {
    const response = await request(app).put(path).set('Authorization', token()).send(payment)
    expect(response.status).toBe(200)
    expect(db.studentTuitionMonth.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { studentId_year_month: { studentId, year: 2026, month: 3 } },
      update: { paid: true, paidAt: new Date('2026-03-12T12:00:00Z'), amountCents: 350050, notes: 'Transferencia', schoolYearId: 'cycle-2026' },
    }))
    expect(db.studentTuitionMonth.deleteMany).not.toHaveBeenCalled()
  })
  it('guarda pendientes con importe y notas, limpiando la fecha de pago', async () => {
    await request(app).put(path).set('Authorization', token()).send({ ...payment, status: 'pending' })
    expect(db.studentTuitionMonth.upsert.mock.calls[0][0].update).toMatchObject({ paid: false, paidAt: null, amountCents: 350050, notes: 'Transferencia' })
  })
  it('quitar el registro sólo borra el mes elegido', async () => {
    const response = await request(app).put(path).set('Authorization', token()).send({ status: 'none', amountCents: null, paidAt: null, notes: null })
    expect(response.body).toEqual({ month: null })
    expect(db.studentTuitionMonth.deleteMany).toHaveBeenCalledWith({ where: { studentId, year: 2026, month: 3 } })
    expect(db.studentTuitionMonth.upsert).not.toHaveBeenCalled()
  })
  it.each([{ paidAt: null }, { paidAt: '2026-02-30' }, { amountCents: -1 }, { amountCents: 1.5 }, { amountCents: 2147483648 }])('rechaza datos inválidos %j sin escribir', async (invalid) => {
    expect((await request(app).put(path).set('Authorization', token()).send({ ...payment, ...invalid })).status).toBe(400)
    expect(db.studentTuitionMonth.upsert).not.toHaveBeenCalled()
  })
  it('exige un ciclo existente antes de cobrar', async () => {
    db.schoolYear.findUnique.mockResolvedValue(null)
    expect((await request(app).put(path).set('Authorization', token()).send(payment)).status).toBe(400)
    expect(db.studentTuitionMonth.upsert).not.toHaveBeenCalled()
  })
  it('devuelve 404 si el estudiante ya no existe', async () => {
    db.student.findUnique.mockResolvedValue(null)
    expect((await request(app).put(path).set('Authorization', token()).send(payment)).status).toBe(404)
  })
  it('protege consultas y cambios sin sesión', async () => {
    expect((await request(app).get('/admin/tuition?year=2026&month=3')).status).toBe(401)
    expect((await request(app).put(path).send(payment)).status).toBe(401)
    expect(db.studentTuitionMonth.upsert).not.toHaveBeenCalled()
  })
  it('no permite consultar ni guardar a un docente sin permiso de administración', async () => {
    const teacher = `Bearer ${signAccessToken({ sub: 'teacher', email: 'teacher@test.com', role: 'TEACHER' })}`
    expect((await request(app).get('/admin/tuition?year=2026&month=3').set('Authorization', teacher)).status).toBe(403)
    expect((await request(app).put(path).set('Authorization', teacher).send(payment)).status).toBe(403)
    expect(db.studentTuitionMonth.upsert).not.toHaveBeenCalled()
  })
})
