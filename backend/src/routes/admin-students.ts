import { Router, raw as expressRaw } from 'express'
import type { Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Prisma, StudentEnrollmentStatus } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { assertCourseOfferedInSchoolYear, getActiveSchoolYearId, resolveSchoolYearIdForList } from '../services/school-year-service.js'
import { enqueueStudentUserUpsert } from '../integrations/moodle/outbox.js'
import {
  getStudentMoodleVerifications,
  provisionStudentMoodleAccount,
  resendStudentMoodleWelcome,
  type MoodleStudentVerification,
} from '../integrations/moodle/student-users.js'
import { getMappedId, getMappedIds } from '../integrations/moodle/object-map.js'
import { isValidUruguayanCI, onlyDigits } from '../identity/uruguay-ci.js'
import {
  STUDENT_PHOTO_MIMES,
  STUDENT_PHOTO_PARSER_LIMIT,
  photoETag,
  photoRejectionResponse,
  validateStudentPhoto,
} from '../services/student-photo.js'

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

/**
 * Campos opcionales "borrables": en edición, mandar el campo vacío significa LIMPIARLO (→ null),
 * y omitirlo significa "no tocar". '' / espacios → null; undefined → undefined (no cambia).
 */
function clearableEmpty(v: unknown): unknown {
  if (v === null || v === undefined) return v
  if (typeof v === 'string') {
    const t = v.trim()
    return t === '' ? null : t
  }
  return v
}
function clearableTrimmed(max: number) {
  return z.preprocess(clearableEmpty, z.string().max(max).nullable().optional())
}
/**
 * Email y usuario son **opcionales**: hacen falta para la cuenta de Moodle, que ahora se crea
 * aparte y a mano, así que exigirlos para dar de alta a un estudiante trababa el alta cuando no
 * se tenían a mano. El formato se sigue validando cuando vienen, y `''` los limpia.
 */
const optionalStudentEmail = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v
    const t = v.trim().toLowerCase()
    return t === '' ? null : t
  },
  z.string().email('Email inválido').max(200).nullable().optional(),
)
const optionalStudentUsername = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v
    const t = v.trim().toLowerCase()
    return t === '' ? null : t
  },
  z
    .string()
    .min(3, 'El usuario Moodle debe tener al menos 3 caracteres')
    .max(30)
    .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'Usuario inválido (use letras, números, puntos o guiones)')
    .nullable()
    .optional(),
)
const clearableUruguayanCI = z.preprocess(
  clearableEmpty,
  z
    .string()
    .max(40)
    .transform((v) => onlyDigits(v))
    .refine((v) => isValidUruguayanCI(v), 'Cédula inválida: verificá el número y el dígito verificador')
    .nullable()
    .optional(),
)
const clearableDateString = z.preprocess(
  clearableEmpty,
  z
    .string()
    .min(4)
    .max(40)
    .refine((s) => !Number.isNaN(Date.parse(s)), 'Fecha inválida')
    .nullable()
    .optional(),
)

const studentWriteBaseSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  documentId: clearableUruguayanCI,
  courseId: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.string().uuid().optional(),
  ),
  schoolYearId: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().uuid().optional()),
  /// Orientación de la matrícula. `null` la limpia (tronco común); omitirla no la toca.
  orientationId: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  contactPhone: clearableTrimmed(40),
  tutorPhone: clearableTrimmed(40),
  username: optionalStudentUsername,
  email: optionalStudentEmail,
  address: clearableTrimmed(500),
  birthDate: clearableDateString,
  /// De dónde vino el pase al ingresar (7.º). Es el nombre de un centro, no un código.
  admittedFrom: clearableTrimmed(200),
  healthCardExpiresAt: clearableDateString,
  liceoAccessNotes: clearableTrimmed(8000),
  enrollmentStatus: enrollmentStatusZ.optional(),
  /// Cómo cerró el año. Se completa al cerrar el ciclo, no al dar de alta.
  academicResult: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.enum(['PROMOTED', 'PROMOTED_WITH_PENDING', 'REPEATED', 'PENDING_APE']).nullable().optional(),
  ),
  apeReferred: z.boolean().optional(),
  withdrawnAt: optionalDateString,
  withdrawalAcademicYear: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.number().int().min(1980).max(2100).optional(),
  ),
  internalNotes: clearableTrimmed(8000),
})

const studentCreateSchema = studentWriteBaseSchema.extend({
  // La cédula es obligatoria al crear un estudiante.
  documentId: z.preprocess(
    clearableEmpty,
    z
      .string({ required_error: 'La cédula es obligatoria', invalid_type_error: 'La cédula es obligatoria' })
      .max(40)
      .transform((v) => onlyDigits(v))
      .refine((v) => isValidUruguayanCI(v), 'Cédula inválida: verificá el número y el dígito verificador'),
  ),
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

function unavailableMoodleVerification(): MoodleStudentVerification {
  return {
    state: 'UNAVAILABLE',
    verified: null,
    accountExists: false,
    moodleUserId: null,
    firstAccessAt: null,
  }
}

async function safeStudentMoodleVerifications(studentIds: string[]) {
  try {
    return await getStudentMoodleVerifications(studentIds)
  } catch (error) {
    console.warn('[admin/students] no se pudo consultar el estado Moodle:', error)
    return new Map(studentIds.map((id) => [id, unavailableMoodleVerification()]))
  }
}

/**
 * Verificación Moodle para LISTADOS: `getStudentMoodleVerifications` llama al web service de
 * Moodle de forma sincrónica, así que en el listado es opcional (`?includeMoodle=1`) y por
 * defecto se devuelve el estado desconocido. En el detalle de un estudiante sigue siendo
 * incondicional, que es donde el dato realmente importa.
 */
async function listMoodleVerifications(studentIds: string[], include: boolean) {
  if (!include) return new Map(studentIds.map((id) => [id, unavailableMoodleVerification()]))
  return safeStudentMoodleVerifications(studentIds)
}

/**
 * Estado Moodle del alumno tal como lo consume la UI.
 *
 * `linked` sale de `MoodleObjectMap` (consulta local, sin web service) y es lo que permite
 * distinguir dos situaciones que hasta ahora se veían igual —ambas `NOT_FOUND`—: el alumno al que
 * nunca se le creó la cuenta, y aquel cuya cuenta existe para EduTrack pero Moodle ya no encuentra.
 * La primera se resuelve con el botón de alta; la segunda es una desincronización que hay que ver.
 */
function serializeMoodleStatus(
  verification: MoodleStudentVerification | undefined,
  welcomeSentAt: Date | null | undefined,
  options: { linked: boolean; email: string | null; username: string | null },
) {
  const value = verification ?? unavailableMoodleVerification()
  return {
    ...value,
    linked: options.linked,
    // La cuenta necesita email + usuario reales: sin eso sólo se podría crear un espejo `nologin`.
    canProvision: Boolean(options.email?.trim() && options.username?.trim()),
    welcomeSentAt: welcomeSentAt?.toISOString() ?? null,
  }
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
  /** ¿Hay fila en `MoodleObjectMap`? Distingue "nunca se creó" de "Moodle no la encuentra". */
  moodleLinked?: boolean
  /** Metadatos de la foto. Los bytes NUNCA viajan acá: se piden a `GET /:id/photo`. */
  photo?: { mimeType: string; byteSize: number; updatedAt: Date } | null
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
  birthDate: Date | null
  admittedFrom: string | null
  healthCardExpiresAt: Date | null
  liceoAccessNotes: string | null
  enrollmentStatus: StudentEnrollmentStatus
  academicResult: string | null
  apeReferred: boolean
  withdrawnAt: Date | null
  withdrawalAcademicYear: number | null
  internalNotes: string | null
  moodleWelcomeSentAt: Date | null
  moodleVerification?: MoodleStudentVerification
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
    birthDate: row.birthDate?.toISOString() ?? null,
    admittedFrom: row.admittedFrom ?? null,
    healthCardExpiresAt: row.healthCardExpiresAt?.toISOString() ?? null,
    liceoAccessNotes: row.liceoAccessNotes,
    academicResult: row.academicResult ?? null,
    apeReferred: row.apeReferred ?? false,
    enrollmentStatus: row.enrollmentStatus,
    withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
    withdrawalAcademicYear: row.withdrawalAcademicYear,
    internalNotes: row.internalNotes,
    photo: row.photo
      ? {
          mimeType: row.photo.mimeType,
          byteSize: row.photo.byteSize,
          updatedAt: row.photo.updatedAt.toISOString(),
        }
      : null,
    moodle: serializeMoodleStatus(row.moodleVerification, row.moodleWelcomeSentAt, {
      linked: row.moodleLinked ?? false,
      email: row.email,
      username: row.username,
    }),
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
    const orientationId = ((req.query.orientationId as string) || '').trim()
    const status = ((req.query.status as string) || '').trim().toUpperCase()
    const tuitionYear = (req.query.tuitionYear as string) || ''
    const tuitionPreviewYear = (req.query.tuitionPreviewYear as string) || ''
    const tuitionMonth = (req.query.tuitionMonth as string) || ''
    const tuitionPaid = (req.query.tuitionPaid as string) || ''

    const allYears = req.query.allYears === '1'
    // Opt-in: evita una llamada sincrónica al web service de Moodle en cada listado.
    const includeMoodle = req.query.includeMoodle === '1'
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
    if (orientationId) {
      const parsed = z.string().uuid().safeParse(orientationId)
      if (parsed.success) enrollmentWhere.orientationId = parsed.data
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
      const listedStudentIds = [
        ...enrollmentRows.map((row) => row.studentId),
        ...orphanRows.map((row) => row.id),
      ]
      const moodleVerifications = await listMoodleVerifications(listedStudentIds, includeMoodle)
      // Consulta local y en lote: `linked` va siempre, sin el opt-in `includeMoodle`.
      const moodleLinks = await getMappedIds('STUDENT', listedStudentIds)
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
          moodle: serializeMoodleStatus(moodleVerifications.get(row.id), row.moodleWelcomeSentAt, {
            linked: moodleLinks.has(row.id),
            email: row.email,
            username: row.username,
          }),
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
        moodle: serializeMoodleStatus(moodleVerifications.get(row.id), row.moodleWelcomeSentAt, {
          linked: moodleLinks.has(row.id),
          email: row.email,
          username: row.username,
        }),
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
    const moodleVerifications = await listMoodleVerifications(rowsAny.map((row) => row.id), includeMoodle)
    const moodleLinks = await getMappedIds('STUDENT', rowsAny.map((row: { id: string }) => row.id))

    const data = rowsAny.map((row) => {
      const enrollment = row.enrollments?.[0] ?? null
      const courseOffering = enrollment?.courseOffering ?? null
      return {
          id: row.id,
          // `studentId` se emite en AMBAS ramas (con y sin allYears): el cliente nunca
          // tiene que deducirlo del id compuesto `studentId:enrollmentId`.
          studentId: row.id,
          enrollmentId: enrollment?.id ?? null,
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
          moodle: serializeMoodleStatus(moodleVerifications.get(row.id), row.moodleWelcomeSentAt, {
            linked: moodleLinks.has(row.id),
            email: row.email,
            username: row.username,
          }),
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

/**
 * Historial completo de matrículas del estudiante, un registro por ciclo.
 * El detalle (`GET /:id`) devuelve solo la matrícula del ciclo seleccionado (`take: 1`),
 * así que sin este endpoint no hay forma de ver el recorrido académico.
 */
r.get('/:id/enrollments', async (req, res) => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    })
    if (!student) return res.status(404).json({ message: 'Estudiante no encontrado' })

    const rows = await (prisma as any).studentEnrollment.findMany({
      where: { studentId: student.id },
      include: {
        schoolYear: { select: { id: true, code: true, name: true } },
        courseOffering: { include: { course: { select: { id: true, name: true, code: true } } } },
        orientation: { select: { id: true, name: true, code: true } },
      },
      orderBy: { schoolYear: { code: 'desc' } },
    })

    return res.json(
      rows.map((row: any) => ({
        id: row.id,
        schoolYearId: row.schoolYearId,
        schoolYearCode: row.schoolYear?.code ?? null,
        schoolYearName: row.schoolYear?.name ?? null,
        courseId: row.courseOffering?.courseId ?? null,
        courseName: row.courseOffering?.course?.name ?? null,
        courseCode: row.courseOffering?.course?.code ?? null,
        orientationId: row.orientationId ?? null,
        orientationName: row.orientation?.name ?? null,
        enrollmentStatus: row.enrollmentStatus,
        withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
        withdrawalAcademicYear: row.withdrawalAcademicYear ?? null,
        notes: row.notes ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    )
  } catch (error) {
    console.error('[admin/students] enrollments:', error)
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
    const moodleVerifications = await safeStudentMoodleVerifications([row.id])
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
      academicResult: enrollment?.academicResult ?? null,
      apeReferred: enrollment?.apeReferred ?? false,
      withdrawnAt: enrollment?.withdrawnAt ?? null,
      withdrawalAcademicYear: enrollment?.withdrawalAcademicYear ?? null,
      moodleVerification: moodleVerifications.get(row.id),
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
      const s = await tx.student.create({
        data: {
          firstName: body.firstName,
          lastName: body.lastName,
          documentId: body.documentId ?? null,
          username: body.username ?? null,
          contactPhone: body.contactPhone ?? null,
          tutorPhone: body.tutorPhone ?? null,
          email: body.email ?? null,
          address: body.address ?? null,
          birthDate: body.birthDate ? parseOptionalEndOfDayDate(body.birthDate) ?? null : null,
          admittedFrom: body.admittedFrom ?? null,
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
          academicResult: body.academicResult ?? null,
          apeReferred: body.apeReferred ?? false,
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
    // Crear el estudiante NO crea su cuenta de Moodle: eso se hace desde la ficha, a mano
    // (`POST /admin/students/:id/moodle-account`). Antes se encolaba acá y la cuenta —y el mail
    // con la contraseña— salían solos, que es justo lo que no se quiere.
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
      academicResult: enrollment?.academicResult ?? body.academicResult ?? null,
      apeReferred: enrollment?.apeReferred ?? body.apeReferred ?? false,
      withdrawnAt: enrollment?.withdrawnAt ?? withdrawn ?? null,
      withdrawalAcademicYear: enrollment?.withdrawalAcademicYear ?? body.withdrawalAcademicYear ?? null,
      moodleVerification: (await safeStudentMoodleVerifications([created.id])).get(created.id),
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

// ─── Adecuaciones y materias bajas ──────────────────────────────────────────

/**
 * **El informe nunca entra al sistema.** Se guarda el tipo, un resumen de lo que el docente
 * necesita tener en cuenta al calificar, y el enlace a donde el documento vive de verdad. Es el
 * mismo criterio que las licencias médicas: la política de privacidad prohíbe almacenar
 * diagnósticos y documentos clínicos, y un informe psicológico de un menor es exactamente eso.
 */
const accommodationSchema = z.object({
  kind: z.enum(['CURRICULAR', 'EVALUATION', 'ACCESSIBILITY', 'OTHER']).default('CURRICULAR'),
  summary: z.string().trim().min(1, 'Escribí qué tener en cuenta al calificar').max(4000),
  externalUrl: z.preprocess(
    clearableEmpty,
    z.string().url('El enlace tiene que ser una URL').max(2000).nullable().optional(),
  ),
  validFrom: clearableDateString,
  validUntil: clearableDateString,
})

r.get('/:id/accommodations', async (req, res) => {
  try {
    const rows = await (prisma as any).studentAccommodation.findMany({
      where: { studentId: req.params.id },
      orderBy: { createdAt: 'desc' },
    })
    return res.json({ data: rows })
  } catch (error) {
    console.error('[admin/students/:id/accommodations GET]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/:id/accommodations', async (req: any, res) => {
  const parsed = accommodationSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Datos inválidos',
      detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
    })
  }
  try {
    const student = await prisma.student.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!student) return res.status(404).json({ message: 'Estudiante no encontrado' })

    const d = parsed.data
    const created = await (prisma as any).studentAccommodation.create({
      data: {
        studentId: req.params.id,
        kind: d.kind,
        summary: d.summary,
        externalUrl: d.externalUrl ?? null,
        validFrom: d.validFrom ? parseOptionalEndOfDayDate(d.validFrom) ?? null : null,
        validUntil: d.validUntil ? parseOptionalEndOfDayDate(d.validUntil) ?? null : null,
        createdByUserId: req.user?.id ?? req.user?.sub ?? null,
      },
    })
    return res.status(201).json({ data: created })
  } catch (error) {
    console.error('[admin/students/:id/accommodations POST]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.delete('/:id/accommodations/:accommodationId', async (req, res) => {
  try {
    const deleted = await (prisma as any).studentAccommodation.deleteMany({
      where: { id: req.params.accommodationId, studentId: req.params.id },
    })
    if (deleted.count === 0) return res.status(404).json({ message: 'Adecuación no encontrada' })
    return res.status(204).end()
  } catch (error) {
    console.error('[admin/students/:id/accommodations DELETE]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

const pendingSubjectSchema = z.object({
  schoolYearId: z.string().uuid(),
  subjectId: z.string().uuid(),
  origin: z.enum(['FAILED_THIS_YEAR', 'CARRIED_OVER']).default('FAILED_THIS_YEAR'),
  apeDecember: z.preprocess(clearableEmpty, z.enum(['PASSED', 'FAILED', 'NOT_TAKEN']).nullable().optional()),
  apeFebruary: z.preprocess(clearableEmpty, z.enum(['PASSED', 'FAILED', 'NOT_TAKEN']).nullable().optional()),
  notes: clearableTrimmed(2000),
})

r.get('/:id/pending-subjects', async (req, res) => {
  try {
    const rows = await (prisma as any).studentPendingSubject.findMany({
      where: { studentId: req.params.id },
      include: { subject: { select: { id: true, name: true } }, schoolYear: { select: { id: true, code: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return res.json({ data: rows })
  } catch (error) {
    console.error('[admin/students/:id/pending-subjects GET]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/**
 * Alta o actualización de una materia baja.
 *
 * Es un upsert por `(estudiante, ciclo, materia)`: registrar el resultado de APE diciembre y luego
 * el de febrero son dos pasos sobre la misma fila, no dos filas. Cuando salva, se marca
 * `resolvedAt` y deja de mostrársele al docente — pero la fila queda, porque el historial de qué
 * se llevó es justamente lo que necesita el año siguiente.
 */
r.put('/:id/pending-subjects', async (req: any, res) => {
  const parsed = pendingSubjectSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Datos inválidos',
      detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
    })
  }
  try {
    const d = parsed.data
    const passed = d.apeDecember === 'PASSED' || d.apeFebruary === 'PASSED'
    const data = {
      origin: d.origin,
      apeDecember: d.apeDecember ?? null,
      apeFebruary: d.apeFebruary ?? null,
      notes: d.notes ?? null,
      resolvedAt: passed ? new Date() : null,
    }
    const saved = await (prisma as any).studentPendingSubject.upsert({
      where: {
        studentId_schoolYearId_subjectId: {
          studentId: req.params.id,
          schoolYearId: d.schoolYearId,
          subjectId: d.subjectId,
        },
      },
      create: {
        studentId: req.params.id,
        schoolYearId: d.schoolYearId,
        subjectId: d.subjectId,
        createdByUserId: req.user?.id ?? req.user?.sub ?? null,
        ...data,
      },
      update: data,
      include: { subject: { select: { id: true, name: true } }, schoolYear: { select: { id: true, code: true } } },
    })
    return res.json({ data: saved })
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2003') {
      return res.status(400).json({ message: 'Ciclo o materia inexistente' })
    }
    console.error('[admin/students/:id/pending-subjects PUT]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.delete('/:id/pending-subjects/:pendingId', async (req, res) => {
  try {
    const deleted = await (prisma as any).studentPendingSubject.deleteMany({
      where: { id: req.params.pendingId, studentId: req.params.id },
    })
    if (deleted.count === 0) return res.status(404).json({ message: 'Materia no encontrada' })
    return res.status(204).end()
  } catch (error) {
    console.error('[admin/students/:id/pending-subjects DELETE]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// ─── Foto del alumno ────────────────────────────────────────────────────────

/**
 * El cuerpo llega **binario**, no en base64: evita el +33% y las copias en memoria, y hace que el
 * `Content-Type` de la request sea el tipo declarado que después se contrasta con los magic bytes.
 * El límite del parser es mayor que el de negocio para poder responder un 413 propio en JSON.
 */
const photoParser = expressRaw({ type: [...STUDENT_PHOTO_MIMES], limit: STUDENT_PHOTO_PARSER_LIMIT })

r.get('/:id/photo', async (req, res) => {
  try {
    const photo = await (prisma as any).studentPhoto.findUnique({ where: { studentId: req.params.id } })
    if (!photo) return res.status(404).json({ message: 'El estudiante no tiene foto' })

    const etag = photoETag(photo.updatedAt, photo.byteSize)
    res.setHeader('ETag', etag)
    // Nunca `public`: es dato personal de un menor y Cloudflare está delante del backend.
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate')
    res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Disposition', 'inline')
    if (req.headers['if-none-match'] === etag) return res.status(304).end()

    res.setHeader('Content-Type', photo.mimeType)
    return res.send(photo.bytes)
  } catch (error) {
    console.error('[admin/students/:id/photo GET]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.put('/:id/photo', photoParser, async (req, res) => {
  try {
    // Si el Content-Type no matchea el parser, `req.body` no es un Buffer: es un tipo no admitido.
    if (!Buffer.isBuffer(req.body)) {
      return res.status(415).json({ message: 'Formato no admitido: sólo JPEG, PNG o WebP' })
    }
    const check = validateStudentPhoto(req.body, String(req.headers['content-type'] ?? ''))
    if (check.code) {
      const { status, message } = photoRejectionResponse(check.code)
      return res.status(status).json({ message })
    }

    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    })
    if (!student) return res.status(404).json({ message: 'Estudiante no encontrado' })

    const data = { bytes: req.body, mimeType: check.mimeType, byteSize: req.body.length }
    const saved = await (prisma as any).studentPhoto.upsert({
      where: { studentId: req.params.id },
      create: { studentId: req.params.id, ...data },
      update: data,
    })
    return res.json({
      ok: true,
      photo: { mimeType: saved.mimeType, byteSize: saved.byteSize, updatedAt: saved.updatedAt.toISOString() },
    })
  } catch (error) {
    console.error('[admin/students/:id/photo PUT]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.delete('/:id/photo', async (req, res) => {
  try {
    // `deleteMany` y no `delete`: borrar una foto que no está no es un error.
    await (prisma as any).studentPhoto.deleteMany({ where: { studentId: req.params.id } })
    return res.status(204).end()
  } catch (error) {
    console.error('[admin/students/:id/photo DELETE]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/**
 * Sin esto, el `PayloadTooLargeError` del parser cae en el handler por defecto de Express y
 * responde HTML, que el cliente (`api()`) no sabe parsear y muestra como "API 413" pelado.
 */
r.use('/:id/photo', (err: any, _req: any, res: any, next: any) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({ message: 'La foto supera 1 MB. Probá con una imagen más chica.' })
  }
  return next(err)
})

/** Estado Moodle recién actualizado de un alumno, para responder después de una acción. */
async function freshMoodleStatus(id: string, welcomeSentAt: Date | null) {
  const [verification, mapped, student] = await Promise.all([
    safeStudentMoodleVerifications([id]).then((m) => m.get(id)),
    getMappedId('STUDENT', id),
    prisma.student.findUnique({ where: { id }, select: { email: true, username: true } }),
  ])
  return serializeMoodleStatus(verification, welcomeSentAt, {
    linked: mapped != null,
    email: student?.email ?? null,
    username: student?.username ?? null,
  })
}

/** Traduce los códigos de dominio de `student-users.ts` a HTTP. Compartido por las dos acciones. */
function moodleActionErrorResponse(error: unknown, res: Response, logLabel: string) {
  const code = error instanceof Error ? error.message : String(error)
  if (code === 'MOODLE_STUDENT_NOT_FOUND') {
    return res.status(404).json({ message: 'Estudiante no encontrado' })
  }
  if (code === 'MOODLE_STUDENT_ACCOUNT_FIELDS_REQUIRED') {
    return res.status(400).json({ message: 'El email y el usuario Moodle son obligatorios' })
  }
  if (code === 'MOODLE_STUDENT_ALREADY_VERIFIED') {
    return res.status(409).json({ message: 'La cuenta ya fue verificada en Moodle' })
  }
  if (code === 'MOODLE_NOT_CONFIGURED') {
    return res.status(503).json({ message: 'La integración con Moodle no está disponible' })
  }
  console.error(logLabel, error)
  return res.status(502).json({ message: 'No se pudo completar la operación en Moodle' })
}

/**
 * Alta explícita de la cuenta Moodle. Es la única vía por la que nace una cuenta desde la app:
 * el alta de estudiante ya no la crea sola, y el outbox sólo propaga cambios a cuentas existentes.
 */
r.post('/:id/moodle-account', async (req, res) => {
  const id = req.params.id
  try {
    const result = await provisionStudentMoodleAccount(id)
    return res.json({
      ok: true,
      message: result.alreadyLinked
        ? 'La cuenta de Moodle ya existía; se actualizaron sus datos'
        : 'Cuenta de Moodle creada y correo de acceso enviado',
      moodle: await freshMoodleStatus(id, result.welcomeSentAt),
    })
  } catch (error) {
    return moodleActionErrorResponse(error, res, '[admin/students/:id/moodle-account]')
  }
})

r.post('/:id/moodle-welcome/resend', async (req, res) => {
  const id = req.params.id
  try {
    const sentAt = await resendStudentMoodleWelcome(id)
    return res.json({
      ok: true,
      message: 'Correo de acceso a Moodle reenviado',
      moodle: await freshMoodleStatus(id, sentAt),
    })
  } catch (error) {
    return moodleActionErrorResponse(error, res, '[admin/students/:id/moodle-welcome/resend]')
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

    // Quitarle el email o el usuario a un alumno que YA tiene cuenta de Moodle la dejaría
    // desincronizada en silencio: `upgradeStudentToManual` corta si falta alguno de los dos, así
    // que Moodle se quedaría con la dirección vieja para siempre.
    const clearsEmail = body.email === null && existing.email
    const clearsUsername = body.username === null && existing.username
    if (clearsEmail || clearsUsername) {
      if ((await getMappedId('STUDENT', id)) != null) {
        return res.status(409).json({
          message: 'No se puede quitar el email ni el usuario de un alumno con cuenta de Moodle',
        })
      }
    }

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
    if (body.username !== undefined) data.username = body.username
    if (body.email !== undefined) data.email = body.email
    if (body.address !== undefined) data.address = body.address ?? null
    if (body.birthDate !== undefined) {
      data.birthDate = body.birthDate ? parseOptionalEndOfDayDate(body.birthDate) : null
    }
    if (body.admittedFrom !== undefined) data.admittedFrom = body.admittedFrom ?? null
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
      // `courseOrientationId` se deriva de (curso, orientación, ciclo): es el vínculo que ya
      // usan los eventos y la resolución de cohorte del pase de lista.
      let orientationPatch: Record<string, unknown> = {}
      if (body.orientationId !== undefined && targetSchoolYearId && finalCourseOfferingId) {
        if (body.orientationId === null) {
          orientationPatch = { orientationId: null, courseOrientationId: null }
        } else {
          const offering = await (tx as any).courseOffering.findUnique({
            where: { id: finalCourseOfferingId },
            select: { courseId: true },
          })
          const link = offering
            ? await (tx as any).courseOrientation.findFirst({
                where: {
                  courseId: offering.courseId,
                  orientationId: body.orientationId,
                  OR: [{ schoolYearId: targetSchoolYearId }, { schoolYearId: null }],
                },
                select: { id: true },
              })
            : null
          orientationPatch = { orientationId: body.orientationId, courseOrientationId: link?.id ?? null }
        }
      }
      // También se actualiza cuando no hay oferta pero SÍ matrícula previa: sin esto, editar el
      // resultado del año o la derivación a APE de un alumno sin curso asignado se perdía en
      // silencio. Crear sigue exigiendo oferta, porque la matrícula no existe sin curso.
      if (targetSchoolYearId && (finalCourseOfferingId || currentEnrollment)) {
        await (tx as any).studentEnrollment.upsert({
          where: { studentId_schoolYearId: { studentId: id, schoolYearId: targetSchoolYearId } },
          update: {
            ...(finalCourseOfferingId ? { courseOfferingId: finalCourseOfferingId } : {}),
            ...(body.enrollmentStatus !== undefined ? { enrollmentStatus: body.enrollmentStatus } : {}),
            ...(body.academicResult !== undefined ? { academicResult: body.academicResult ?? null } : {}),
            ...(body.apeReferred !== undefined ? { apeReferred: body.apeReferred } : {}),
            ...(body.withdrawnAt !== undefined ? { withdrawnAt: body.withdrawnAt ? parseOptionalEndOfDayDate(body.withdrawnAt) : null } : {}),
            ...(body.withdrawalAcademicYear !== undefined ? { withdrawalAcademicYear: body.withdrawalAcademicYear ?? null } : {}),
            ...(body.internalNotes !== undefined ? { notes: body.internalNotes ?? null } : {}),
            ...orientationPatch,
          },
          create: {
            studentId: id,
            schoolYearId: targetSchoolYearId,
            courseOfferingId: finalCourseOfferingId,
            ...orientationPatch,
            enrollmentStatus: (body.enrollmentStatus ?? 'ACTIVE') as StudentEnrollmentStatus,
            academicResult: body.academicResult ?? null,
            apeReferred: body.apeReferred ?? false,
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
    // Sólo se propaga a quien YA tiene cuenta. El handler del outbox también corta por su cuenta;
    // esto evita encolar una tarea que no va a hacer nada.
    if (accountChanged && (await getMappedId('STUDENT', updated.id)) != null) {
      void enqueueStudentUserUpsert(updated.id)
    }
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
      academicResult: enrollment?.academicResult ?? body.academicResult ?? null,
      apeReferred: enrollment?.apeReferred ?? body.apeReferred ?? false,
      withdrawnAt: enrollment?.withdrawnAt ?? (body.withdrawnAt ? parseOptionalEndOfDayDate(body.withdrawnAt) : null),
      withdrawalAcademicYear: enrollment?.withdrawalAcademicYear ?? body.withdrawalAcademicYear ?? null,
      moodleVerification: (await safeStudentMoodleVerifications([updated.id])).get(updated.id),
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
