import { AuditAction } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { recordAuditEventNow } from '../audit-log.js'
import { appendJustificationNote } from './roll-call-rules.js'
import { RollCallError } from './roll-call.js'

export type JustifyInput = {
  entryId: string
  type?: 'ABSENCE' | 'LATE_ARRIVAL' | 'OTHER'
  reason: string
  notes?: string | null
  attachment?: string | null
  /** 100 (falta entera) o 50 (media falta). `null` deja el peso como está. */
  absenceWeightHundredths?: number | null
  actorUserId?: string | null
  req?: any
}

/**
 * Convierte una falta en falta justificada.
 *
 * Espeja `services/attendance-justifications.ts` del mundo del personal: la fila de
 * justificación es un registro de TRANSICIÓN (previousStatus → newStatus), el estado sigue
 * viviendo en la entrada, y la auditoría se escribe fuera de la transacción.
 * Solo se justifican ausencias: una llegada tarde o una presencia no tienen nada que justificar.
 */
export async function justifyStudentAbsence(input: JustifyInput) {
  const reason = input.reason?.trim()
  if (!reason) throw new RollCallError(400, 'REASON_REQUIRED', 'El motivo es obligatorio.')

  const entry = await prisma.studentAttendanceEntry.findUnique({
    where: { id: input.entryId },
    include: { session: { select: { id: true, occurrenceYmd: true, eventId: true } } },
  })
  if (!entry) throw new RollCallError(404, 'ENTRY_NOT_FOUND', 'No se encontró la marca del estudiante.')

  const previousStatus = entry.status
  if (previousStatus !== 'ABSENT') {
    throw new RollCallError(
      409,
      'NOT_JUSTIFIABLE',
      'Solo se justifican ausencias. Cambiá primero el estado a ausente.',
    )
  }

  const updated = await prisma.$transaction(async (tx) => {
    const justification = await tx.studentAttendanceJustification.create({
      data: {
        entryId: entry.id,
        type: input.type ?? 'ABSENCE',
        reason,
        notes: input.notes?.trim() || null,
        attachment: input.attachment?.trim() || null,
        previousStatus,
        newStatus: 'ABSENT_JUSTIFIED',
        createdByUserId: input.actorUserId ?? null,
      },
    })
    const row = await tx.studentAttendanceEntry.update({
      where: { id: entry.id },
      data: {
        status: 'ABSENT_JUSTIFIED',
        note: appendJustificationNote(entry.note, reason),
        // Justificar y graduar la falta son el mismo trámite para adscripción: se hace de una.
        // Sin valor, el peso queda como estaba (y una ausencia sin peso vale una falta entera).
        ...(input.absenceWeightHundredths != null
          ? { absenceWeightHundredths: input.absenceWeightHundredths }
          : {}),
      },
    })
    return { row, justificationId: justification.id }
  })

  await recordAuditEventNow({
    action: AuditAction.STUDENT_ATTENDANCE_JUSTIFIED,
    actorUserId: input.actorUserId ?? null,
    req: input.req,
    entityType: 'StudentAttendanceEntry',
    entityId: entry.id,
    metadata: {
      reason,
      previousStatus,
      newStatus: 'ABSENT_JUSTIFIED',
      justificationId: updated.justificationId,
      absenceWeightHundredths: input.absenceWeightHundredths ?? null,
      sessionId: entry.session?.id ?? null,
      studentId: entry.studentId,
    },
  })

  return { entry: updated.row, justificationId: updated.justificationId }
}
