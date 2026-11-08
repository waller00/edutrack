import { Router } from 'express'
import { z } from 'zod'
import { AuditAction } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { requirePermission, userPermissionScope } from '../middlewares/auth.js'
import { recordAuditEventNow } from '../services/audit-log.js'
import { GradingError, saveGrades } from '../services/gradebook/grading.js'
import { correctedNotification, notifyGradeBook, resolveGradeBookRecipients } from '../services/gradebook/notifications.js'
import { isOutOfScale } from '../services/gradebook/period-closure.js'
import { writePeriodGrades } from '../services/gradebook/period-grade-history.js'
import { conductScale, isConductValue, periodScaleFor } from '../services/gradebook/period-scale.js'
import { loadRosterForScope } from '../services/student-attendance/roster.js'

/**
 * Correcciones de administración desde la Reunión de profesores: una nota de una evaluación, o la
 * R, la C o el juicio del docente de un alumno en un período.
 *
 * Es la excepción explícita al período cerrado: fuera de acá, una libreta cerrada no la edita nadie
 * (`assessmentWritePermissions`). Sólo Administración —`gradebook.manage` y `gradebook.grade` con
 * alcance `all`—, siempre con motivo, sin cambiar el estado del período, con su revisión (origen
 * `ADMIN_CORRECTION` y el motivo), su auditoría y un aviso al docente. Dirección y Adscripción ven
 * la libreta y no la editan.
 */
const r = Router()

const reasonSchema = z.string().trim().min(3, 'Escribí el motivo de la corrección.').max(500)

const assessmentCorrectionSchema = z.object({
  valueHundredths: z.number().int().nullish(),
  scaleLevelId: z.string().uuid().nullish(),
  isAbsent: z.boolean().optional(),
  comment: z.string().trim().max(2000).nullish(),
  reason: reasonSchema,
})

const periodCorrectionSchema = z
  .object({
    /** R: el rendimiento, la nota oficial. */
    meetingValueHundredths: z.number().int().nullish(),
    /** C: la conducta en la asignatura. */
    conductValueHundredths: z.number().int().nullish(),
    /** Juicio del docente (lo que va al boletín de esa materia). */
    conceptualJudgement: z.string().trim().max(2000).nullish(),
    reason: reasonSchema,
  })
  .refine(
    (d) => d.meetingValueHundredths !== undefined || d.conductValueHundredths !== undefined || d.conceptualJudgement !== undefined,
    { message: 'No hay nada para corregir.' },
  )

const BOOK_INCLUDE = {
  subject: { select: { name: true } },
  courseOffering: { select: { course: { select: { level: true } } } },
} as const

type Book = NonNullable<Awaited<ReturnType<typeof loadBook>>>

function loadBook(id: string) {
  return prisma.gradeBook.findUnique({ where: { id }, include: BOOK_INCLUDE })
}

type Fail = { status: number; message: string; code: string }
type Ready = { book: Book; student: Awaited<ReturnType<typeof loadRosterForScope>>[number]; userId: string }

/**
 * Lo común a las dos correcciones: quien corrige es Administración, la libreta existe y no es de
 * un ciclo cerrado, y el alumno es de su grupo.
 */
async function prepare(req: any): Promise<Ready | Fail> {
  const userId = req.user?.id ?? req.user?.sub
  const gradeScope = await userPermissionScope(userId, 'gradebook.grade', req.user?.role)
  if (gradeScope !== 'all') {
    return { status: 403, message: 'Las correcciones de la reunión son de administración.', code: 'NOT_ADMIN' }
  }
  const book = await loadBook(req.params.gradeBookId)
  if (!book) return { status: 404, message: 'Libreta no encontrada', code: 'GRADEBOOK_NOT_FOUND' }
  // Un ciclo cerrado es de sólo lectura para todos, incluida administración (RF-110).
  if (book.status === 'ARCHIVED') {
    return { status: 409, message: 'El ciclo lectivo está cerrado: la libreta es de sólo lectura.', code: 'ARCHIVED' }
  }
  const roster = await loadRosterForScope({
    schoolYearId: book.schoolYearId,
    courseOfferingId: book.courseOfferingId,
    orientationId: book.orientationId,
    courseOrientationId: book.courseOrientationId,
  })
  const student = roster.find((row) => row.studentId === req.params.studentId)
  if (!student) return { status: 404, message: 'El estudiante no es de esta libreta.', code: 'STUDENT_NOT_IN_ROSTER' }
  return { book, student, userId }
}

const isFail = (value: Ready | Fail): value is Fail => 'status' in value

/**
 * ¿Puede corregir desde la reunión? Administración: `gradebook.manage` y `gradebook.grade` con
 * alcance `all`. El panel del alumno lo usa para ofrecer «Corregir» sólo a quien después puede.
 */
export async function canCorrectGrades(req: any): Promise<boolean> {
  const userId = req.user?.id ?? req.user?.sub
  const [manage, grade] = await Promise.all([
    userPermissionScope(userId, 'gradebook.manage', req.user?.role),
    userPermissionScope(userId, 'gradebook.grade', req.user?.role),
  ])
  return manage === 'all' && grade === 'all'
}
const studentName = (s: { lastName: string; firstName: string }) => `${s.lastName}, ${s.firstName}`

async function afterCorrection(
  req: any,
  ready: Ready,
  details: { entityType: string; entityId: string; periodName: string; what: string; reason: string; metadata: Record<string, unknown> },
) {
  await recordAuditEventNow({
    action: AuditAction.GRADE_CORRECTED,
    actorUserId: ready.userId ?? null,
    req,
    entityType: details.entityType,
    entityId: details.entityId,
    metadata: { gradeBookId: ready.book.id, studentId: ready.student.studentId, reason: details.reason, ...details.metadata } as never,
  })
  await notifyGradeBook(
    await resolveGradeBookRecipients(ready.book.id, ready.userId ?? null),
    correctedNotification({
      subjectName: ready.book.subject?.name ?? 'la libreta',
      periodName: details.periodName,
      studentName: studentName(ready.student),
      what: details.what,
      reason: details.reason,
      gradeBookId: ready.book.id,
    }),
  )
}

/** Una nota de una evaluación: valor (o tramo), «No rindió» y comentario. */
r.put('/gradebooks/:gradeBookId/assessments/:assessmentId/students/:studentId', async (req: any, res) => {
  const parsed = assessmentCorrectionSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message ?? 'Datos inválidos', code: 'INVALID' })
  }
  try {
    const ready = await prepare(req)
    if (isFail(ready)) return res.status(ready.status).json({ message: ready.message, code: ready.code })

    const assessment = await prisma.assessment.findFirst({
      where: { id: req.params.assessmentId, gradeBookId: ready.book.id, deletedAt: null },
      include: {
        gradingScale: { include: { levels: { orderBy: { sortOrder: 'asc' } } } },
        period: { select: { name: true } },
        grades: { where: { studentId: ready.student.studentId }, select: { valueHundredths: true, isAbsent: true, comment: true } },
      },
    })
    if (!assessment) return res.status(404).json({ message: 'Evaluación no encontrada', code: 'ASSESSMENT_NOT_FOUND' })

    const d = parsed.data
    const before = assessment.grades[0] ?? null
    const scale = assessment.gradingScale
    const result = await saveGrades({
      assessmentId: assessment.id,
      entries: [
        {
          studentId: ready.student.studentId,
          valueHundredths: d.isAbsent ? null : d.valueHundredths ?? null,
          scaleLevelId: d.isAbsent ? null : d.scaleLevelId ?? null,
          isAbsent: d.isAbsent ?? false,
          comment: d.comment ?? null,
        },
      ],
      roster: [ready.student],
      scale: {
        id: scale.id,
        kind: scale.kind,
        minValueHundredths: scale.minValueHundredths,
        maxValueHundredths: scale.maxValueHundredths,
        levels: scale.levels,
      },
      actorUserId: ready.userId,
      origin: 'ADMIN_CORRECTION',
      reason: d.reason,
    })

    await afterCorrection(req, ready, {
      entityType: 'Assessment',
      entityId: assessment.id,
      periodName: assessment.period?.name ?? '',
      what: `la nota de «${assessment.title}»`,
      reason: d.reason,
      metadata: {
        assessmentId: assessment.id,
        before,
        after: { valueHundredths: d.isAbsent ? null : d.valueHundredths ?? null, isAbsent: d.isAbsent ?? false, comment: d.comment ?? null },
      },
    })
    return res.json({ ok: true, data: result })
  } catch (error) {
    if (error instanceof GradingError) {
      return res.status(error.httpStatus).json({ message: error.message, code: error.code, detail: error.details })
    }
    console.error('[admin-gradebook] assessment correction:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Qué se corrigió, en palabras, para el aviso al docente. */
function correctedFields(d: z.infer<typeof periodCorrectionSchema>): string {
  const parts = [
    d.meetingValueHundredths !== undefined && 'la R',
    d.conductValueHundredths !== undefined && 'la C',
    d.conceptualJudgement !== undefined && 'el juicio',
  ].filter(Boolean) as string[]
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0]
}

/** Valores fuera de la escala del nivel (R) o de la de conducta (C): el mensaje, o null. */
async function outOfScale(book: Book, d: z.infer<typeof periodCorrectionSchema>): Promise<string | null> {
  if (d.meetingValueHundredths != null) {
    const scale = await periodScaleFor(book.courseOffering?.course?.level)
    if (d.meetingValueHundredths % 100 !== 0 || isOutOfScale(d.meetingValueHundredths, scale)) {
      return 'La R tiene que ser una nota entera de la escala del nivel.'
    }
  }
  if (d.conductValueHundredths != null) {
    const conduct = await conductScale()
    if (!isConductValue(d.conductValueHundredths, conduct?.levels ?? [])) return 'La C tiene que ser una nota de la escala de conducta.'
  }
  return null
}

/** La R, la C o el juicio del docente de un alumno en un período, sin reabrirlo. */
r.put('/gradebooks/:gradeBookId/periods/:periodId/students/:studentId', async (req: any, res) => {
  const parsed = periodCorrectionSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message ?? 'Datos inválidos', code: 'INVALID' })
  }
  try {
    const ready = await prepare(req)
    if (isFail(ready)) return res.status(ready.status).json({ message: ready.message, code: ready.code })
    const d = parsed.data

    const period = await prisma.academicPeriod.findFirst({
      where: { id: req.params.periodId, schoolYearId: ready.book.schoolYearId },
      select: { id: true, name: true },
    })
    if (!period) return res.status(404).json({ message: 'El período no es del ciclo de la libreta.', code: 'PERIOD_NOT_FOUND' })
    const scaleError = await outOfScale(ready.book, d)
    if (scaleError) return res.status(400).json({ message: scaleError, code: 'VALUE_OUT_OF_SCALE' })

    const state = await prisma.gradeBookPeriod.upsert({
      where: { gradeBookId_periodId: { gradeBookId: ready.book.id, periodId: period.id } },
      update: {},
      create: { gradeBookId: ready.book.id, periodId: period.id },
      select: { id: true, status: true },
    })
    const entry = {
      ...(d.meetingValueHundredths !== undefined ? { meetingValueHundredths: d.meetingValueHundredths } : {}),
      ...(d.conductValueHundredths !== undefined ? { conductValueHundredths: d.conductValueHundredths } : {}),
      ...(d.conceptualJudgement !== undefined ? { conceptualJudgement: d.conceptualJudgement || null } : {}),
    }
    // El estado del período no se toca: la libreta sigue cerrada si lo estaba.
    const revisions = await prisma.$transaction((tx) =>
      writePeriodGrades(tx, {
        gradeBookPeriodId: state.id,
        rows: [{ student: ready.student, entry }],
        actorUserId: ready.userId ?? null,
        origin: 'ADMIN_CORRECTION',
        reason: d.reason,
      }),
    )

    await afterCorrection(req, ready, {
      entityType: 'GradeBookPeriod',
      entityId: state.id,
      periodName: period.name,
      what: correctedFields(d),
      reason: d.reason,
      metadata: { periodId: period.id, periodStatus: state.status, after: entry },
    })
    return res.json({ ok: true, revisions, periodStatus: state.status })
  } catch (error) {
    console.error('[admin-gradebook] period correction:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r

/** Se monta con `gradebook.manage` `all`: sólo Administración lo tiene. */
export const correctionsGuard = requirePermission('gradebook.manage', 'all')
