import type { Request } from "express";
import crypto from "crypto";
import { prisma } from "../db/prisma.js";
import { uruguayStartOfDayFromInstant } from "../config/app-timezone.js";
import { findNonWorkingDayForDate } from "./non-working-days.js";
import { recordAuditEventNow } from "./audit-log.js";

export class SubstitutionError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
    public code = "SUBSTITUTION_ERROR",
  ) {
    super(message);
  }
}

export async function createSubstitution(params: {
  eventId: string;
  substituteUserId: string;
  reason: string;
  notes?: string | null;
  actorUserId?: string | null;
  req?: Request;
}) {
  const reason = params.reason.trim();
  if (!params.eventId || !params.substituteUserId || !reason) {
    throw new SubstitutionError("La suplencia requiere docente, grupo/asignatura, fecha, horario y motivo");
  }

  const event = await prisma.event.findUnique({
    where: { id: params.eventId },
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      assignedUserId: true,
      courseOfferingId: true,
      subjectId: true,
      startDate: true,
      startTime: true,
      endTime: true,
    },
  });
  if (!event) throw new SubstitutionError("Clase no encontrada", 404, "EVENT_NOT_FOUND");
  if (event.type !== "CLASE") throw new SubstitutionError("Solo se pueden registrar suplencias sobre clases");
  if (event.status === "CANCELLED") throw new SubstitutionError("No se puede registrar suplencia sobre una clase cancelada");
  if (!event.assignedUserId) throw new SubstitutionError("La clase no tiene docente titular asignado");
  if (!event.courseOfferingId || !event.subjectId) {
    throw new SubstitutionError("La clase debe tener grupo y asignatura para registrar suplencia");
  }
  if (!event.startTime || !event.endTime) {
    throw new SubstitutionError("La clase debe tener fecha y horario para registrar suplencia");
  }
  if (event.assignedUserId === params.substituteUserId) {
    throw new SubstitutionError("El suplente no puede ser el mismo docente titular");
  }

  const substitute = await prisma.user.findUnique({
    where: { id: params.substituteUserId },
    select: { id: true, isActive: true, isApproved: true },
  });
  if (!substitute?.isActive || !substitute.isApproved) {
    throw new SubstitutionError("El docente suplente no existe o no está activo");
  }

  const nonWorkingDay = await findNonWorkingDayForDate(new Date(event.startTime));
  if (nonWorkingDay) {
    throw new SubstitutionError(`No se puede registrar suplencia: ${nonWorkingDay.reason}`);
  }

  const attendanceDate = uruguayStartOfDayFromInstant(new Date(event.startTime));

  const result = await prisma.$transaction(async (tx) => {
    const substitutionId = crypto.randomUUID();
    const substitutionRows = await tx.$queryRaw<any[]>`
      INSERT INTO "Substitution"
        (
          "id",
          "eventId",
          "originalTeacherUserId",
          "substituteUserId",
          "date",
          "startTime",
          "endTime",
          "reason",
          "notes",
          "createdByUserId",
          "updatedAt"
        )
      VALUES
        (
          ${substitutionId},
          ${event.id},
          ${event.assignedUserId!},
          ${params.substituteUserId},
          ${attendanceDate},
          ${new Date(event.startTime!)},
          ${new Date(event.endTime!)},
          ${reason},
          ${params.notes?.trim() || null},
          ${params.actorUserId || null},
          ${new Date()}
        )
      RETURNING *
    `;
    const substitution = substitutionRows[0];

    const existingOriginalAttendance = await tx.attendance.findFirst({
      where: {
        userId: event.assignedUserId!,
        eventId: event.id,
        date: attendanceDate,
        type: "CHECK_IN",
      },
      select: { id: true },
    });

    const originalAttendance = existingOriginalAttendance
      ? await tx.attendance.update({
          where: { id: existingOriginalAttendance.id },
          data: {
            status: "SUBSTITUTED" as any,
            notes: `Clase suplida oficialmente: ${reason}`,
          },
        })
      : await tx.attendance.create({
          data: {
            userId: event.assignedUserId!,
            eventId: event.id,
            date: attendanceDate,
            time: new Date(event.startTime!),
            type: "CHECK_IN",
            status: "SUBSTITUTED" as any,
            notes: `Clase suplida oficialmente: ${reason}`,
          },
        });

    return { substitution, originalAttendance };
  });

  await recordAuditEventNow({
    action: "SUBSTITUTION_CREATED" as any,
    actorUserId: params.actorUserId ?? null,
    req: params.req,
    entityType: "Substitution",
    entityId: result.substitution.id,
    metadata: {
      eventId: event.id,
      originalTeacherUserId: event.assignedUserId,
      substituteUserId: params.substituteUserId,
      reason,
      statusPrevious: null,
      statusNew: "SUBSTITUTED",
      originalAttendanceId: result.originalAttendance.id,
    },
  });

  return result.substitution;
}
