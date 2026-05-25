import type { Request } from "express";
import crypto from "crypto";
import { prisma } from "../db/prisma.js";
import { recordAuditEventNow } from "./audit-log.js";

export class AttendanceJustificationError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
    public code = "ATTENDANCE_JUSTIFICATION_ERROR",
  ) {
    super(message);
  }
}

function justifiedStatusFor(currentStatus: string) {
  if (currentStatus === "ABSENT_NOT_JUSTIFIED") return "ABSENT_JUSTIFIED";
  if (currentStatus === "LATE" || currentStatus === "EARLY_EXIT") return "JUSTIFIED";
  return "JUSTIFIED";
}

export async function justifyAttendance(params: {
  attendanceId: string;
  type?: "ABSENCE" | "LATE_ARRIVAL" | "EARLY_EXIT" | "OTHER";
  reason: string;
  notes?: string | null;
  attachment?: string | null;
  actorUserId?: string | null;
  req?: Request;
}) {
  const reason = params.reason.trim();
  if (!reason) {
    throw new AttendanceJustificationError("El motivo de la justificación es obligatorio");
  }

  const attendance = await prisma.attendance.findUnique({
    where: { id: params.attendanceId },
    select: { id: true, status: true, notes: true },
  });
  if (!attendance) {
    throw new AttendanceJustificationError("No se puede justificar una asistencia inexistente", 404, "ATTENDANCE_NOT_FOUND");
  }

  const previousStatus = attendance.status;
  const newStatus = justifiedStatusFor(previousStatus);

  const result = await prisma.$transaction(async (tx) => {
    const justificationId = crypto.randomUUID();
    await tx.$executeRaw`
      INSERT INTO "AttendanceJustification"
        ("id", "attendanceId", "type", "reason", "notes", "attachment", "previousStatus", "newStatus", "createdByUserId")
      VALUES
        (
          ${justificationId},
          ${attendance.id},
          ${(params.type ?? "OTHER") as any}::"AttendanceJustificationType",
          ${reason},
          ${params.notes?.trim() || null},
          ${params.attachment?.trim() || null},
          ${previousStatus}::"AttendanceStatus",
          ${newStatus}::"AttendanceStatus",
          ${params.actorUserId || null}
        )
    `;

    const updated = await tx.attendance.update({
      where: { id: attendance.id },
      data: {
        status: newStatus as any,
        notes: attendance.notes
          ? `${attendance.notes}\nJustificación: ${reason}`
          : `Justificación: ${reason}`,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        event: { select: { id: true, title: true, type: true, startTime: true, endTime: true } },
      },
    });

    return { updated, justificationId };
  });

  await recordAuditEventNow({
    action: "ATTENDANCE_JUSTIFIED" as any,
    actorUserId: params.actorUserId ?? null,
    req: params.req,
    entityType: "Attendance",
    entityId: attendance.id,
    metadata: {
      reason,
      previousStatus,
      newStatus,
      justificationId: result.justificationId,
    },
  });

  return result.updated;
}
