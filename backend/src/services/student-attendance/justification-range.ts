import { AuditAction } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { isYmdDateString } from '../../config/app-timezone.js'
import { recordAuditEventNow } from '../audit-log.js'
import { justifyEntryTx } from './justify.js'
import { RollCallError } from './roll-call.js'

/**
 * Justificativos: el papel (certificado médico, constancia de viaje, de duelo…) que justifica las
 * faltas de un estudiante en un período. En la pantalla se llaman así; en el modelo, rango de
 * justificación (`StudentAbsenceJustificationRange`).
 *
 * Los cargan administración, dirección y adscripción (`student-attendance.justify` con alcance
 * `all`), para estudiantes de cualquier nivel. Sirve igual antes que después:
 * - cargado **después**, justifica en el momento las ausencias ya marcadas en el período;
 * - cargado **antes**, al pasar lista (`saveRollCall`) las ausencias de esos días entran ya
 *   justificadas.
 * Una llegada tarde no se toca (no se justifica: siempre vale media) y si el docente marca
 * presente, el alumno vino y gana su marca. Cuánto cuenta una falta justificada lo decide el nivel
 * (`absence-weight.ts`): en ciclo básico, media; en bachillerato, sigue siendo una falta.
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
    select: { schoolYearId: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!enrollment) {
    throw new RollCallError(409, 'NO_ENROLLMENT', 'El estudiante no tiene matrícula activa.')
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
    // La que el docente cambió entre la lectura y ahora ya no es ausencia: se saltea, no frena el rango.
    const justifiedEntryIds: string[] = []
    for (const entry of existing) {
      const done = await justifyEntryTx(tx, entry, {
        reason,
        notes: input.notes,
        actorUserId: input.actorUserId,
        rangeId: range.id,
      })
      if (done) justifiedEntryIds.push(entry.id)
    }
    return { range, justifiedEntryIds }
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
 * Estudiantes con matrícula activa, de cualquier nivel, para elegir a quién cargarle un
 * justificativo. Adscripción y dirección no tienen `students.manage`: este buscador es lo único
 * que necesitan ver.
 */
export async function searchJustifiableStudents(filter: { q: string; schoolYearId?: string | null }) {
  const terms = filter.q.trim().split(/\s+/).filter(Boolean).slice(0, 3)
  const rows = await prisma.studentEnrollment.findMany({
    where: {
      enrollmentStatus: 'ACTIVE',
      ...(filter.schoolYearId ? { schoolYearId: filter.schoolYearId } : {}),
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
