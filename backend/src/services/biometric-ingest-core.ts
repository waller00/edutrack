import crypto from "crypto";
import { prisma } from "../db/prisma.js";
import { buildBiometricAttendancePayload, getAttendanceStatus } from "../attendance/attendance-logic.js";
import { uruguayStartOfDayFromInstant } from "../config/app-timezone.js";
import { getAttendanceOperationalSettings } from "../config/system-settings.js";
import { findApprovedLicenseCoveringEventTime } from "./medicalLeaveReconciliation.js";
import { isNonWorkingDate } from "./non-working-days.js";
import { getActiveSchoolYearId } from "./school-year-service.js";
import {
  findAssignedEventForAttendanceInstant,
  findAssignedEventNearAttendanceInstant,
} from "./attendance-incidents.js";
import {
  coverageForOccurrence,
  earlyEntryWindowMinutes,
  fetchTeacherClassSlotsForUruguayDay,
  type ClassEventSlot,
} from "./attendance/coverage-spans.js";

export function hashBiometricSecret(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function isBiometricSecretValid(storedHash: string, providedRaw: string) {
  const providedHash = hashBiometricSecret(providedRaw);
  const a = Buffer.from(storedHash);
  const b = Buffer.from(providedHash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function isLateAgainstEventStart(
  attendanceTime: Date,
  eventStartTime: Date | null | undefined,
  toleranceMinutes: number,
) {
  if (!eventStartTime) return false;
  const minsLate = Math.floor((attendanceTime.getTime() - new Date(eventStartTime).getTime()) / (1000 * 60));
  return minsLate > toleranceMinutes;
}

function minutesLateAgainstEventStart(attendanceTime: Date, eventStartTime: Date | null | undefined) {
  if (!eventStartTime) return null;
  return Math.max(0, Math.floor((attendanceTime.getTime() - new Date(eventStartTime).getTime()) / (1000 * 60)));
}

function isVeryLateArrival(minutesLate: number | null, noShowGraceMinutes: number) {
  return minutesLate !== null && minutesLate >= Math.max(1, noShowGraceMinutes);
}

function isWithinDuplicateWindow(a: Date, b: Date, windowMinutes: number) {
  return windowMinutes > 0 && Math.abs(a.getTime() - b.getTime()) <= windowMinutes * 60 * 1000;
}

function endOfUtcDay(startOfDay: Date) {
  const end = new Date(startOfDay);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

async function createDuplicatePunch(
  tx: any,
  params: {
    deviceDbId: string;
    mappingId: string;
    userId: string;
    deviceUserId: string;
    externalId?: string;
    occurredAt: Date;
    punchType: "CHECK_IN" | "CHECK_OUT";
    processError: string;
    payload: unknown;
  },
) {
  return tx.biometricPunch.create({
    data: {
      deviceId: params.deviceDbId,
      mappingId: params.mappingId,
      userId: params.userId,
      deviceUserId: params.deviceUserId,
      externalId: params.externalId,
      occurredAt: params.occurredAt,
      punchType: params.punchType,
      processStatus: "DUPLICATE",
      processError: params.processError,
      payload: params.payload as object,
    },
    select: { id: true },
  });
}

/** Ciclo lectivo de la marca: el del evento vinculado, o el ciclo activo si no hay evento. */
async function resolveAttendanceSchoolYearId(tx: any, eventId: string | null | undefined): Promise<string | null> {
  if (eventId) {
    const ev = await tx.event.findUnique({ where: { id: eventId }, select: { schoolYearId: true } });
    if (ev?.schoolYearId) return ev.schoolYearId;
  }
  return getActiveSchoolYearId(prisma);
}

async function getOpenCheckInAnchorEventId(tx: any, userId: string, attendanceDate: Date): Promise<string | null> {
  const rows = await tx.attendance.findMany({
    where: { userId, date: attendanceDate },
    orderBy: { time: "asc" },
    select: { type: true, eventId: true },
  });
  let openAnchor: string | null = null;
  for (const r of rows) {
    if (r.type === "CHECK_IN") openAnchor = r.eventId;
    else if (r.type === "CHECK_OUT") openAnchor = null;
  }
  return openAnchor;
}

async function getOpenCheckInAttendance(tx: any, userId: string, attendanceDate: Date) {
  const rows = await tx.attendance.findMany({
    where: { userId, date: attendanceDate, type: { in: ["CHECK_IN", "CHECK_OUT"] } },
    orderBy: { time: "asc" },
    select: { id: true, userId: true, eventId: true, date: true, time: true, type: true, status: true, notes: true },
  });
  let openIn: any | null = null;
  for (const row of rows) {
    if (row.type === "CHECK_IN") openIn = row;
    else if (row.type === "CHECK_OUT") openIn = null;
  }
  return openIn;
}

async function createSequenceIncidentIfMissing(tx: any, params: {
  userId: string;
  attendanceId: string;
  attendanceDate: Date;
  occurredAt: Date;
}) {
  const existing = await tx.attendanceIncident.findFirst({
    where: {
      userId: params.userId,
      attendanceId: params.attendanceId,
      type: "EARLY_EXIT",
      status: "OPEN",
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const incident = await tx.attendanceIncident.create({
    data: {
      type: "EARLY_EXIT",
      status: "OPEN",
      severity: "HIGH",
      title: "Marcación inconsistente: salida sin entrada",
      description: "Se registró una salida biométrica sin una entrada abierta previa para el mismo día.",
      userId: params.userId,
      attendanceId: params.attendanceId,
      detectedAt: params.occurredAt,
    },
    select: { id: true },
  });
  return incident?.id ?? null;
}

async function materializeCoveredEventAttendances(tx: any, params: {
  userId: string;
  attendanceDate: Date;
  checkIn: { id: string; userId: string; eventId: string | null; date: Date; time: Date; type: string; status: string; notes: string | null };
  checkOut: { time: Date };
  deviceCode: string;
}) {
  const slots = await fetchTeacherClassSlotsForUruguayDay(tx, params.userId, params.attendanceDate);
  let created = 0;

  for (const slot of slots) {
    const coverage = coverageForOccurrence(
      {
        userId: params.userId,
        ymd: params.attendanceDate.toISOString().slice(0, 10),
        plannedStart: slot.startTime,
        plannedEnd: slot.endTime,
      },
      new Map([
        [
          `${params.userId}_${params.attendanceDate.toISOString().slice(0, 10)}`,
          [{ userId: params.userId, ymd: params.attendanceDate.toISOString().slice(0, 10), checkIn: params.checkIn, checkOut: params.checkOut as any }],
        ],
      ]),
    );
    if (!coverage.covered) continue;

    const existing = await tx.attendance.findFirst({
      where: {
        userId: params.userId,
        date: { gte: params.attendanceDate, lte: endOfUtcDay(params.attendanceDate) },
        eventId: slot.id,
        type: "CHECK_IN",
      },
      select: { id: true },
    });
    if (existing) continue;

    await tx.attendance.create({
      data: {
        userId: params.userId,
        eventId: slot.id,
        schoolYearId: slot.schoolYearId ?? undefined,
        type: "CHECK_IN",
        status: "PRESENT",
        date: params.attendanceDate,
        time: slot.startTime,
        notes: `Presencia correlacionada por permanencia biométrica - Dispositivo: ${params.deviceCode || "N/A"}`,
      },
    });
    created += 1;
  }

  return created;
}

async function materializeOriginalTeacherSubstitutionAbsence(tx: any, params: {
  substituteUserId: string;
  eventId: string | null;
  attendanceDate: Date;
}) {
  if (!params.eventId) return null;

  const rows = await tx.$queryRaw<
    {
      id: string;
      originalTeacherUserId: string;
      reason: string;
      startTime: Date;
      schoolYearId: string | null;
    }[]
  >`
    SELECT s."id", s."originalTeacherUserId", s."reason", s."startTime", e."schoolYearId"
    FROM "Substitution" s
    JOIN "Event" e ON e."id" = s."eventId"
    WHERE s."eventId" = ${params.eventId}
      AND s."substituteUserId" = ${params.substituteUserId}
      AND s."date" = ${params.attendanceDate}
    LIMIT 1
  `;
  const substitution = rows[0];
  if (!substitution) return null;

  const notes = `Ausencia prevista sin justificar (suplida): ${substitution.reason || "clase cubierta oficialmente"}`;
  const existing = await tx.attendance.findFirst({
    where: {
      userId: substitution.originalTeacherUserId,
      eventId: params.eventId,
      date: params.attendanceDate,
      type: "CHECK_IN",
    },
    select: { id: true },
  });

  if (existing) {
    return tx.attendance.update({
      where: { id: existing.id },
      data: {
        status: "SUBSTITUTED" as any,
        time: substitution.startTime,
        schoolYearId: substitution.schoolYearId ?? undefined,
        notes,
      },
      select: { id: true },
    });
  }

  return tx.attendance.create({
    data: {
      userId: substitution.originalTeacherUserId,
      eventId: params.eventId,
      schoolYearId: substitution.schoolYearId ?? undefined,
      date: params.attendanceDate,
      time: substitution.startTime,
      type: "CHECK_IN",
      status: "SUBSTITUTED" as any,
      notes,
    },
    select: { id: true },
  });
}

function slotReference(slot: ClassEventSlot) {
  return {
    id: slot.id,
    title: slot.title,
    type: slot.type,
    startTime: slot.startTime,
    endTime: slot.endTime,
  };
}

function findOverlappingSlot(slots: ClassEventSlot[], at: Date) {
  const atMs = at.getTime();
  const slot = [...slots]
    .filter((candidate) => candidate.startTime.getTime() <= atMs && candidate.endTime.getTime() >= atMs)
    .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())[0];
  return slot ? slotReference(slot) : null;
}

function findNearSlot(slots: ClassEventSlot[], at: Date, earlyWindowMinutes: number) {
  const atMs = at.getTime();
  const latestStartMs = atMs + earlyWindowMinutes * 60 * 1000;
  const candidates = slots
    .filter((slot) => slot.startTime.getTime() <= latestStartMs && slot.endTime.getTime() >= atMs)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  if (!candidates.length) return null;

  const active = candidates
    .filter((slot) => slot.startTime.getTime() <= atMs)
    .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  return slotReference(active[0] ?? candidates[0]);
}

/**
 * Vincula una marca biométrica a UNA ocurrencia por solape simple del instante con la clase.
 * Ya no fragmenta la jornada en bloques ni materializa asistencias para otras clases del día:
 * la cobertura del resto se deriva en lectura por spans (coverage-spans).
 */
export async function resolveBiometricAttendanceLinkage(
  tx: any,
  params: {
    userId: string;
    occurredAt: Date;
    punchType: "CHECK_IN" | "CHECK_OUT";
    attendanceDate: Date;
    earlyWindowMinutes: number;
  },
) {
  const { userId, occurredAt, punchType, attendanceDate, earlyWindowMinutes } = params;
  const slots = await fetchTeacherClassSlotsForUruguayDay(tx, userId, attendanceDate);

  // Caso normal: la marca cae dentro del horario de una clase asignada o suplida.
  const overlapping = findOverlappingSlot(slots, occurredAt) ?? await findAssignedEventForAttendanceInstant(tx, userId, occurredAt);
  if (overlapping?.id) {
    return punchType === "CHECK_IN"
      ? { attendanceEventId: overlapping.id, lateReference: overlapping, exitReference: null }
      : { attendanceEventId: overlapping.id, lateReference: null, exitReference: overlapping };
  }

  if (punchType === "CHECK_IN") {
    // Entrada anticipada: próxima clase o suplencia dentro de la ventana temprana.
    const near = findNearSlot(slots, occurredAt, earlyWindowMinutes) ??
      await findAssignedEventNearAttendanceInstant(tx, userId, occurredAt, earlyWindowMinutes);
    return { attendanceEventId: near?.id ?? null, lateReference: near, exitReference: null };
  }

  // Salida fuera de toda clase: anclar al último evento iniciado del día cubierto por la permanencia.
  const previousSlot = [...slots]
    .filter((slot) => slot.startTime.getTime() <= occurredAt.getTime())
    .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())[0];
  if (previousSlot) {
    return { attendanceEventId: previousSlot.id, lateReference: null, exitReference: previousSlot };
  }

  // Fallback: anclar a la clase del CHECK_IN abierto, si lo hay.
  const openId = await getOpenCheckInAnchorEventId(tx, userId, attendanceDate);
  if (openId) {
    const anchor = await tx.event.findUnique({
      where: { id: openId },
      select: { id: true, title: true, type: true, startTime: true, endTime: true },
    });
    if (anchor) return { attendanceEventId: anchor.id, lateReference: null, exitReference: anchor };
  }
  const near = findNearSlot(slots, occurredAt, earlyWindowMinutes) ??
    await findAssignedEventNearAttendanceInstant(tx, userId, occurredAt, earlyWindowMinutes);
  return { attendanceEventId: near?.id ?? null, lateReference: null, exitReference: near };
}

export type BiometricIngestParams = {
  deviceDbId: string;
  deviceCode: string;
  deviceUserId: string;
  occurredAt: Date;
  externalId?: string;
  punchType?: "CHECK_IN" | "CHECK_OUT";
  payload: unknown;
};

export type BiometricIngestResult =
  | { ok: true; duplicate: boolean; punchId: string; attendanceId?: string | null; isLate?: boolean; attendance?: unknown }
  | { ok: false; reason: "NO_MAPPING"; punchId: string }
  | { ok: false; reason: "LICENSE_BLOCKED"; punchId: string }
  | { ok: false; reason: "NON_WORKING_DAY"; punchId: string };

export async function findBiometricDeviceByCode(code: string) {
  return prisma.biometricDevice.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      secretHash: true,
      allowedIps: true,
      timezone: true,
      admsSerial: true,
    },
  });
}

/** Resuelve dispositivo por número de serie ADMS (SN) o por código interno. */
export async function findBiometricDeviceByAdmsSn(sn: string) {
  return prisma.biometricDevice.findFirst({
    where: {
      isActive: true,
      OR: [{ code: sn }, { admsSerial: sn }],
    },
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      secretHash: true,
      allowedIps: true,
      timezone: true,
      admsSerial: true,
    },
  });
}

export async function processBiometricIngest(params: BiometricIngestParams): Promise<BiometricIngestResult> {
  const { deviceDbId, deviceCode, deviceUserId, occurredAt, externalId, punchType, payload } = params;

  const mapping = await prisma.biometricUserMapping.findFirst({
    where: { deviceId: deviceDbId, deviceUserId, isActive: true },
    select: { id: true, userId: true },
  });

  if (!mapping) {
    const rejectedPunch = await prisma.biometricPunch.create({
      data: {
        deviceId: deviceDbId,
        deviceUserId,
        externalId,
        occurredAt,
        punchType: "UNKNOWN",
        processStatus: "FAILED",
        processError: "No existe mapeo activo para deviceUserId",
        payload: payload as object,
      },
      select: { id: true },
    });
    return { ok: false, reason: "NO_MAPPING", punchId: rejectedPunch.id };
  }

  const attendanceDate = uruguayStartOfDayFromInstant(occurredAt);
  const runtimeSettings = await getAttendanceOperationalSettings();
  const earlyWindow = earlyEntryWindowMinutes(runtimeSettings.classBridgeGapMinutes);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.biometricPunch.findUnique({
        where: {
          deviceId_deviceUserId_occurredAt: {
            deviceId: deviceDbId,
            deviceUserId,
            occurredAt,
          },
        },
        select: { id: true, attendanceId: true },
      });
      if (existing) {
        return { duplicate: true as const, punchId: existing.id, attendanceId: existing.attendanceId };
      }

      // Día no laborable (feriado / no laborable institucional): no se admiten fichadas.
      // Se resuelve por la fecha civil de Uruguay (attendanceDate ya es el inicio de día UY).
      if (await isNonWorkingDate(attendanceDate)) {
        const blockedPunch = await tx.biometricPunch.create({
          data: {
            deviceId: deviceDbId,
            mappingId: mapping.id,
            userId: mapping.userId,
            deviceUserId,
            externalId,
            occurredAt,
            punchType: punchType ?? "UNKNOWN",
            processStatus: "FAILED",
            processError: "Marcación en día no laborable / feriado",
            payload: payload as object,
          },
          select: { id: true },
        });
        return { blockedByNonWorkingDay: true as const, punchId: blockedPunch.id };
      }

      const licBio = await findApprovedLicenseCoveringEventTime(mapping.userId, occurredAt, occurredAt);
      if (licBio) {
        const blockedPunch = await tx.biometricPunch.create({
          data: {
            deviceId: deviceDbId,
            mappingId: mapping.id,
            userId: mapping.userId,
            deviceUserId,
            externalId,
            occurredAt,
            punchType: punchType ?? "UNKNOWN",
            processStatus: "FAILED",
            processError: "Marcación bloqueada por licencia médica activa",
            payload: payload as object,
          },
          select: { id: true },
        });
        return { blockedByLicense: true as const, punchId: blockedPunch.id };
      }

      let resolvedType: "CHECK_IN" | "CHECK_OUT" = punchType ?? "CHECK_IN";
      const lastAttendance = await tx.attendance.findFirst({
        where: { userId: mapping.userId, date: attendanceDate },
        orderBy: { time: "desc" },
        select: { id: true, type: true, time: true },
      });

      if (!punchType && lastAttendance && isWithinDuplicateWindow(occurredAt, lastAttendance.time, runtimeSettings.biometricDuplicateWindowMinutes)) {
        const duplicateType = lastAttendance.type;
        const duplicatePunch = await createDuplicatePunch(tx, {
          deviceDbId,
          mappingId: mapping.id,
          userId: mapping.userId,
          deviceUserId,
          externalId,
          occurredAt,
          punchType: duplicateType,
          processError: `Marcación ${duplicateType} repetida dentro de ${runtimeSettings.biometricDuplicateWindowMinutes} min`,
          payload,
        });

        if (duplicateType === "CHECK_OUT" && occurredAt.getTime() > new Date(lastAttendance.time).getTime()) {
          const linkage = await resolveBiometricAttendanceLinkage(tx, {
            userId: mapping.userId,
            occurredAt,
            punchType: "CHECK_OUT",
            attendanceDate,
            earlyWindowMinutes: earlyWindow,
          });
          const status = getAttendanceStatus({
            type: "CHECK_OUT",
            actualTime: occurredAt,
            endTime: linkage.exitReference?.endTime,
            hasApprovedLicense: false,
            lateToleranceMinutes: runtimeSettings.earlyExitToleranceMinutes,
          });
          const dupSchoolYearId = await resolveAttendanceSchoolYearId(tx, linkage.attendanceEventId);
          await tx.attendance.update({
            where: { id: lastAttendance.id },
            data: {
              date: attendanceDate,
              time: occurredAt,
              eventId: linkage.attendanceEventId || undefined,
              schoolYearId: dupSchoolYearId ?? undefined,
              status: status as any,
              notes: buildBiometricAttendancePayload({
                userId: mapping.userId,
                attendanceDate,
                attendanceTime: occurredAt,
                deviceId: deviceCode,
                eventId: linkage.attendanceEventId || undefined,
                status: status as any,
                type: "CHECK_OUT",
              }).notes,
            },
          });
        }

        return { duplicate: true as const, punchId: duplicatePunch.id, attendanceId: lastAttendance.id };
      }

      if (!punchType) {
        resolvedType = !lastAttendance || lastAttendance.type === "CHECK_OUT" ? "CHECK_IN" : "CHECK_OUT";
      } else {
        const windowStart = new Date(occurredAt.getTime() - runtimeSettings.biometricDuplicateWindowMinutes * 60 * 1000);
        const windowEnd = new Date(occurredAt.getTime() + runtimeSettings.biometricDuplicateWindowMinutes * 60 * 1000);
        const repeatedSameType =
          runtimeSettings.biometricDuplicateWindowMinutes > 0
            ? await tx.attendance.findFirst({
                where: {
                  userId: mapping.userId,
                  date: attendanceDate,
                  type: punchType,
                  time: { gte: windowStart, lte: windowEnd },
                },
                orderBy: { time: punchType === "CHECK_IN" ? "asc" : "desc" },
                select: { id: true, type: true, time: true },
              })
            : null;

        if (repeatedSameType) {
          const duplicatePunch = await createDuplicatePunch(tx, {
            deviceDbId,
            mappingId: mapping.id,
            userId: mapping.userId,
            deviceUserId,
            externalId,
            occurredAt,
            punchType,
            processError: `Marcación ${punchType} repetida dentro de ${runtimeSettings.biometricDuplicateWindowMinutes} min`,
            payload,
          });

          if (punchType === "CHECK_OUT" && occurredAt.getTime() > new Date(repeatedSameType.time).getTime()) {
            const linkage = await resolveBiometricAttendanceLinkage(tx, {
              userId: mapping.userId,
              occurredAt,
              punchType: "CHECK_OUT",
              attendanceDate,
              earlyWindowMinutes: earlyWindow,
            });
            const status = getAttendanceStatus({
              type: "CHECK_OUT",
              actualTime: occurredAt,
              endTime: linkage.exitReference?.endTime,
              hasApprovedLicense: false,
              lateToleranceMinutes: runtimeSettings.earlyExitToleranceMinutes,
            });
            const dupSchoolYearId = await resolveAttendanceSchoolYearId(tx, linkage.attendanceEventId);
            await tx.attendance.update({
              where: { id: repeatedSameType.id },
              data: {
                date: attendanceDate,
                time: occurredAt,
                eventId: linkage.attendanceEventId || undefined,
                schoolYearId: dupSchoolYearId ?? undefined,
                status: status as any,
                notes: buildBiometricAttendancePayload({
                  userId: mapping.userId,
                  attendanceDate,
                  attendanceTime: occurredAt,
                  deviceId: deviceCode,
                  eventId: linkage.attendanceEventId || undefined,
                  status: status as any,
                  type: "CHECK_OUT",
                }).notes,
              },
            });
          }

          return { duplicate: true as const, punchId: duplicatePunch.id, attendanceId: repeatedSameType.id };
        }
      }

      const linkage = await resolveBiometricAttendanceLinkage(tx, {
        userId: mapping.userId,
        occurredAt,
        punchType: resolvedType,
        attendanceDate,
        earlyWindowMinutes: earlyWindow,
      });
      const openCheckInForCheckout =
        resolvedType === "CHECK_OUT" ? await getOpenCheckInAttendance(tx, mapping.userId, attendanceDate) : null;
      const lateRef = linkage.lateReference;
      const isLate =
        resolvedType === "CHECK_IN"
          ? lateRef?.startTime
            ? isLateAgainstEventStart(occurredAt, lateRef.startTime, runtimeSettings.lateToleranceMinutes)
            : false
          : false;
      const minutesLate = resolvedType === "CHECK_IN" ? minutesLateAgainstEventStart(occurredAt, lateRef?.startTime) : null;
      const isVeryLate =
        resolvedType === "CHECK_IN" &&
        isLate &&
        isVeryLateArrival(minutesLate, runtimeSettings.noShowGraceMinutes);
      const computedStatus =
        resolvedType === "CHECK_OUT"
          ? getAttendanceStatus({
              type: "CHECK_OUT",
              actualTime: occurredAt,
              endTime: linkage.exitReference?.endTime,
              hasApprovedLicense: false,
              lateToleranceMinutes: runtimeSettings.earlyExitToleranceMinutes,
            })
          : isLate
            ? "LATE"
            : "PRESENT";
      const status = linkage.attendanceEventId ? computedStatus : "OUT_OF_SCHEDULE";
      const schoolYearId = await resolveAttendanceSchoolYearId(tx, linkage.attendanceEventId);

      const existingEventAttendance = linkage.attendanceEventId
        ? await tx.attendance.findFirst({
            where: {
              userId: mapping.userId,
              date: { gte: attendanceDate, lte: endOfUtcDay(attendanceDate) },
              eventId: linkage.attendanceEventId,
              type: resolvedType,
            },
            select: { id: true, type: true, time: true },
          })
        : null;

      if (existingEventAttendance) {
        const duplicatePunch = await createDuplicatePunch(tx, {
          deviceDbId,
          mappingId: mapping.id,
          userId: mapping.userId,
          deviceUserId,
          externalId,
          occurredAt,
          punchType: resolvedType,
          processError: `Marcación ${resolvedType} repetida para el mismo evento`,
          payload,
        });

        if (resolvedType === "CHECK_OUT" && occurredAt.getTime() > new Date(existingEventAttendance.time).getTime()) {
          await tx.attendance.update({
            where: { id: existingEventAttendance.id },
            data: {
              time: occurredAt,
              schoolYearId: schoolYearId ?? undefined,
              status: status as any,
              notes: buildBiometricAttendancePayload({
                userId: mapping.userId,
                attendanceDate,
                attendanceTime: occurredAt,
                deviceId: deviceCode,
                eventId: linkage.attendanceEventId,
                status: status as any,
                type: "CHECK_OUT",
              }).notes,
            },
          });
        }

        return { duplicate: true as const, punchId: duplicatePunch.id, attendanceId: existingEventAttendance.id };
      }

      const attendance = await tx.attendance.create({
        data: {
          ...buildBiometricAttendancePayload({
            userId: mapping.userId,
            attendanceDate,
            attendanceTime: occurredAt,
            deviceId: deviceCode,
            eventId: linkage.attendanceEventId || undefined,
            schoolYearId,
            isLate,
            status: status as any,
            type: resolvedType,
          }),
          ...(!linkage.attendanceEventId
            ? {
                notes: `Marcación sin horario asignado - Dispositivo: ${deviceCode || "N/A"}`,
              }
            : {}),
          ...(isVeryLate && minutesLate !== null
            ? { notes: `Llegada muy tarde: ${minutesLate} min tarde - Dispositivo: ${deviceCode || "N/A"}` }
            : {}),
        },
        select: { id: true, type: true, status: true, date: true, time: true, eventId: true, notes: true },
      });

      if (resolvedType === "CHECK_IN" && linkage.attendanceEventId) {
        await materializeOriginalTeacherSubstitutionAbsence(tx, {
          substituteUserId: mapping.userId,
          eventId: linkage.attendanceEventId,
          attendanceDate,
        });
      }

      const punch = await tx.biometricPunch.create({
        data: {
          deviceId: deviceDbId,
          mappingId: mapping.id,
          userId: mapping.userId,
          attendanceId: attendance.id,
          deviceUserId,
          externalId,
          occurredAt,
          punchType: resolvedType,
          processStatus: "PROCESSED",
          payload: payload as object,
        },
        select: { id: true },
      });

      if (resolvedType === "CHECK_OUT") {
        if (openCheckInForCheckout) {
          await materializeCoveredEventAttendances(tx, {
            userId: mapping.userId,
            attendanceDate,
            checkIn: openCheckInForCheckout,
            checkOut: { time: occurredAt },
            deviceCode,
          });
        } else {
          await createSequenceIncidentIfMissing(tx, {
            userId: mapping.userId,
            attendanceId: attendance.id,
            attendanceDate,
            occurredAt,
          });
        }
      }

      await tx.biometricDevice.update({
        where: { id: deviceDbId },
        data: { lastSeenAt: new Date() },
      });

      return { duplicate: false as const, punchId: punch.id, attendance, isLate };
    });

    if ("blockedByNonWorkingDay" in created) {
      return { ok: false, reason: "NON_WORKING_DAY", punchId: created.punchId };
    }

    if ("blockedByLicense" in created) {
      return { ok: false, reason: "LICENSE_BLOCKED", punchId: created.punchId };
    }

    if (created.duplicate) {
      return {
        ok: true,
        duplicate: true,
        punchId: created.punchId,
        attendanceId: created.attendanceId,
      };
    }

    return {
      ok: true,
      duplicate: false,
      punchId: created.punchId,
      attendance: created.attendance,
      isLate: created.isLate,
    };
  } catch (error: any) {
    if (error?.code === "P2002") {
      return { ok: true, duplicate: true, punchId: "duplicate" };
    }
    throw error;
  }
}
