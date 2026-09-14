import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'

const r = Router()
const yearSchema = z.coerce.number().int().min(2000).max(2100)
const monthSchema = z.coerce.number().int().min(1).max(12)
const querySchema = z.object({
  year: yearSchema,
  month: monthSchema,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).default(''),
  courseId: z.string().uuid().optional(),
  status: z.enum(['all', 'paid', 'pending', 'none']).default('all'),
})

// El período de cobro define también la matrícula: un estudiante aparece una sola
// vez, aunque tenga varios ciclos. Se conservan visibles las cuotas históricas.
r.get('/', async (req, res) => {
  const parsed = querySchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Revisá el período y los filtros.' })
  const { year, month, page, pageSize, q, courseId, status } = parsed.data
  const enrollment: Prisma.StudentEnrollmentWhereInput = {
    schoolYear: { code: year },
    ...(courseId ? { courseOffering: { courseId } } : {}),
  }
  const base: Prisma.StudentWhereInput = {
    AND: [
      courseId
        ? { enrollments: { some: enrollment } }
        : { OR: [{ enrollments: { some: enrollment } }, { tuitionMonths: { some: { year } } }] },
      ...(q ? [{ OR: ['firstName', 'lastName', 'documentId'].map((field) => ({
        [field]: { contains: q, mode: 'insensitive' },
      })) }] : []),
    ],
  }
  const stateWhere: Prisma.StudentWhereInput = status === 'all' ? {} : {
    tuitionMonths: status === 'none'
      ? { none: { year, month } }
      : { some: { year, month, paid: status === 'paid' } },
  }
  try {
    const groupedPayments = prisma.studentTuitionMonth.groupBy({
      by: ['paid'], where: { year, month, student: base },
      _count: { _all: true, amountCents: true }, _sum: { amountCents: true },
    })
    // Los contadores abarcan todos los resultados, no sólo la página visible.
    const [students, groups, total, data] = await prisma.$transaction([
      prisma.student.count({ where: base }),
      groupedPayments,
      prisma.student.count({ where: { AND: [base, stateWhere] } }),
      prisma.student.findMany({
        where: { AND: [base, stateWhere] },
        skip: (page - 1) * pageSize, take: pageSize,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        select: {
          id: true, firstName: true, lastName: true, documentId: true,
          enrollments: {
            where: enrollment, take: 1,
            select: { courseOffering: { select: { course: { select: { id: true, name: true } } } } },
          },
          tuitionMonths: {
            where: { year }, orderBy: { month: 'asc' },
            select: { year: true, month: true, paid: true, paidAt: true, amountCents: true, notes: true },
          },
        },
      }),
    ])
    const paid = groups.find((group) => group.paid)
    const pending = groups.find((group) => !group.paid)
    return res.json({
      year, month, page, pageSize, total,
      summary: {
        students,
        paid: paid?._count._all ?? 0,
        pending: pending?._count._all ?? 0,
        none: students - (paid?._count._all ?? 0) - (pending?._count._all ?? 0),
        collectedCents: paid?._sum.amountCents ?? 0,
        pendingCents: pending?._sum.amountCents ?? 0,
        paidWithoutAmount: (paid?._count._all ?? 0) - (paid?._count.amountCents ?? 0),
        pendingWithoutAmount: (pending?._count._all ?? 0) - (pending?._count.amountCents ?? 0),
      },
      data: data.map(({ enrollments, ...student }) => ({
        ...student, course: enrollments[0]?.courseOffering.course ?? null,
      })),
    })
  } catch (error) {
    console.error('[admin-tuition:list]', error)
    return res.status(500).json({ message: 'No se pudieron cargar las mensualidades.' })
  }
})

const paramsSchema = z.object({ studentId: z.string().uuid(), year: yearSchema, month: monthSchema })
const paymentSchema = z.object({
  status: z.enum(['paid', 'pending', 'none']),
  amountCents: z.number().int().min(0).max(2147483647).nullable(),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T12:00:00.000Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, 'Fecha inválida').nullable(),
  notes: z.string().trim().max(2000).nullable(),
}).refine((body) => body.status !== 'paid' || body.paidAt !== null, 'Indicá la fecha del pago.')

// Se modifica una sola cuota. Guardar datos personales o una cuota de otro mes
// nunca reemplaza el historial de mensualidades completo.
r.put('/:studentId/:year/:month', async (req, res) => {
  const params = paramsSchema.safeParse(req.params)
  const body = paymentSchema.safeParse(req.body)
  if (!params.success || !body.success) {
    return res.status(400).json({ message: !body.success ? body.error.issues[0].message : 'Período inválido.' })
  }
  const { studentId, year, month } = params.data
  const { status, amountCents, paidAt, notes } = body.data
  try {
    const [student, schoolYear] = await Promise.all([
      prisma.student.findUnique({ where: { id: studentId }, select: { id: true } }),
      prisma.schoolYear.findUnique({ where: { code: year }, select: { id: true } }),
    ])
    if (!student) return res.status(404).json({ message: 'Estudiante no encontrado.' })
    if (status === 'none') {
      await prisma.studentTuitionMonth.deleteMany({ where: { studentId, year, month } })
      return res.json({ month: null })
    }
    if (!schoolYear) return res.status(400).json({ message: `Creá el ciclo lectivo ${year} antes de registrar una mensualidad.` })
    const data = {
      paid: status === 'paid', amountCents, notes: notes || null,
      paidAt: status === 'paid' ? new Date(`${paidAt}T12:00:00.000Z`) : null,
      schoolYearId: schoolYear.id,
    }
    const saved = await prisma.studentTuitionMonth.upsert({
      where: { studentId_year_month: { studentId, year, month } },
      create: { studentId, year, month, ...data }, update: data,
      select: { year: true, month: true, paid: true, paidAt: true, amountCents: true, notes: true },
    })
    return res.json({ month: saved })
  } catch (error) {
    console.error('[admin-tuition:save]', error)
    return res.status(500).json({ message: 'No se pudo guardar la mensualidad. Intentá nuevamente.' })
  }
})

export default r
