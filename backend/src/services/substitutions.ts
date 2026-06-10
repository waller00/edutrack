import type { Request } from "express";
import { prisma } from "../db/prisma.js";
import { uruguayStartOfDayFromInstant, isYmdDateString } from "../config/app-timezone.js";
import { findNonWorkingDayForDate } from "./non-working-days.js";
import { recordAuditEventNow } from "./audit-log.js";
import { resolveSubstitutionOccurrence, SubstitutionError } from "./substitution-occurrence.js";

export { SubstitutionError };

const substitutionListInclude = {
  event: {
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      startTime: true,
      endTime: true,
      subject: { select: { id: true, name: true } },
      courseOffering: { select: { course: { select: { id: true, name: true, code: true } } } },
    },
  },
  originalTeacher: { select: { id: true, name: true, email: true, username: true } },
  substitute: { select: { id: true, name: true, email: true, username: true } },
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

export async function listSubstitutions(params: {
  from?: string;
  to?: string;
  eventId?: string;
  originalTeacherUserId?: string;
  substituteUserId?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = params.page ?? 1;
  const pageSize = Math.min(params.pageSize ?? 50, 100);
  const where: Record<string, unknown> = {};

  if (params.eventId) where.eventId = params.eventId;
  if (params.originalTeacherUserId) where.originalTeacherUserId = params.originalTeacherUserId;
  if (params.substituteUserId) where.substituteUserId = params.substituteUserId;

  if (params.from || params.to) {
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (params.from && isYmdDateString(params.from)) {
      dateFilter.gte = uruguayStartOfDayFromInstant(new Date(`${params.from}T12:00:00.000Z`));
    }
    if (params.to && isYmdDateString(params.to)) {
      const end = uruguayStartOfDayFromInstant(new Date(`${params.to}T12:00:00.000Z`));
      end.setUTCHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    if (Object.keys(dateFilter).length) where.date = dateFilter;
  }

  const [total, data] = await Promise.all([
    (prisma as any).substitution.count({ where }),
    (prisma as any).substitution.findMany({
      where,
      include: substitutionListInclude,
      orderBy: [{ date: "desc" }, { startTime: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return { total, page, pageSize, data };
}

export async function createSubstitution(params: {
  eventId: string;
  substituteUserId: string;
  reason: string;
  notes?: string | null;
  occurrenceDate?: string | null;
  actorUserId?: string | null;
  req?: Request;
}) {
  const reason = params.reason.trim();
  if (!params.eventId || !params.substituteUserId || !reason) {
    throw new SubstitutionError("La suplencia requiere titular, suplente, fecha, horario y motivo");
  }

  const event = await prisma.event.findUnique({
    where: { id: params.eventId },
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      assignedUserId: true,
      schoolYearId: true,
      courseOfferingId: true,
      subjectId: true,
      startDate: true,
      startTime: true,
      endTime: true,
      isRecurring: true,
      daysOfWeek: true,
    },
  });
  if (!event) throw new SubstitutionError("Clase no encontrada", 404, "EVENT_NOT_FOUND");
  if (event.type !== "CLASE") throw new SubstitutionError("Solo se pueden registrar suplencias sobre clases");
  if (event.status === "CANCELLED") throw new SubstitutionError("No se puede registrar suplencia sobre una clase cancelada");
  if (!event.assignedUserId) throw new SubstitutionError("La clase no tiene docente titular asignado");
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

  const occurrence = resolveSubstitutionOccurrence({
    occurrenceDate: params.occurrenceDate,
    event: {
      startDate: event.startDate,
      startTime: event.startTime,
      endTime: event.endTime,
      isRecurring: event.isRecurring,
      daysOfWeek: event.daysOfWeek ?? [],
    },
  });

  const nonWorkingDay = await findNonWorkingDayForDate(occurrence.startTime);
  if (nonWorkingDay) {
    throw new SubstitutionError(`No se puede registrar suplencia: ${nonWorkingDay.reason}`);
  }

  const existing = await (prisma as any).substitution.findUnique({
    where: { eventId_date: { eventId: event.id, date: occurrence.attendanceDate } },
    select: { id: true },
  });
  if (existing) {
    throw new SubstitutionError("Ya existe una suplencia registrada para esta clase en esa fecha", 409, "SUBSTITUTION_EXISTS");
  }

  const result = await prisma.$transaction(async (tx) => {
    const substitution = await (tx as any).substitution.create({
      data: {
        eventId: event.id,
        originalTeacherUserId: event.assignedUserId!,
        substituteUserId: params.substituteUserId,
        date: occurrence.attendanceDate,
        startTime: occurrence.startTime,
        endTime: occurrence.endTime,
        reason,
        notes: params.notes?.trim() || null,
        createdByUserId: params.actorUserId || null,
      },
    });

    const existingOriginalAttendance = await tx.attendance.findFirst({
      where: {
        userId: event.assignedUserId!,
        eventId: event.id,
        date: occurrence.attendanceDate,
        type: "CHECK_IN",
      },
      select: { id: true },
    });

    const originalAttendance = existingOriginalAttendance
      ? await tx.attendance.update({
          where: { id: existingOriginalAttendance.id },
          data: {
            status: "SUBSTITUTED" as any,
            notes: `Ausencia prevista sin justificar (suplida): ${reason}`,
          },
        })
      : await tx.attendance.create({
          data: {
            userId: event.assignedUserId!,
            eventId: event.id,
            schoolYearId: event.schoolYearId,
            date: occurrence.attendanceDate,
            time: occurrence.startTime,
            type: "CHECK_IN",
            status: "SUBSTITUTED" as any,
            notes: `Ausencia prevista sin justificar (suplida): ${reason}`,
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
      occurrenceDate: occurrence.occurrenceYmd,
      originalTeacherUserId: event.assignedUserId,
      substituteUserId: params.substituteUserId,
      reason,
      statusNew: "SUBSTITUTED",
      originalAttendanceId: result.originalAttendance.id,
    },
  });

  return (prisma as any).substitution.findUniqueOrThrow({
    where: { id: result.substitution.id },
    include: substitutionListInclude,
  });
}

export async function deleteSubstitution(params: {
  id: string;
  actorUserId?: string | null;
  req?: Request;
}) {
  const row = await (prisma as any).substitution.findUnique({
    where: { id: params.id },
    include: { event: { select: { id: true, title: true } } },
  });
  if (!row) throw new SubstitutionError("Suplencia no encontrada", 404, "SUBSTITUTION_NOT_FOUND");

  await prisma.$transaction(async (tx) => {
    await (tx as any).substitution.delete({ where: { id: params.id } });

    const titularCheckIn = await tx.attendance.findFirst({
      where: {
        userId: row.originalTeacherUserId,
        eventId: row.eventId,
        date: row.date,
        type: "CHECK_IN",
        status: "SUBSTITUTED" as any,
      },
      select: { id: true, notes: true },
    });

    if (
      titularCheckIn?.notes?.includes("Ausencia prevista sin justificar (suplida)") ||
      titularCheckIn?.notes?.includes("Ausencia esperada (suplida)") ||
      titularCheckIn?.notes?.includes("Clase suplida oficialmente")
    ) {
      await tx.attendance.update({
        where: { id: titularCheckIn.id },
        data: {
          status: "ABSENT_NOT_JUSTIFIED" as any,
          notes: "Suplencia anulada por administración",
        },
      });
    }
  });

  await recordAuditEventNow({
    action: "ATTENDANCE_MANUAL_UPDATED" as any,
    actorUserId: params.actorUserId ?? null,
    req: params.req,
    entityType: "Substitution",
    entityId: params.id,
    metadata: {
      eventId: row.eventId,
      eventTitle: row.event.title,
      originalTeacherUserId: row.originalTeacherUserId,
      substituteUserId: row.substituteUserId,
    },
  });

  return { ok: true };
}
