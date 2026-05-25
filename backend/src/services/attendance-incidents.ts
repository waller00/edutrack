import { prisma } from "../db/prisma.js";
import { getAttendanceOperationalSettings } from "../config/system-settings.js";
import { uruguayStartOfDayFromInstant } from "../config/app-timezone.js";
import {
  buildContiguousClassBlocks,
  fetchTeacherClassSlotsForUruguayDay,
  findBlockContainingEventId,
} from "./teacher-class-blocks.js";
import { isNonWorkingDate } from "./non-working-days.js";

function minutesDiff(a: Date, b: Date) {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60));
}

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

export async function maybeCreateLateArrivalIncident(params: {
  tx: any;
  userId: string;
  eventId?: string | null;
  eventType?: string | null;
  eventTitle?: string | null;
  attendanceId: string;
  biometricPunchId?: string | null;
  attendanceTime: Date;
  eventStartTime?: Date | null;
  lateToleranceMinutes: number;
}) {
  const {
    tx,
    userId,
    eventId,
    eventType,
    eventTitle,
    attendanceId,
    biometricPunchId,
    attendanceTime,
    eventStartTime,
    lateToleranceMinutes,
  } = params;
  if (!eventId || eventType !== "CLASE" || !eventStartTime) return null;

  const minsLate = minutesDiff(attendanceTime, new Date(eventStartTime));
  if (minsLate <= lateToleranceMinutes) return null;

  const alreadyOpen = await tx.attendanceIncident.findFirst({
    where: { userId, eventId, type: "LATE_ARRIVAL", status: "OPEN" },
    select: { id: true },
  });
  if (alreadyOpen) return alreadyOpen;

  const incident = await tx.attendanceIncident.create({
    data: {
      type: "LATE_ARRIVAL",
      status: "OPEN",
      severity: "MEDIUM",
      title: "Docente con llegada tarde",
      description: `Llegada ${minsLate} min tarde en clase${eventTitle ? `: ${eventTitle}` : ""}.`,
      userId,
      eventId,
      attendanceId,
      biometricPunchId: biometricPunchId || null,
    },
    select: { id: true, title: true, description: true },
  });

  await notifyAdminsAttendanceIncident(incident.title, incident.description || "Incidente de asistencia detectado.");
  return incident;
}

export async function resolveNoShowIncidentsForEvents(
  tx: any,
  userId: string,
  eventIds: (string | null | undefined)[],
) {
  let n = 0;
  const seen = new Set<string>();
  for (const id of eventIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    n += await resolveNoShowIncidentIfAny(tx, userId, id);
  }
  return n;
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

export async function scanAndCreateTeacherNoShowIncidents(now = new Date()) {
  const tx = prisma;
  const runtime = await getAttendanceOperationalSettings();
  const NO_SHOW_GRACE_MINUTES = runtime.noShowGraceMinutes;
  const threshold = new Date(now.getTime() - NO_SHOW_GRACE_MINUTES * 60 * 1000);
  const lookback = new Date(now.getTime() - 8 * 60 * 60 * 1000);

  const candidateEvents = await tx.event.findMany({
    where: {
      type: "CLASE",
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      assignedUserId: { not: null },
      startTime: { lte: threshold, gte: lookback },
      endTime: { gte: now },
    },
    select: {
      id: true,
      title: true,
      assignedUserId: true,
      startDate: true,
      startTime: true,
    },
  });

  let opened = 0;
  let resolved = 0;

  const bridgeGap = runtime.classBridgeGapMinutes;

  for (const ev of candidateEvents) {
    const userId = ev.assignedUserId!;
    const anchorTime = ev.startTime ?? ev.startDate;
    if (await isNonWorkingDate(new Date(anchorTime))) continue;

    const day = uruguayStartOfDayFromInstant(new Date(anchorTime));

    const slots = await fetchTeacherClassSlotsForUruguayDay(tx, userId, new Date(anchorTime));
    const blocks = buildContiguousClassBlocks(slots, bridgeGap);
    const block = findBlockContainingEventId(ev.id, blocks);
    const blockEventIds = block?.map((e) => e.id) ?? [ev.id];

    const checkIn = await tx.attendance.findFirst({
      where: {
        userId,
        type: "CHECK_IN",
        date: day,
        eventId: { in: blockEventIds },
      },
      select: { id: true },
    });

    if (checkIn) {
      resolved += await resolveNoShowIncidentIfAny(tx, userId, ev.id);
      continue;
    }

    const existingOpen = await tx.attendanceIncident.findFirst({
      where: { userId, eventId: ev.id, type: "TEACHER_NO_SHOW", status: "OPEN" },
      select: { id: true },
    });
    if (existingOpen) continue;

    const created = await tx.attendanceIncident.create({
      data: {
        type: "TEACHER_NO_SHOW",
        status: "OPEN",
        severity: "HIGH",
        title: "Docente no presente en aula",
        description: `No hay marcación de entrada para la clase "${ev.title}" tras ${NO_SHOW_GRACE_MINUTES} min de tolerancia.`,
        userId,
        eventId: ev.id,
      },
      select: { id: true, title: true, description: true },
    });
    opened += 1;
    await notifyAdminsAttendanceIncident(created.title, created.description || "Incidente de asistencia detectado.");
  }

  return { scanned: candidateEvents.length, opened, resolved, graceMinutes: NO_SHOW_GRACE_MINUTES };
}
