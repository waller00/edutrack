import { Router } from 'express'
import type { Request } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Prisma, StudentEnrollmentStatus } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { assertCourseOfferedInSchoolYear, getActiveSchoolYearId, resolveSchoolYearIdForList } from '../services/school-year-service.js'
import { generateUniqueUsername } from '../services/usernames.js'
import { enqueueStudentUserUpsert } from '../integrations/moodle/outbox.js'
import { isValidUruguayanCI, onlyDigits } from '../identity/uruguay-ci.js'

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

/** Cédula uruguaya opcional: si viene, se valida el dígito verificador y se guarda normalizada (solo dígitos). */
const optionalUruguayanCI = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .max(40)
    .transform((v) => onlyDigits(v))
    .refine((v) => isValidUruguayanCI(v), 'Cédula inválida: verificá el número y el dígito verificador')
    .optional(),
)

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

/**
 * Un email no puede estar repetido entre estudiantes ni coincidir con el de un usuario del sistema:
 * Moodle exige email único por cuenta, así que un duplicado rompe la sincronización (no crea la cuenta).
 * Devuelve un mensaje de conflicto o null si está libre.
 */
async function findEmailConflict(email: string, excludeStudentId?: string): Promise<string | null> {
  const otherStudent = await prisma.student.findFirst({
    where: {
      email: { equals: email, mode: 'insensitive' },
      ...(excludeStudentId ? { NOT: { id: excludeStudentId } } : {}),
    },
    select: { id: true },
  })
  if (otherStudent) return 'Ese email ya está en uso por otro estudiante'
  const otherUser = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  })
  if (otherUser) return 'Ese email ya está en uso por un usuario del sistema'
  return null
}

const studentWriteBaseSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  documentId: optionalUruguayanCI,
  courseId: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.string().uuid().optional(),
  ),
  schoolYearId: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().uuid().optional()),
  contactPhone: optionalTrimmedString(40),
  tutorPhone: optionalTrimmedString(40),
  username: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(30)
      .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'Usuario inválido (use letras, números, puntos o guiones)')
      .optional(),
  ),
  email: z.preprocess(emptyToUndefined, z.string().trim().toLowerCase().email('Email inválido').max(200).optional()),
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
  schoolYearId: string | null
  year: number
  month: number
  paid: boolean
  paidAt: Date | null
  amountCents: number | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

async function schoolYearIdsByCode(years: number[]): Promise<Map<number, string>> {
  const uniqueYears = [...new Set(years)]
  if (!uniqueYears.length) return new Map()
  const rows = await prisma.schoolYear.findMany({
    where: { code: { in: uniqueYears } },
    select: { id: true, code: true },
  })
  return new Map(rows.map((row) => [row.code, row.id]))
}

async function findTuitionMonths(studentIds: string[], year?: number): Promise<Record<string, TuitionMonthDbRow[]>> {
  if (!studentIds.length) return {}
  const rows = year
    ? await prisma.$queryRaw<Array<TuitionMonthDbRow & { studentId: string }>>`
        SELECT id, "studentId", "schoolYearId", year, month, paid, "paidAt", "amountCents", notes, "createdAt", "updatedAt"
        FROM "StudentTuitionMonth"
        WHERE "studentId" IN (${Prisma.join(studentIds)}) AND year = ${year}
        ORDER BY year DESC, month ASC
      `
    : await prisma.$queryRaw<Array<TuitionMonthDbRow & { studentId: string }>>`
        SELECT id, "studentId", "schoolYearId", year, month, paid, "paidAt", "amountCents", notes, "createdAt", "updatedAt"
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
  schoolYearId?: string | null
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
    schoolYearId: row.schoolYearId ?? null,
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
  schoolYearId?: string | null
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
    schoolYearId: row.schoolYearId ?? null,
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
  username: string | null
  email: string | null
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
    schoolYearId?: string | null
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
    schoolYearId?: string | null
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
    username: row.username,
    email: row.email,
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

      // Estudiantes SIN matricula: se incluyen para que la lista coincida con el
      // contador (summary cuenta Student) y no se "esconda" a un alumno recien
      // creado sin curso. Solo si no hay filtros que dependan de la matricula
      // (curso/estado/ciclo) — un alumno sin matricula no puede satisfacerlos.
      const enrollmentFilterActive = Object.keys(enrollmentWhere).length > 0
      const orphanWhere: any = { enrollments: { none: {} } }
      if (Object.keys(studentWhereForEnrollment).length) Object.assign(orphanWhere, studentWhereForEnrollment)

      const skip = (page - 1) * pageSize
      const [enrollmentTotal, orphanTotal] = await Promise.all([
        (prisma as any).studentEnrollment.count({ where: enrollmentListWhere }),
        enrollmentFilterActive ? Promise.resolve(0) : prisma.student.count({ where: orphanWhere }),
      ])
      const total = enrollmentTotal + orphanTotal

      // Paginacion combinada: primero las matriculas (ordenadas por ciclo/nombre),
      // despues los huerfanos (por nombre). Tomamos solo la franja de la pagina.
      let enrollmentRows: any[] = []
      let orphanRows: any[] = []
      if (skip < enrollmentTotal) {
        enrollmentRows = await (prisma as any).studentEnrollment.findMany({
          where: enrollmentListWhere,
          skip,
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
        })
        const remaining = pageSize - enrollmentRows.length
        if (remaining > 0 && !enrollmentFilterActive) {
          orphanRows = await prisma.student.findMany({
            where: orphanWhere,
            take: remaining,
            orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          })
        }
      } else if (!enrollmentFilterActive) {
        orphanRows = await prisma.student.findMany({
          where: orphanWhere,
          skip: skip - enrollmentTotal,
          take: pageSize,
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        })
      }

      const tuitionMonthsByStudent = await findTuitionMonths(
        [...enrollmentRows.map((row) => row.studentId), ...orphanRows.map((row) => row.id)],
        previewYear,
      )
      const enrollmentData = enrollmentRows.map((enrollment) => {
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
      const orphanData = (orphanRows as any[]).map((row) => ({
        id: `${row.id}:`,
        studentId: row.id,
        enrollmentId: undefined,
        firstName: row.firstName,
        lastName: row.lastName,
        documentId: row.documentId,
        schoolYearId: null,
        schoolYearCode: null,
        courseId: null,
        courseOfferingId: null,
        course: null,
        enrollmentStatus: '',
        withdrawnAt: null,
        withdrawalAcademicYear: null,
        healthCardExpiresAt: row.healthCardExpiresAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        tuitionMonthsPreview: (tuitionMonthsByStudent[row.id] ?? []).map((t) => ({
          year: t.year,
          month: t.month,
          paid: t.paid,
        })),
      }))
      return res.json({ total, page, pageSize, data: [...enrollmentData, ...orphanData] })
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
    if (body.email) {
      const conflict = await findEmailConflict(body.email)
      if (conflict) return res.status(409).json({ message: conflict })
    }
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
      const offering = await assertCourseOfferedInSchoolYear(prisma, body.courseId, resolvedSchoolYearId)
      if (!offering) {
        return res.status(400).json({ message: 'El curso no está ofertado en este ciclo lectivo' })
      }
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
    const tuitionSchoolYears = await schoolYearIdsByCode([
      ...tuitionYears.map((t) => t.year),
      ...tuitionMonths.map((t) => t.year),
    ])
    const missingTuitionYears = [
      ...new Set([...tuitionYears.map((t) => t.year), ...tuitionMonths.map((t) => t.year)]),
    ].filter((year) => !tuitionSchoolYears.has(year))
    if (missingTuitionYears.length) {
      return res.status(400).json({ message: `No existe ciclo lectivo para cuota: ${missingTuitionYears.join(', ')}` })
    }

    const created = await prisma.$transaction(async (tx) => {
      const username =
        body.username ??
        (await generateUniqueUsername(body.firstName, body.lastName, async (candidate) => {
          const exist = await (tx.student as any).findUnique({ where: { username: candidate }, select: { id: true } })
          return Boolean(exist)
        }))
      const s = await tx.student.create({
        data: {
          firstName: body.firstName,
          lastName: body.lastName,
          documentId: body.documentId ?? null,
          username,
          contactPhone: body.contactPhone ?? null,
          tutorPhone: body.tutorPhone ?? null,
          email: body.email ?? null,
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
        await (tx as any).studentTuitionYear.createMany({
          data: tuitionYears.map((t) => ({
            studentId: s.id,
            schoolYearId: tuitionSchoolYears.get(t.year) ?? null,
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
            INSERT INTO "StudentTuitionMonth" ("id", "studentId", "schoolYearId", year, month, paid, "paidAt", "amountCents", notes, "createdAt", "updatedAt")
            VALUES (
              ${randomUUID()},
              ${s.id},
              ${tuitionSchoolYears.get(t.year) ?? null},
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
    if (createdAny.email) void enqueueStudentUserUpsert(created.id)
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
    if (code === 'P2002') {
      return res.status(409).json({ message: 'Ese nombre de usuario ya está en uso' })
    }
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
    const existing = await (prisma.student as any).findUnique({
      where: { id },
      select: { id: true, firstName: true, lastName: true, username: true, email: true },
    })
    if (!existing) return res.status(404).json({ message: 'Estudiante no encontrado' })

    if (body.email) {
      const conflict = await findEmailConflict(body.email, id)
      if (conflict) return res.status(409).json({ message: conflict })
    }

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
    const tuitionSchoolYears = await schoolYearIdsByCode([
      ...(tuitionYears?.map((t) => t.year) ?? []),
      ...(tuitionMonths?.map((t) => t.year) ?? []),
    ])
    const missingTuitionYears = [
      ...new Set([...(tuitionYears?.map((t) => t.year) ?? []), ...(tuitionMonths?.map((t) => t.year) ?? [])]),
    ].filter((year) => !tuitionSchoolYears.has(year))
    if (missingTuitionYears.length) {
      return res.status(400).json({ message: `No existe ciclo lectivo para cuota: ${missingTuitionYears.join(', ')}` })
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
        const offering = await assertCourseOfferedInSchoolYear(prisma, body.courseId, targetSchoolYearId)
        if (!offering) {
          return res.status(400).json({ message: 'El curso no está ofertado en este ciclo lectivo' })
        }
        nextCourseOfferingId = offering.id
      } else {
        nextCourseOfferingId = null
      }
    }
    if (body.contactPhone !== undefined) data.contactPhone = body.contactPhone ?? null
    if (body.tutorPhone !== undefined) data.tutorPhone = body.tutorPhone ?? null
    if (body.username !== undefined) data.username = body.username ?? null
    if (body.email !== undefined) data.email = body.email ?? null
    // Alta tardía: si el alumno gana email y aún no tiene username, generarlo para
    // habilitar su cuenta Moodle sin que el admin tenga que inventarlo.
    const finalEmail = body.email !== undefined ? body.email ?? null : existing.email
    if (finalEmail && !existing.username && body.username === undefined) {
      data.username = await generateUniqueUsername(
        body.firstName ?? existing.firstName,
        body.lastName ?? existing.lastName,
        async (candidate) => {
          const exist = await (prisma.student as any).findUnique({ where: { username: candidate }, select: { id: true } })
          return Boolean(exist)
        },
      )
    }
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
          await (tx as any).studentTuitionYear.createMany({
            data: tuitionYears.map((t) => ({
              studentId: id,
              schoolYearId: tuitionSchoolYears.get(t.year) ?? null,
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
              INSERT INTO "StudentTuitionMonth" ("id", "studentId", "schoolYearId", year, month, paid, "paidAt", "amountCents", notes, "createdAt", "updatedAt")
              VALUES (
                ${randomUUID()},
                ${id},
                ${tuitionSchoolYears.get(t.year) ?? null},
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
    const accountChanged =
      updatedAny.email !== existing.email ||
      updatedAny.username !== existing.username ||
      updatedAny.firstName !== existing.firstName ||
      updatedAny.lastName !== existing.lastName
    if (updatedAny.email && accountChanged) void enqueueStudentUserUpsert(updated.id)
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
    if (code === 'P2002') {
      return res.status(409).json({ message: 'Ese nombre de usuario ya está en uso' })
    }
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
