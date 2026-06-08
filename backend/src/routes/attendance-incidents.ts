import { Router } from "express";
import { z } from "zod";
import { authGuard, requirePermission } from "../middlewares/auth.js";
import { prisma } from "../db/prisma.js";
import { scanAndCreateTeacherNoShowIncidents } from "../services/attendance-incidents.js";
import { recordAuditEventNow } from "../services/audit-log.js";

const r = Router();

const listQuerySchema = z.object({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]).optional(),
  // Solo TEACHER_NO_SHOW es una incidencia accionable; tarde/salida anticipada se derivan
  // del status de la asistencia, no se persisten como incidencias.
  type: z.enum(["TEACHER_NO_SHOW"]).optional(),
  userId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

r.get("/", authGuard, requirePermission("attendance.read", "all"), async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Parámetros inválidos", errors: parsed.error.errors });
  }

  const { status, type, userId, eventId, page, pageSize } = parsed.data;
  const where: any = {
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
    ...(userId ? { userId } : {}),
    ...(eventId ? { eventId } : {}),
  };

  const [total, data] = await Promise.all([
    prisma.attendanceIncident.count({ where }),
    prisma.attendanceIncident.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        event: { select: { id: true, title: true, type: true, startTime: true, endTime: true } },
        attendance: { select: { id: true, type: true, status: true, time: true } },
      },
      orderBy: { detectedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return res.json({ total, page, pageSize, data });
});

r.post("/scan-now", authGuard, requirePermission("attendance.update", "all"), async (_req, res) => {
  try {
    const result = await scanAndCreateTeacherNoShowIncidents(new Date());
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error("attendance incidents scan-now:", error);
    return res.status(500).json({ message: "Error interno" });
  }
});

r.patch("/:id/resolve", authGuard, requirePermission("attendance.update", "all"), async (req, res) => {
  const { id } = req.params;
  const incident = await prisma.attendanceIncident.findUnique({ where: { id } });
  if (!incident) return res.status(404).json({ message: "Incidente no encontrado" });

  const updated = await prisma.attendanceIncident.update({
    where: { id },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedBy: (req as any).user?.id || null,
    },
  });
  await recordAuditEventNow({
    action: "ATTENDANCE_INCIDENT_RESOLVED" as any,
    actorUserId: (req as any).user?.id || (req as any).user?.sub || null,
    req,
    entityType: "AttendanceIncident",
    entityId: id,
    metadata: {
      reason: "Incidente resuelto manualmente",
      previousStatus: incident.status,
      newStatus: updated.status,
      type: incident.type,
    },
  });
  return res.json(updated);
});

export default r;
