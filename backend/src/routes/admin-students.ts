import { Router } from 'express'
import type { Request } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Prisma, StudentEnrollmentStatus } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { ensureCourseOffering, getActiveSchoolYearId, resolveSchoolYearIdForList } from '../services/school-year-service.js'

const r = Router()

async function scopedSchoolYearWhere(req: Request): Promise<Prisma.StudentWhereInput> {
  const allYears = req.query.allYears === '1'
  if (allYears) return {}
  const id = await resolveSchoolYearIdForList(prisma, {
    role: req.user?.role,
    requestedSchoolYearId: typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : undefined,
  })
  if (!id) return {}
  return { enrollments: { some: { schoolYearId: id } } }
}

async function scopedSchoolYearId(req: Request): Promise<string | null> {
  if (req.query.allYears === '1') return null
  return resolveSchoolYearIdForList(prisma, {
    role: req.user?.role,
    requestedSchoolYearId: typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : undefined,
  })
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

const tuitionMonthRowSchema = tuitionYearRowSchema.extend({
  month: z.number().int().min(1).max(12),
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
  tuitionMonths: z.array(tuitionMonthRowSchema).max(240).optional(),
})

const studentUpdateSchema = studentWriteBaseSchema.partial().extend({
  tuitionYears: z.array(tuitionYearRowSchema).max(80).optional(),
  tuitionMonths: z.array(tuitionMonthRowSchema).max(240).optional(),
})

type TuitionMonthDbRow = {
  id: string
  year: number
  month: number
  paid: boolean
  paidAt: Date | null
  amountCents: number | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

async function findTuitionMonths(studentIds: string[], year?: number): Promise<Record<string, TuitionMonthDbRow[]>> {
  if (!studentIds.length) return {}
  const rows = year
    ? await prisma.$queryRaw<Array<TuitionMonthDbRow & { studentId: string }>>`
        SELECT id, "studentId", year, month, paid, "paidAt", "amountCents", notes, "createdAt", "updatedAt"
        FROM "StudentTuitionMonth"
        WHERE "studentId" IN (${Prisma.join(studentIds)}) AND year = ${year}
        ORDER BY year DESC, month ASC
      `
    : await prisma.$queryRaw<Array<TuitionMonthDbRow & { studentId: string }>>`
        SELECT id, "studentId", year, month, paid, "paidAt", "amountCents", notes, "createdAt", "updatedAt"
        FROM "StudentTuitionMonth"
        WHERE "studentId" IN (${Prisma.join(studentIds)})
        ORDER BY year DESC, month ASC
      `
  const byStudent: Record<string, TuitionMonthDbRow[]> = {}
  for (const row of rows) {
    byStudent[row.studentId] = byStudent[row.studentId] ?? []
    byStudent[row.studentId].push(row)
  }
  return byStudent
}

async function findStudentIdsByTuitionMonth(year: number, month?: number, paid?: boolean): Promise<string[]> {
  if (month && paid === true) {
    const rows = await prisma.$queryRaw<Array<{ studentId: string }>>`
      SELECT "studentId" FROM "StudentTuitionMonth"
      WHERE year = ${year} AND month = ${month} AND paid = true
    `
    return rows.map((r) => r.studentId)
  }
  if (month && paid === false) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT s.id
      FROM "Student" s
      LEFT JOIN "StudentTuitionMonth" tm
        ON tm."studentId" = s.id AND tm.year = ${year} AND tm.month = ${month} AND tm.paid = true
      WHERE tm.id IS NULL
    `
    return rows.map((r) => r.id)
  }
  const rows = month
    ? await prisma.$queryRaw<Array<{ studentId: string }>>`
        SELECT "studentId" FROM "StudentTuitionMonth"
        WHERE year = ${year} AND month = ${month}
      `
    : await prisma.$queryRaw<Array<{ studentId: string }>>`
        SELECT "studentId" FROM "StudentTuitionMonth"
        WHERE year = ${year}
      `
  return rows.map((r) => r.studentId)
}

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

function serializeTuitionMonthRow(row: {
  id: string
  year: number
  month: number
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
    month: row.month,
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
  courseOfferingId?: string | null
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
  tuitionMonths: Array<{
    id: string
    year: number
    month: number
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
    courseOfferingId: row.courseOfferingId ?? null,
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
    tuitionMonths: [...row.tuitionMonths]
      .sort((a, b) => (b.year === a.year ? a.month - b.month : b.year - a.year))
      .map(serializeTuitionMonthRow),
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
    const schoolYearId = await scopedSchoolYearId(req)
    const where: any = {}
    const enrollmentWhere: any = {}
    if (schoolYearId) enrollmentWhere.schoolYearId = schoolYearId
    if (courseId) enrollmentWhere.courseOffering = { courseId }
    if (Object.keys(enrollmentWhere).length) where.enrollments = { some: enrollmentWhere }

    const [total, grouped] = await Promise.all([
      prisma.student.count({ where }),
      (prisma as any).studentEnrollment.groupBy({
        by: ['enrollmentStatus'],
        where: enrollmentWhere,
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
    const tuitionPreviewYear = (req.query.tuitionPreviewYear as string) || ''
    const tuitionMonth = (req.query.tuitionMonth as string) || ''
    const tuitionPaid = (req.query.tuitionPaid as string) || ''

    const allYears = req.query.allYears === '1'
    const schoolYearId = await scopedSchoolYearId(req)
    const and: any[] = []
    const enrollmentWhere: any = {}
    const studentWhereForEnrollment: any = {}
    if (q) {
      const qWhere = {
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { documentId: { contains: q, mode: 'insensitive' } },
        ],
      }
      and.push(qWhere)
      studentWhereForEnrollment.AND = [...(studentWhereForEnrollment.AND ?? []), qWhere]
    }
    if (courseId) {
      const parsed = z.string().uuid().safeParse(courseId)
      if (parsed.success) enrollmentWhere.courseOffering = { courseId: parsed.data }
    }
    if (status && ['ACTIVE', 'WITHDRAWN', 'GRADUATED', 'TRANSFERRED'].includes(status)) {
      enrollmentWhere.enrollmentStatus = status as StudentEnrollmentStatus
    }
    if (schoolYearId) {
      enrollmentWhere.schoolYearId = schoolYearId
    }
    if (Object.keys(enrollmentWhere).length) {
      and.push({ enrollments: { some: enrollmentWhere } })
    }
    const previewTy = Number(tuitionPreviewYear)
    const ty = Number(tuitionYear)
    const previewYear = !Number.isNaN(previewTy) && previewTy >= 1980 && previewTy <= 2100
      ? previewTy
      : !Number.isNaN(ty) && ty >= 1980 && ty <= 2100
        ? ty
        : undefined
    let tuitionStudentIds: string[] | null = null
    if (!Number.isNaN(ty) && ty >= 1980 && ty <= 2100) {
      const tm = Number(tuitionMonth)
      if (!Number.isNaN(tm) && tm >= 1 && tm <= 12) {
        if (tuitionPaid === 'true') {
          tuitionStudentIds = await findStudentIdsByTuitionMonth(ty, tm, true)
        } else if (tuitionPaid === 'false') {
          tuitionStudentIds = await findStudentIdsByTuitionMonth(ty, tm, false)
        } else {
          tuitionStudentIds = await findStudentIdsByTuitionMonth(ty, tm)
        }
      } else {
        tuitionStudentIds = await findStudentIdsByTuitionMonth(ty)
      }
      and.push({ id: { in: tuitionStudentIds } })
      studentWhereForEnrollment.AND = [
        ...(studentWhereForEnrollment.AND ?? []),
        { id: { in: tuitionStudentIds } },
      ]
    }

    const where: any = and.length ? { AND: and } : {}

    if (allYears) {
      const enrollmentListWhere: any = { ...enrollmentWhere }
      if (Object.keys(studentWhereForEnrollment).length) enrollmentListWhere.student = studentWhereForEnrollment
      const [total, enrollmentRows] = await Promise.all([
        (prisma as any).studentEnrollment.count({ where: enrollmentListWhere }),
        (prisma as any).studentEnrollment.findMany({
          where: enrollmentListWhere,
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            schoolYear: { select: { id: true, code: true, label: true, status: true } },
            student: true,
            courseOffering: { include: { course: { select: { id: true, name: true, code: true } } } },
          },
          orderBy: [
            { schoolYear: { code: 'desc' } },
            { student: { lastName: 'asc' } },
            { student: { firstName: 'asc' } },
          ],
        }),
      ])
      const rowsAny = enrollmentRows as any[]
      const tuitionMonthsByStudent = await findTuitionMonths(
        rowsAny.map((row) => row.studentId),
        previewYear,
      )
      const data = rowsAny.map((enrollment) => {
        const row = enrollment.student
        const courseOffering = enrollment.courseOffering ?? null
        return {
          id: `${row.id}:${enrollment.id}`,
          studentId: row.id,
          enrollmentId: enrollment.id,
          firstName: row.firstName,
          lastName: row.lastName,
          documentId: row.documentId,
          schoolYearId: enrollment.schoolYearId,
          schoolYearCode: enrollment.schoolYear?.code ?? null,
          courseId: courseOffering?.courseId ?? null,
          courseOfferingId: courseOffering?.id ?? null,
          course: courseOffering?.course ?? null,
          enrollmentStatus: enrollment.enrollmentStatus ?? 'ACTIVE',
          withdrawnAt: enrollment.withdrawnAt?.toISOString() ?? null,
          withdrawalAcademicYear: enrollment.withdrawalAcademicYear ?? null,
          healthCardExpiresAt: row.healthCardExpiresAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          tuitionMonthsPreview: (tuitionMonthsByStudent[row.id] ?? []).map((t) => ({
            year: t.year,
            month: t.month,
            paid: t.paid,
          })),
        }
      })
      return res.json({ total, page, pageSize, data })
    }

    const [total, rows] = await Promise.all([
      prisma.student.count({ where }),
      prisma.student.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        include: {
          enrollments: {
            where: schoolYearId ? { schoolYearId } : {},
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { courseOffering: { include: { course: { select: { id: true, name: true, code: true } } } } },
          },
        } as any,
      }),
    ])

    const rowsAny = rows as any[]
    const tuitionMonthsByStudent = await findTuitionMonths(
      rowsAny.map((row) => row.id),
      previewYear,
    )

    const data = rowsAny.map((row) => {
      const enrollment = row.enrollments?.[0] ?? null
      const courseOffering = enrollment?.courseOffering ?? null
      return {
          id: row.id,
          firstName: row.firstName,
          lastName: row.lastName,
          documentId: row.documentId,
          schoolYearId: enrollment?.schoolYearId ?? null,
          courseId: courseOffering?.courseId ?? null,
          courseOfferingId: courseOffering?.id ?? null,
          course: courseOffering?.course ?? null,
          enrollmentStatus: enrollment?.enrollmentStatus ?? 'ACTIVE',
          withdrawnAt: enrollment?.withdrawnAt?.toISOString() ?? null,
          withdrawalAcademicYear: enrollment?.withdrawalAcademicYear ?? null,
          healthCardExpiresAt: row.healthCardExpiresAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          tuitionMonthsPreview: (tuitionMonthsByStudent[row.id] ?? []).map((t) => ({
            year: t.year,
            month: t.month,
            paid: t.paid,
          })),
        }
      })

    return res.json({ total, page, pageSize, data })
  } catch (e) {
    console.error('[admin/students]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.get('/:id', async (req, res) => {
  const id = req.params.id
  try {
    const schoolYearId = await scopedSchoolYearId(req)
    const row = await (prisma.student as any).findUnique({
      where: { id },
      include: {
        enrollments: {
          where: schoolYearId ? { schoolYearId } : {},
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { courseOffering: { include: { course: { select: { id: true, name: true, code: true } } } } },
        },
        tuitionYears: true,
      },
    })
    if (!row) return res.status(404).json({ message: 'Estudiante no encontrado' })
    const rowAny = row as any
    const enrollment = rowAny.enrollments?.[0] ?? null
    const courseOffering = enrollment?.courseOffering ?? null
    const tuitionMonths = (await findTuitionMonths([row.id]))[row.id] ?? []
    return res.json(serializeStudentDetail({
      ...rowAny,
      schoolYearId: enrollment?.schoolYearId ?? null,
      courseId: courseOffering?.courseId ?? null,
      courseOfferingId: courseOffering?.id ?? null,
      course: courseOffering?.course ?? null,
      enrollmentStatus: enrollment?.enrollmentStatus ?? 'ACTIVE',
      withdrawnAt: enrollment?.withdrawnAt ?? null,
      withdrawalAcademicYear: enrollment?.withdrawalAcademicYear ?? null,
      tuitionMonths,
    }))
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
    let resolvedCourseOfferingId: string | null = null
    if (body.courseId) {
      const c = await prisma.course.findUnique({
        where: { id: body.courseId },
        select: { id: true },
      })
      if (!c) return res.status(400).json({ message: 'Curso no encontrado' })
    }
    if (!resolvedSchoolYearId) {
      resolvedSchoolYearId = await getActiveSchoolYearId(prisma)
    }
    if (!resolvedSchoolYearId) {
      return res.status(400).json({ message: 'No hay ciclo lectivo activo' })
    }
    if (body.courseId) {
      const offering = await ensureCourseOffering(prisma, body.courseId, resolvedSchoolYearId)
      resolvedCourseOfferingId = offering.id
    }

    const health = body.healthCardExpiresAt ? parseOptionalEndOfDayDate(body.healthCardExpiresAt) : undefined
    const withdrawn = body.withdrawnAt ? parseOptionalEndOfDayDate(body.withdrawnAt) : undefined

    const tuitionYears = body.tuitionYears ?? []
    const years = tuitionYears.map((t) => t.year)
    if (new Set(years).size !== years.length) {
      return res.status(400).json({ message: 'Años de cuota duplicados en el mismo estudiante' })
    }
    const tuitionMonths = body.tuitionMonths ?? []
    const monthKeys = tuitionMonths.map((t) => `${t.year}-${t.month}`)
    if (new Set(monthKeys).size !== monthKeys.length) {
      return res.status(400).json({ message: 'Meses de mensualidad duplicados en el mismo estudiante' })
    }

    const created = await prisma.$transaction(async (tx) => {
      const s = await tx.student.create({
        data: {
          firstName: body.firstName,
          lastName: body.lastName,
          documentId: body.documentId ?? null,
          contactPhone: body.contactPhone ?? null,
          tutorPhone: body.tutorPhone ?? null,
          contactEmail: body.contactEmail ?? null,
          address: body.address ?? null,
          healthCardExpiresAt: health ?? null,
          liceoAccessNotes: body.liceoAccessNotes ?? null,
          internalNotes: body.internalNotes ?? null,
        } as any,
      })
      if (body.courseId && resolvedCourseOfferingId) {
        await (tx as any).studentEnrollment.create({
          data: {
          studentId: s.id,
          schoolYearId: resolvedSchoolYearId,
          courseOfferingId: resolvedCourseOfferingId,
          enrollmentStatus: (body.enrollmentStatus ?? 'ACTIVE') as StudentEnrollmentStatus,
          withdrawnAt: withdrawn ?? null,
          withdrawalAcademicYear: body.withdrawalAcademicYear ?? null,
          notes: body.internalNotes ?? null,
          },
        })
      }
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
      if (tuitionMonths.length) {
        for (const t of tuitionMonths) {
          await tx.$executeRaw`
            INSERT INTO "StudentTuitionMonth" ("id", "studentId", year, month, paid, "paidAt", "amountCents", notes, "createdAt", "updatedAt")
            VALUES (
              ${randomUUID()},
              ${s.id},
              ${t.year},
              ${t.month},
              ${t.paid ?? false},
              ${t.paidAt ? parseOptionalEndOfDayDate(t.paidAt) ?? null : null},
              ${t.amountCents ?? null},
              ${t.notes ?? null},
              now(),
              now()
            )
          `
        }
      }
      return tx.student.findUniqueOrThrow({
        where: { id: s.id },
        include: {
          enrollments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { courseOffering: { include: { course: { select: { id: true, name: true, code: true } } } } },
          },
          tuitionYears: true,
        } as any,
      })
    })

    const createdAny = created as any
    const enrollment = createdAny.enrollments?.[0] ?? null
    const courseOffering = enrollment?.courseOffering ?? null
    const createdTuitionMonths = (await findTuitionMonths([created.id]))[created.id] ?? []
    return res.status(201).json(serializeStudentDetail({
      ...createdAny,
      schoolYearId: enrollment?.schoolYearId ?? resolvedSchoolYearId,
      courseId: courseOffering?.courseId ?? null,
      courseOfferingId: courseOffering?.id ?? null,
      course: courseOffering?.course ?? null,
      enrollmentStatus: enrollment?.enrollmentStatus ?? (body.enrollmentStatus ?? 'ACTIVE'),
      withdrawnAt: enrollment?.withdrawnAt ?? withdrawn ?? null,
      withdrawalAcademicYear: enrollment?.withdrawalAcademicYear ?? body.withdrawalAcademicYear ?? null,
      tuitionMonths: createdTuitionMonths,
    }))
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
    const existing = await (prisma.student as any).findUnique({ where: { id }, select: { id: true } })
    if (!existing) return res.status(404).json({ message: 'Estudiante no encontrado' })

    let nextCourseOfferingId: string | null | undefined = undefined
    if (body.courseId !== undefined && body.courseId !== null) {
      const c = await prisma.course.findUnique({
        where: { id: body.courseId },
        select: { id: true },
      })
      if (!c) return res.status(400).json({ message: 'Curso no encontrado' })
    }

    const tuitionYears = body.tuitionYears
    if (tuitionYears) {
      const years = tuitionYears.map((t) => t.year)
      if (new Set(years).size !== years.length) {
        return res.status(400).json({ message: 'Años de cuota duplicados en el mismo estudiante' })
      }
    }
    const tuitionMonths = body.tuitionMonths
    if (tuitionMonths) {
      const monthKeys = tuitionMonths.map((t) => `${t.year}-${t.month}`)
      if (new Set(monthKeys).size !== monthKeys.length) {
        return res.status(400).json({ message: 'Meses de mensualidad duplicados en el mismo estudiante' })
      }
    }

    const data: any = {}
    if (body.firstName !== undefined) data.firstName = body.firstName
    if (body.lastName !== undefined) data.lastName = body.lastName
    if (body.documentId !== undefined) data.documentId = body.documentId ?? null
    const targetSchoolYearId =
      body.schoolYearId ??
      (await getActiveSchoolYearId(prisma))
    if (body.courseId !== undefined) {
      if (body.courseId && targetSchoolYearId) {
        const offering = await ensureCourseOffering(prisma, body.courseId, targetSchoolYearId)
        nextCourseOfferingId = offering.id
      } else {
        nextCourseOfferingId = null
      }
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
    if (body.internalNotes !== undefined) data.internalNotes = body.internalNotes ?? null

    const updated = await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        await tx.student.update({ where: { id }, data })
      }
      const currentEnrollment = targetSchoolYearId
        ? await (tx as any).studentEnrollment.findUnique({
            where: { studentId_schoolYearId: { studentId: id, schoolYearId: targetSchoolYearId } },
          })
        : null
      const finalCourseOfferingId =
        nextCourseOfferingId !== undefined ? nextCourseOfferingId : currentEnrollment?.courseOfferingId
      if (targetSchoolYearId && finalCourseOfferingId) {
        await (tx as any).studentEnrollment.upsert({
          where: { studentId_schoolYearId: { studentId: id, schoolYearId: targetSchoolYearId } },
          update: {
            courseOfferingId: finalCourseOfferingId,
            ...(body.enrollmentStatus !== undefined ? { enrollmentStatus: body.enrollmentStatus } : {}),
            ...(body.withdrawnAt !== undefined ? { withdrawnAt: body.withdrawnAt ? parseOptionalEndOfDayDate(body.withdrawnAt) : null } : {}),
            ...(body.withdrawalAcademicYear !== undefined ? { withdrawalAcademicYear: body.withdrawalAcademicYear ?? null } : {}),
            ...(body.internalNotes !== undefined ? { notes: body.internalNotes ?? null } : {}),
          },
          create: {
            studentId: id,
            schoolYearId: targetSchoolYearId,
            courseOfferingId: finalCourseOfferingId,
            enrollmentStatus: (body.enrollmentStatus ?? 'ACTIVE') as StudentEnrollmentStatus,
            withdrawnAt: body.withdrawnAt ? parseOptionalEndOfDayDate(body.withdrawnAt) : null,
            withdrawalAcademicYear: body.withdrawalAcademicYear ?? null,
            notes: body.internalNotes ?? null,
          },
        })
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
      if (tuitionMonths) {
        await tx.$executeRaw`DELETE FROM "StudentTuitionMonth" WHERE "studentId" = ${id}`
        if (tuitionMonths.length) {
          for (const t of tuitionMonths) {
            await tx.$executeRaw`
              INSERT INTO "StudentTuitionMonth" ("id", "studentId", year, month, paid, "paidAt", "amountCents", notes, "createdAt", "updatedAt")
              VALUES (
                ${randomUUID()},
                ${id},
                ${t.year},
                ${t.month},
                ${t.paid ?? false},
                ${t.paidAt ? parseOptionalEndOfDayDate(t.paidAt) ?? null : null},
                ${t.amountCents ?? null},
                ${t.notes ?? null},
                now(),
                now()
              )
            `
          }
        }
      }
      return tx.student.findUniqueOrThrow({
        where: { id },
        include: {
          enrollments: {
            where: targetSchoolYearId ? { schoolYearId: targetSchoolYearId } : {},
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { courseOffering: { include: { course: { select: { id: true, name: true, code: true } } } } },
          },
          tuitionYears: true,
        } as any,
      })
    })

    const updatedAny = updated as any
    const enrollment = updatedAny.enrollments?.[0] ?? null
    const courseOffering = enrollment?.courseOffering ?? null
    const updatedTuitionMonths = (await findTuitionMonths([updated.id]))[updated.id] ?? []
    return res.json(serializeStudentDetail({
      ...updatedAny,
      schoolYearId: enrollment?.schoolYearId ?? targetSchoolYearId ?? null,
      courseId: courseOffering?.courseId ?? null,
      courseOfferingId: courseOffering?.id ?? null,
      course: courseOffering?.course ?? null,
      enrollmentStatus: enrollment?.enrollmentStatus ?? body.enrollmentStatus ?? 'ACTIVE',
      withdrawnAt: enrollment?.withdrawnAt ?? (body.withdrawnAt ? parseOptionalEndOfDayDate(body.withdrawnAt) : null),
      withdrawalAcademicYear: enrollment?.withdrawalAcademicYear ?? body.withdrawalAcademicYear ?? null,
      tuitionMonths: updatedTuitionMonths,
    }))
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
