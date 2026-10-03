import { AuditAction } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { isYmdDateString } from '../../config/app-timezone.js'
import { recordAuditEventNow } from '../audit-log.js'
import { BASIC_CYCLE_LEVEL, isBasicCycle } from './absence-weight.js'
import { justifyEntryTx } from './justify.js'
import { RollCallError } from './roll-call.js'

/**
 * Justificación de días completos (ciclo básico).
 *
 * Adscripción o dirección registran "el alumno falta del 3 al 5 por tal motivo". Sirve igual
 * antes que después: al crearla justifica las ausencias que ya existen en el rango, y al pasar
 * lista (`saveRollCall`) las ausencias que caigan dentro entran ya justificadas. Una llegada tarde
 * no se toca — no se justifica y siempre vale media — y si el docente marca presente, el
 * alumno vino y gana su marca.
 */

export type CreateRangeInput = {
  studentId: string
  fromYmd: string
  toYmd: string
  reason: string
  notes?: string | null
  actorUserId?: string | null
  req?: any
}

export type ActiveRange = { id: string; reason: string; createdByUserId: string | null }

export async function createJustificationRange(input: CreateRangeInput) {
  const reason = input.reason?.trim()
  if (!reason) throw new RollCallError(400, 'REASON_REQUIRED', 'El motivo es obligatorio.')
  if (!isYmdDateString(input.fromYmd) || !isYmdDateString(input.toYmd)) {
    throw new RollCallError(400, 'INVALID_DATE', 'Las fechas deben ser YYYY-MM-DD.')
  }
  if (input.fromYmd > input.toYmd) {
    throw new RollCallError(400, 'INVALID_RANGE', 'La fecha desde no puede ser posterior a la fecha hasta.')
  }

  const enrollment = await prisma.studentEnrollment.findFirst({
    where: { studentId: input.studentId, enrollmentStatus: 'ACTIVE' },
    select: { schoolYearId: true, courseOffering: { select: { course: { select: { level: true } } } } },
    orderBy: { createdAt: 'desc' },
  })
  if (!enrollment) {
    throw new RollCallError(409, 'NO_ENROLLMENT', 'El estudiante no tiene matrícula activa.')
  }
  if (!isBasicCycle(enrollment.courseOffering?.course?.level)) {
    throw new RollCallError(
      409,
      'NOT_BASIC_CYCLE',
      'La justificación por días sólo aplica a estudiantes de ciclo básico.',
    )
  }

  const result = await prisma.$transaction(async (tx) => {
    const range = await tx.studentAbsenceJustificationRange.create({
      data: {
        studentId: input.studentId,
        schoolYearId: enrollment.schoolYearId,
        fromYmd: input.fromYmd,
        toYmd: input.toYmd,
        reason,
        notes: input.notes?.trim() || null,
        createdByUserId: input.actorUserId ?? null,
      },
    })
    // Justificación posterior: las ausencias ya marcadas dentro del rango.
    const existing = await tx.studentAttendanceEntry.findMany({
      where: {
        studentId: input.studentId,
        status: 'ABSENT',
        session: {
          schoolYearId: enrollment.schoolYearId,
          occurrenceYmd: { gte: input.fromYmd, lte: input.toYmd },
        },
      },
      select: { id: true, note: true },
    })
    for (const entry of existing) {
      await justifyEntryTx(tx, entry, { reason, notes: input.notes, actorUserId: input.actorUserId, rangeId: range.id })
    }
    return { range, justifiedEntryIds: existing.map((e) => e.id) }
  })

  await recordAuditEventNow({
    action: AuditAction.STUDENT_ATTENDANCE_RANGE_JUSTIFIED,
    actorUserId: input.actorUserId ?? null,
    req: input.req,
    entityType: 'StudentAbsenceJustificationRange',
    entityId: result.range.id,
    metadata: {
      studentId: input.studentId,
      fromYmd: input.fromYmd,
      toYmd: input.toYmd,
      reason,
      justifiedEntryIds: result.justifiedEntryIds,
    },
  })

  return { range: result.range, justifiedCount: result.justifiedEntryIds.length }
}

/**
 * Revoca un rango para que deje de aplicarse a las listas que se pasen de acá en adelante.
 * Lo ya justificado **no** se deshace: fue un acto administrativo registrado, y si hay que
 * revertirlo se corrige la marca.
 */
export async function revokeJustificationRange(input: { rangeId: string; actorUserId?: string | null; req?: any }) {
  const range = await prisma.studentAbsenceJustificationRange.findUnique({ where: { id: input.rangeId } })
  if (!range) throw new RollCallError(404, 'RANGE_NOT_FOUND', 'No se encontró la justificación.')
  if (range.revokedAt) throw new RollCallError(409, 'ALREADY_REVOKED', 'La justificación ya estaba revocada.')

  const updated = await prisma.studentAbsenceJustificationRange.update({
    where: { id: range.id },
    data: { revokedAt: new Date(), revokedByUserId: input.actorUserId ?? null },
  })

  await recordAuditEventNow({
    action: AuditAction.STUDENT_ATTENDANCE_RANGE_REVOKED,
    actorUserId: input.actorUserId ?? null,
    req: input.req,
    entityType: 'StudentAbsenceJustificationRange',
    entityId: range.id,
    metadata: { studentId: range.studentId, fromYmd: range.fromYmd, toYmd: range.toYmd },
  })

  return updated
}

export async function listJustificationRanges(filter: { studentId?: string; schoolYearId?: string | null }) {
  return prisma.studentAbsenceJustificationRange.findMany({
    where: {
      ...(filter.studentId ? { studentId: filter.studentId } : {}),
      ...(filter.schoolYearId ? { schoolYearId: filter.schoolYearId } : {}),
    },
    include: { student: { select: { id: true, firstName: true, lastName: true, documentId: true } } },
    orderBy: [{ fromYmd: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  })
}

/**
 * Estudiantes de ciclo básico con matrícula activa, para elegir a quién justificar. Adscripción y
 * dirección no tienen `students.manage`: este buscador es lo único que necesitan ver.
 */
export async function searchBasicCycleStudents(filter: { q: string; schoolYearId?: string | null }) {
  const terms = filter.q.trim().split(/\s+/).filter(Boolean).slice(0, 3)
  const rows = await prisma.studentEnrollment.findMany({
    where: {
      enrollmentStatus: 'ACTIVE',
      ...(filter.schoolYearId ? { schoolYearId: filter.schoolYearId } : {}),
      courseOffering: { course: { level: BASIC_CYCLE_LEVEL } },
      AND: terms.map((term) => ({
        student: {
          OR: [
            { firstName: { contains: term, mode: 'insensitive' as const } },
            { lastName: { contains: term, mode: 'insensitive' as const } },
            { documentId: { contains: term } },
          ],
        },
      })),
    },
    select: {
      student: { select: { id: true, firstName: true, lastName: true, documentId: true } },
      courseOffering: { select: { course: { select: { name: true } } } },
    },
    orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    take: 20,
  })
  return rows.map((row) => ({ ...row.student, courseName: row.courseOffering?.course?.name ?? null }))
}

/** Rango vigente que cubre `ymd`, por estudiante. Lo usa el pase de lista. */
export async function activeRangesFor(
  studentIds: readonly string[],
  ymd: string,
): Promise<Map<string, ActiveRange>> {
  if (studentIds.length === 0) return new Map()
  const rows = await prisma.studentAbsenceJustificationRange.findMany({
    where: {
      studentId: { in: [...studentIds] },
      revokedAt: null,
      fromYmd: { lte: ymd },
      toYmd: { gte: ymd },
    },
    select: { id: true, studentId: true, reason: true, createdByUserId: true },
    orderBy: { createdAt: 'asc' },
  })
  const byStudent = new Map<string, ActiveRange>()
  for (const row of rows) {
    if (!byStudent.has(row.studentId)) {
      byStudent.set(row.studentId, { id: row.id, reason: row.reason, createdByUserId: row.createdByUserId })
    }
  }
  return byStudent
}
