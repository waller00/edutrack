import { Router } from 'express'
import type { Request } from 'express'
import { z } from 'zod'
import { Prisma, StudentEnrollmentStatus } from '@prisma/client'
import { prisma } from '../prisma.js'
import { getActiveSchoolYearId, resolveSchoolYearIdForList } from '../services/school-year-service.js'

const r = Router()

async function scopedSchoolYearWhere(req: Request): Promise<Prisma.StudentWhereInput> {
  const allYears = req.query.allYears === '1'
  if (allYears) return {}
  const id = await resolveSchoolYearIdForList(prisma, {
    role: req.user?.role,
    requestedSchoolYearId: typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : undefined,
  })
  if (!id) return {}
  return { schoolYearId: id }
}

const enrollmentStatusZ = z.enum(['ACTIVE', 'WITHDRAWN', 'GRADUATED', 'TRANSFERRED'])

function emptyToUndefined(v: unknown) {
  if (v === null || v === '') return undefined
  return v
}

function optionalTrimmedString(max: number) {
  return z.preprocess(emptyToUndefined, z.string().trim().max(max).optional())
}

/** Acepta ISO completo o fecha `YYYY-MM-DD` desde inputs HTML. */
const optionalDateString = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .min(4)
    .max(40)
    .refine((s) => !Number.isNaN(Date.parse(s)), 'Fecha inválida')
    .optional(),
)

const tuitionYearRowSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  paid: z.boolean().optional().default(false),
  paidAt: optionalDateString,
  amountCents: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.number().int().min(0).optional(),
  ),
  notes: z.preprocess(emptyToUndefined, z.string().max(2000).optional()),
})

function parseOptionalEndOfDayDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) throw new Error('INVALID_DATE')
  return d
}

const studentWriteBaseSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  documentId: optionalTrimmedString(40),
  courseId: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.string().uuid().optional(),
  ),
  schoolYearId: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().uuid().optional()),
  contactPhone: optionalTrimmedString(40),
  tutorPhone: optionalTrimmedString(40),
  contactEmail: optionalTrimmedString(200),
  address: optionalTrimmedString(500),
  healthCardExpiresAt: optionalDateString,
  liceoAccessNotes: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.string().max(8000).optional(),
  ),
  enrollmentStatus: enrollmentStatusZ.optional(),
  withdrawnAt: optionalDateString,
  withdrawalAcademicYear: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.number().int().min(1980).max(2100).optional(),
  ),
  internalNotes: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.string().max(8000).optional(),
  ),
})

const studentCreateSchema = studentWriteBaseSchema.extend({
  tuitionYears: z.array(tuitionYearRowSchema).max(80).optional(),
})

const studentUpdateSchema = studentWriteBaseSchema.partial().extend({
  tuitionYears: z.array(tuitionYearRowSchema).max(80).optional(),
})

function serializeTuitionRow(row: {
  id: string
  year: number
  paid: boolean
  paidAt: Date | null
  amountCents: number | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    year: row.year,
    paid: row.paid,
    paidAt: row.paidAt?.toISOString() ?? null,
    amountCents: row.amountCents,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function serializeStudentDetail(row: {
  id: string
  firstName: string
  lastName: string
  documentId: string | null
  schoolYearId: string | null
  courseId: string | null
  course: { id: string; name: string; code: string | null } | null
  contactPhone: string | null
  tutorPhone: string | null
  contactEmail: string | null
  address: string | null
  healthCardExpiresAt: Date | null
  liceoAccessNotes: string | null
  enrollmentStatus: StudentEnrollmentStatus
  withdrawnAt: Date | null
  withdrawalAcademicYear: number | null
  internalNotes: string | null
  createdAt: Date
  updatedAt: Date
  tuitionYears: Array<{
    id: string
    year: number
    paid: boolean
    paidAt: Date | null
    amountCents: number | null
    notes: string | null
    createdAt: Date
    updatedAt: Date
  }>
}) {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    documentId: row.documentId,
    schoolYearId: row.schoolYearId,
    courseId: row.courseId,
    course: row.course,
    contactPhone: row.contactPhone,
    tutorPhone: row.tutorPhone,
    contactEmail: row.contactEmail,
    address: row.address,
    healthCardExpiresAt: row.healthCardExpiresAt?.toISOString() ?? null,
    liceoAccessNotes: row.liceoAccessNotes,
    enrollmentStatus: row.enrollmentStatus,
    withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
    withdrawalAcademicYear: row.withdrawalAcademicYear,
    internalNotes: row.internalNotes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    tuitionYears: [...row.tuitionYears].sort((a, b) => b.year - a.year).map(serializeTuitionRow),
  }
}

/** Resumen para analítica de abandono / matrícula. */
r.get('/summary', async (req, res) => {
  try {
    const parsedCourse = z.preprocess(emptyToUndefined, z.string().uuid().optional()).safeParse(req.query.courseId)
    if (!parsedCourse.success) {
      return res.status(400).json({ message: 'courseId inválido' })
    }
    const courseId = parsedCourse.data
    const scoped = await scopedSchoolYearWhere(req)
    const where: Prisma.StudentWhereInput = { ...scoped }
    if (courseId) where.courseId = courseId

    const [total, grouped] = await Promise.all([
      prisma.student.count({ where }),
      prisma.student.groupBy({
        by: ['enrollmentStatus'],
        where,
        _count: { _all: true },
      }),
    ])
    const byStatus: Record<string, number> = {}
    for (const g of grouped) {
      byStatus[g.enrollmentStatus] = g._count._all
    }
    return res.json({ total, byStatus })
  } catch (e) {
    console.error('[admin/students/summary]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number((req.query.page as string) || 1))
    const pageSize = Math.min(100, Math.max(1, Number((req.query.pageSize as string) || 20)))
    const q = ((req.query.q as string) || '').trim()
    const courseId = ((req.query.courseId as string) || '').trim()
    const status = ((req.query.status as string) || '').trim().toUpperCase()
    const tuitionYear = (req.query.tuitionYear as string) || ''
    const tuitionPaid = (req.query.tuitionPaid as string) || ''

    const scoped = await scopedSchoolYearWhere(req)
    const and: Prisma.StudentWhereInput[] = []
    if (scoped.schoolYearId) and.push({ schoolYearId: scoped.schoolYearId })
    if (q) {
      and.push({
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { documentId: { contains: q, mode: 'insensitive' } },
        ],
      })
    }
    if (courseId) {
      const parsed = z.string().uuid().safeParse(courseId)
      if (parsed.success) and.push({ courseId: parsed.data })
    }
    if (status && ['ACTIVE', 'WITHDRAWN', 'GRADUATED', 'TRANSFERRED'].includes(status)) {
      and.push({ enrollmentStatus: status as StudentEnrollmentStatus })
    }
    const ty = Number(tuitionYear)
    if (!Number.isNaN(ty) && ty >= 1980 && ty <= 2100) {
      if (tuitionPaid === 'true') {
        and.push({ tuitionYears: { some: { year: ty, paid: true } } })
      } else if (tuitionPaid === 'false') {
        and.push({ tuitionYears: { some: { year: ty, paid: false } } })
      } else {
        and.push({ tuitionYears: { some: { year: ty } } })
      }
    }

    const where: Prisma.StudentWhereInput = and.length ? { AND: and } : {}

    const [total, rows] = await Promise.all([
      prisma.student.count({ where }),
      prisma.student.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          documentId: true,
          schoolYearId: true,
          courseId: true,
          course: { select: { id: true, name: true, code: true } },
          enrollmentStatus: true,
          withdrawnAt: true,
          withdrawalAcademicYear: true,
          healthCardExpiresAt: true,
          createdAt: true,
          tuitionYears: {
            select: { year: true, paid: true },
            orderBy: { year: 'desc' },
            take: 6,
          },
        },
      }),
    ])

    const data = rows.map((row) => ({
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      documentId: row.documentId,
      schoolYearId: row.schoolYearId,
      courseId: row.courseId,
      course: row.course,
      enrollmentStatus: row.enrollmentStatus,
      withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
      withdrawalAcademicYear: row.withdrawalAcademicYear,
      healthCardExpiresAt: row.healthCardExpiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      tuitionYearsPreview: row.tuitionYears,
    }))

    return res.json({ total, page, pageSize, data })
  } catch (e) {
    console.error('[admin/students]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.get('/:id', async (req, res) => {
  const id = req.params.id
  try {
    const row = await prisma.student.findUnique({
      where: { id },
      include: {
        course: { select: { id: true, name: true, code: true } },
        tuitionYears: true,
      },
    })
    if (!row) return res.status(404).json({ message: 'Estudiante no encontrado' })
    return res.json(serializeStudentDetail(row))
  } catch (e) {
    console.error('[admin/students/:id]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/', async (req, res) => {
  const parsed = studentCreateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Datos inválidos',
      detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
    })
  }
  const body = parsed.data
  try {
    let resolvedSchoolYearId = body.schoolYearId ?? null
    if (body.courseId) {
      const c = await prisma.course.findUnique({
        where: { id: body.courseId },
        select: { id: true, schoolYearId: true },
      })
      if (!c) return res.status(400).json({ message: 'Curso no encontrado' })
      if (!resolvedSchoolYearId) resolvedSchoolYearId = c.schoolYearId
      else if (c.schoolYearId && resolvedSchoolYearId !== c.schoolYearId) {
        return res.status(400).json({ message: 'El curso pertenece a otro ciclo lectivo que el indicado' })
      }
    }
    if (!resolvedSchoolYearId) {
      resolvedSchoolYearId = await getActiveSchoolYearId(prisma)
    }
    if (!resolvedSchoolYearId) {
      return res.status(400).json({ message: 'No hay ciclo lectivo activo' })
    }

    const health = body.healthCardExpiresAt ? parseOptionalEndOfDayDate(body.healthCardExpiresAt) : undefined
    const withdrawn = body.withdrawnAt ? parseOptionalEndOfDayDate(body.withdrawnAt) : undefined

    const tuitionYears = body.tuitionYears ?? []
    const years = tuitionYears.map((t) => t.year)
    if (new Set(years).size !== years.length) {
      return res.status(400).json({ message: 'Años de cuota duplicados en el mismo estudiante' })
    }

    const created = await prisma.$transaction(async (tx) => {
      const s = await tx.student.create({
        data: {
          firstName: body.firstName,
          lastName: body.lastName,
          documentId: body.documentId ?? null,
          schoolYearId: resolvedSchoolYearId,
          courseId: body.courseId ?? null,
          contactPhone: body.contactPhone ?? null,
          tutorPhone: body.tutorPhone ?? null,
          contactEmail: body.contactEmail ?? null,
          address: body.address ?? null,
          healthCardExpiresAt: health ?? null,
          liceoAccessNotes: body.liceoAccessNotes ?? null,
          enrollmentStatus: (body.enrollmentStatus ?? 'ACTIVE') as StudentEnrollmentStatus,
          withdrawnAt: withdrawn ?? null,
          withdrawalAcademicYear: body.withdrawalAcademicYear ?? null,
          internalNotes: body.internalNotes ?? null,
        },
      })
      if (tuitionYears.length) {
        await tx.studentTuitionYear.createMany({
          data: tuitionYears.map((t) => ({
            studentId: s.id,
            year: t.year,
            paid: t.paid ?? false,
            paidAt: t.paidAt ? parseOptionalEndOfDayDate(t.paidAt) ?? null : null,
            amountCents: t.amountCents ?? null,
            notes: t.notes ?? null,
          })),
        })
      }
      return tx.student.findUniqueOrThrow({
        where: { id: s.id },
        include: { course: { select: { id: true, name: true, code: true } }, tuitionYears: true },
      })
    })

    return res.status(201).json(serializeStudentDetail(created))
  } catch (e: unknown) {
    const code = (e as { code?: string }).code
    if (code === 'P2003') {
      return res.status(400).json({ message: 'Referencia inválida (curso u otro vínculo)' })
    }
    console.error('[admin/students POST]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.put('/:id', async (req, res) => {
  const id = req.params.id
  const parsed = studentUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Datos inválidos',
      detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
    })
  }
  const body = parsed.data
  if (Object.keys(body).length === 0) {
    return res.status(400).json({ message: 'Sin cambios' })
  }
  try {
    const existing = await prisma.student.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return res.status(404).json({ message: 'Estudiante no encontrado' })

    if (body.courseId !== undefined && body.courseId !== null) {
      const c = await prisma.course.findUnique({
        where: { id: body.courseId },
        select: { id: true, schoolYearId: true },
      })
      if (!c) return res.status(400).json({ message: 'Curso no encontrado' })
      if (body.schoolYearId !== undefined) {
        if (c.schoolYearId && body.schoolYearId && body.schoolYearId !== c.schoolYearId) {
          return res.status(400).json({ message: 'Curso y ciclo lectivo no coinciden' })
        }
      }
    }

    const tuitionYears = body.tuitionYears
    if (tuitionYears) {
      const years = tuitionYears.map((t) => t.year)
      if (new Set(years).size !== years.length) {
        return res.status(400).json({ message: 'Años de cuota duplicados en el mismo estudiante' })
      }
    }

    const data: Prisma.StudentUncheckedUpdateInput = {}
    if (body.firstName !== undefined) data.firstName = body.firstName
    if (body.lastName !== undefined) data.lastName = body.lastName
    if (body.documentId !== undefined) data.documentId = body.documentId ?? null
    if (body.courseId !== undefined) data.courseId = body.courseId ?? null
    if (body.schoolYearId !== undefined) {
      data.schoolYearId = body.schoolYearId ?? null
    }
    if (body.courseId !== undefined && body.courseId !== null && body.schoolYearId === undefined) {
      const c = await prisma.course.findUnique({
        where: { id: body.courseId },
        select: { schoolYearId: true },
      })
      if (c?.schoolYearId) data.schoolYearId = c.schoolYearId
    }
    if (body.contactPhone !== undefined) data.contactPhone = body.contactPhone ?? null
    if (body.tutorPhone !== undefined) data.tutorPhone = body.tutorPhone ?? null
    if (body.contactEmail !== undefined) data.contactEmail = body.contactEmail ?? null
    if (body.address !== undefined) data.address = body.address ?? null
    if (body.healthCardExpiresAt !== undefined) {
      data.healthCardExpiresAt = body.healthCardExpiresAt
        ? parseOptionalEndOfDayDate(body.healthCardExpiresAt)
        : null
    }
    if (body.liceoAccessNotes !== undefined) data.liceoAccessNotes = body.liceoAccessNotes ?? null
    if (body.enrollmentStatus !== undefined) data.enrollmentStatus = body.enrollmentStatus
    if (body.withdrawnAt !== undefined) {
      data.withdrawnAt = body.withdrawnAt ? parseOptionalEndOfDayDate(body.withdrawnAt) : null
    }
    if (body.withdrawalAcademicYear !== undefined) data.withdrawalAcademicYear = body.withdrawalAcademicYear ?? null
    if (body.internalNotes !== undefined) data.internalNotes = body.internalNotes ?? null

    const updated = await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        await tx.student.update({ where: { id }, data })
      }
      if (tuitionYears) {
        await tx.studentTuitionYear.deleteMany({ where: { studentId: id } })
        if (tuitionYears.length) {
          await tx.studentTuitionYear.createMany({
            data: tuitionYears.map((t) => ({
              studentId: id,
              year: t.year,
              paid: t.paid ?? false,
              paidAt: t.paidAt ? parseOptionalEndOfDayDate(t.paidAt) ?? null : null,
              amountCents: t.amountCents ?? null,
              notes: t.notes ?? null,
            })),
          })
        }
      }
      return tx.student.findUniqueOrThrow({
        where: { id },
        include: { course: { select: { id: true, name: true, code: true } }, tuitionYears: true },
      })
    })

    return res.json(serializeStudentDetail(updated))
  } catch (e: unknown) {
    const code = (e as { code?: string }).code
    if (code === 'P2003') {
      return res.status(400).json({ message: 'Referencia inválida (curso u otro vínculo)' })
    }
    console.error('[admin/students PUT]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.delete('/:id', async (req, res) => {
  const id = req.params.id
  try {
    await prisma.student.delete({ where: { id } })
    return res.json({ ok: true })
  } catch (e: unknown) {
    const code = (e as { code?: string }).code
    if (code === 'P2025') return res.status(404).json({ message: 'Estudiante no encontrado' })
    console.error('[admin/students DELETE]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
