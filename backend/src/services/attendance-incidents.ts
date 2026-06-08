import { prisma } from "../db/prisma.js";
import { getAttendanceOperationalSettings } from "../config/system-settings.js";
import { uruguayStartOfDayFromInstant } from "../config/app-timezone.js";
import { toYmdUtc } from "./analytics/dateRange.js";
import { buildPresenceSpans, resolveOccurrenceOutcome } from "./attendance/coverage-spans.js";
import { findApprovedLicenseCoveringEventTime } from "./medicalLeaveReconciliation.js";
import { isNonWorkingDate } from "./non-working-days.js";

async function notifyAdminsAttendanceIncident(title: string, body: string, actionUrl = "/admin/attendance") {
  const admins = await prisma.user.findMany({
    where: {
      isActive: true,
      isApproved: true,
      orgRole: { code: "ADMIN" },
    },
    select: { id: true },
  });

  await Promise.all(
    admins.map((admin) =>
      prisma.inAppNotification.create({
        data: {
          userId: admin.id,
          type: "ATTENDANCE_INCIDENT",
          title,
          body,
          actionUrl,
        },
      }),
    ),
  );
}

export async function findAssignedEventForAttendanceInstant(tx: any, userId: string, at: Date) {
  return tx.event.findFirst({
    where: {
      assignedUserId: userId,
      type: { in: ["CLASE", "JORNADA_LABORAL", "REUNION"] },
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      startTime: { lte: at },
      endTime: { gte: at },
    },
    select: {
      id: true,
      title: true,
      type: true,
      startTime: true,
      endTime: true,
      assignedUser: { select: { id: true, name: true, email: true } },
    },
    orderBy: { startTime: "desc" },
  });
}

export async function findAssignedEventNearAttendanceInstant(
  tx: any,
  userId: string,
  at: Date,
  earlyWindowMinutes: number,
) {
  const latestStart = new Date(at.getTime() + earlyWindowMinutes * 60 * 1000);
  const rows = await tx.event.findMany({
    where: {
      assignedUserId: userId,
      type: { in: ["CLASE", "JORNADA_LABORAL", "REUNION"] },
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      startTime: { not: null, lte: latestStart },
      endTime: { not: null, gte: at },
    },
    select: {
      id: true,
      title: true,
      type: true,
      startTime: true,
      endTime: true,
      assignedUser: { select: { id: true, name: true, email: true } },
    },
    orderBy: { startTime: "asc" },
  });
  if (!rows.length) return null;

  const atMs = at.getTime();
  const active = rows
    .filter((event: { startTime: Date }) => new Date(event.startTime).getTime() <= atMs)
    .sort((a: { startTime: Date }, b: { startTime: Date }) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  return active[0] ?? rows[0] ?? null;
}

export async function findOpenNoShowIncidentForEvents(
  tx: any,
  userId: string,
  eventIds: (string | null | undefined)[],
) {
  const ids = Array.from(new Set(eventIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return null;
  return tx.attendanceIncident.findFirst({
    where: {
      userId,
      eventId: { in: ids },
      type: "TEACHER_NO_SHOW",
      status: "OPEN",
    },
    select: { id: true, eventId: true },
  });
}

export async function resolveNoShowIncidentIfAny(tx: any, userId: string, eventId?: string | null) {
  if (!eventId) return 0;
  const openIncident = await tx.attendanceIncident.findFirst({
    where: {
      userId,
      eventId,
      type: "TEACHER_NO_SHOW",
      status: "OPEN",
    },
    select: { id: true },
  });
  if (!openIncident) return 0;

  await tx.attendanceIncident.update({
    where: { id: openIncident.id },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
  return 1;
}

type NoShowCandidate = {
  id: string;
  title: string;
  assignedUserId: string | null;
  startDate: Date;
  startTime: Date | null;
  endTime: Date | null;
};

async function hasSubstitutionForDay(tx: any, eventId: string, userId: string, day: Date) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id"
    FROM "Substitution"
    WHERE "eventId" = ${eventId}
      AND "originalTeacherUserId" = ${userId}
      AND "date" = ${day}
    LIMIT 1
  `;
  return rows.length > 0;
}

/** Spans de presencia (CHECK_IN/CHECK_OUT) del docente en el día civil indicado. */
async function buildDayPresenceSpans(tx: any, userId: string, day: Date) {
  const rows = await tx.attendance.findMany({
    where: { userId, date: day, type: { in: ["CHECK_IN", "CHECK_OUT"] } },
    select: { id: true, userId: true, eventId: true, date: true, time: true, type: true, status: true, notes: true },
  });
  return buildPresenceSpans(rows);
}

/** Abre un TEACHER_NO_SHOW si no existe ya uno abierto para la ocurrencia. Devuelve 1 si abrió. */
async function openNoShowIfAbsent(tx: any, userId: string, ev: NoShowCandidate, graceMinutes: number) {
  const existingOpen = await tx.attendanceIncident.findFirst({
    where: { userId, eventId: ev.id, type: "TEACHER_NO_SHOW", status: "OPEN" },
    select: { id: true },
  });
  if (existingOpen) return 0;

  const created = await tx.attendanceIncident.create({
    data: {
      type: "TEACHER_NO_SHOW",
      status: "OPEN",
      severity: "HIGH",
      title: "Docente no presente en aula",
      description: `No hay presencia registrada para la clase "${ev.title}" tras ${graceMinutes} min de tolerancia.`,
      userId,
      eventId: ev.id,
    },
    select: { id: true, title: true, description: true },
  });
  await notifyAdminsAttendanceIncident(created.title, created.description || "Incidente de asistencia detectado.");
  return 1;
}

export async function scanAndCreateTeacherNoShowIncidents(now = new Date()) {
  const tx = prisma;
  const runtime = await getAttendanceOperationalSettings();
  const graceMinutes = runtime.noShowGraceMinutes;
  const threshold = new Date(now.getTime() - graceMinutes * 60 * 1000);
  const lookback = new Date(now.getTime() - 8 * 60 * 60 * 1000);

  const candidateEvents: NoShowCandidate[] = await tx.event.findMany({
    where: {
      type: { in: ["CLASE", "JORNADA_LABORAL", "REUNION"] },
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      assignedUserId: { not: null },
      startTime: { lte: threshold, gte: lookback },
      endTime: { gte: now },
    },
    select: { id: true, title: true, assignedUserId: true, startDate: true, startTime: true, endTime: true },
  });

  let opened = 0;
  let resolved = 0;

  for (const ev of candidateEvents) {
    const userId = ev.assignedUserId;
    if (!userId) continue;
    const anchorTime = new Date(ev.startTime ?? ev.startDate);
    if (await isNonWorkingDate(anchorTime)) continue;
    const day = uruguayStartOfDayFromInstant(anchorTime);
    if (await hasSubstitutionForDay(tx, ev.id, userId, day)) continue;

    const license =
      ev.startTime && ev.endTime
        ? await findApprovedLicenseCoveringEventTime(userId, new Date(ev.startTime), new Date(ev.endTime))
        : null;
    const spans = await buildDayPresenceSpans(tx, userId, day);
    const outcome = resolveOccurrenceOutcome(
      { userId, ymd: toYmdUtc(day), plannedStart: ev.startTime, plannedEnd: ev.endTime },
      spans,
      { hasSubstitution: false, hasLicense: Boolean(license), lateToleranceMinutes: runtime.lateToleranceMinutes },
    );

    // Solo ABSENT_NOT_JUSTIFIED es no-show accionable; cualquier presencia/justificación lo resuelve.
    if (outcome === "ABSENT_NOT_JUSTIFIED") {
      opened += await openNoShowIfAbsent(tx, userId, ev, graceMinutes);
    } else {
      resolved += await resolveNoShowIncidentIfAny(tx, userId, ev.id);
    }
  }

  return { scanned: candidateEvents.length, opened, resolved, graceMinutes };
}
