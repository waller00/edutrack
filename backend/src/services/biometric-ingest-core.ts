import crypto from "crypto";
import { prisma } from "../db/prisma.js";
import { buildBiometricAttendancePayload, getAttendanceStatus } from "../attendance/attendance-logic.js";
import { uruguayStartOfDayFromInstant } from "../config/app-timezone.js";
import { getAttendanceOperationalSettings } from "../config/system-settings.js";
import { findApprovedLicenseCoveringEventTime } from "./medicalLeaveReconciliation.js";
import {
  findOpenNoShowIncidentForEvents,
  findAssignedEventForAttendanceInstant,
  findAssignedEventNearAttendanceInstant,
  maybeCreateEarlyExitIncident,
  maybeCreateLateArrivalIncident,
  resolveNoShowIncidentsForEvents,
} from "./attendance-incidents.js";
import {
  buildContiguousClassBlocks,
  earlyEntryWindowMinutes,
  fetchTeacherClassSlotsForUruguayDay,
  findBlockContainingEventId,
  findBlockContainingInstant,
} from "./teacher-class-blocks.js";

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

async function materializeAttendanceForBlockEvents(
  tx: any,
  params: {
    userId: string;
    attendanceDate: Date;
    attendanceTime: Date;
    type: "CHECK_IN" | "CHECK_OUT";
    anchorEventId?: string | null;
    blockEventIds: string[];
    deviceCode: string;
    lateToleranceMinutes: number;
    earlyExitToleranceMinutes: number;
  },
) {
  const ids = Array.from(new Set(params.blockEventIds.filter((id) => id && id !== params.anchorEventId)));
  if (ids.length === 0) return 0;

  const events = await tx.event.findMany({
    where: { id: { in: ids } },
    select: { id: true, startTime: true, endTime: true },
  });

  let created = 0;
  for (const ev of events) {
    const existing = await tx.attendance.findFirst({
      where: {
        userId: params.userId,
        date: params.attendanceDate,
        type: params.type,
        eventId: ev.id,
      },
      select: { id: true },
    });
    if (existing) continue;

    const status =
      params.type === "CHECK_IN"
        ? getAttendanceStatus({
            type: "CHECK_IN",
            actualTime: params.attendanceTime,
            startTime: ev.startTime,
            hasApprovedLicense: false,
            lateToleranceMinutes: params.lateToleranceMinutes,
          })
        : getAttendanceStatus({
            type: "CHECK_OUT",
            actualTime: params.attendanceTime,
            endTime: ev.endTime,
            hasApprovedLicense: false,
            lateToleranceMinutes: params.earlyExitToleranceMinutes,
          });

    await tx.attendance.create({
      data: buildBiometricAttendancePayload({
        userId: params.userId,
        attendanceDate: params.attendanceDate,
        attendanceTime: params.attendanceTime,
        deviceId: params.deviceCode,
        eventId: ev.id,
        status: status as any,
        type: params.type,
      }),
    });
    created += 1;
  }

  return created;
}

export async function resolveBiometricAttendanceLinkage(
  tx: any,
  params: {
    userId: string;
    occurredAt: Date;
    punchType: "CHECK_IN" | "CHECK_OUT";
    attendanceDate: Date;
    bridgeGapMinutes: number;
  },
) {
  const { userId, occurredAt, punchType, attendanceDate, bridgeGapMinutes } = params;
  const slots = await fetchTeacherClassSlotsForUruguayDay(tx, userId, occurredAt);
  const blocks = buildContiguousClassBlocks(slots, bridgeGapMinutes);
  const early = earlyEntryWindowMinutes(bridgeGapMinutes);

  if (punchType === "CHECK_IN") {
    const block = findBlockContainingInstant(occurredAt, blocks, early);
    if (block?.length) {
      const first = block[0]!;
      return {
        attendanceEventId: first.id,
        lateReference: first,
        exitReference: null,
        blockEventIds: block.map((e) => e.id),
      };
    }
    const near = await findAssignedEventNearAttendanceInstant(tx, userId, occurredAt, early);
    if (near?.id) {
      return {
        attendanceEventId: near.id,
        lateReference: near,
        exitReference: null,
        blockEventIds: [near.id],
      };
    }
    const fb = await findAssignedEventForAttendanceInstant(tx, userId, occurredAt);
    return {
      attendanceEventId: fb?.id,
      lateReference: fb,
      exitReference: null,
      blockEventIds: fb?.id ? [fb.id] : [],
    };
  }

  const openId = await getOpenCheckInAnchorEventId(tx, userId, attendanceDate);
  if (openId) {
    const block = findBlockContainingEventId(openId, blocks);
    if (block?.length) {
      const last = block[block.length - 1]!;
      return {
        attendanceEventId: last.id,
        lateReference: null,
        exitReference: last,
        blockEventIds: block.map((e) => e.id),
      };
    }
  }
  const fb =
    (await findAssignedEventNearAttendanceInstant(tx, userId, occurredAt, early)) ??
    (await findAssignedEventForAttendanceInstant(tx, userId, occurredAt));
  return {
    attendanceEventId: fb?.id,
    lateReference: null,
    exitReference: fb,
    blockEventIds: fb?.id ? [fb.id] : [],
  };
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
  | { ok: false; reason: "LICENSE_BLOCKED"; punchId: string };

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
            bridgeGapMinutes: runtimeSettings.classBridgeGapMinutes,
          });
          const status = getAttendanceStatus({
            type: "CHECK_OUT",
            actualTime: occurredAt,
            endTime: linkage.exitReference?.endTime,
            hasApprovedLicense: false,
            lateToleranceMinutes: runtimeSettings.earlyExitToleranceMinutes,
          });
          await tx.attendance.update({
            where: { id: lastAttendance.id },
            data: {
              date: attendanceDate,
              time: occurredAt,
              eventId: linkage.attendanceEventId || undefined,
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
              bridgeGapMinutes: runtimeSettings.classBridgeGapMinutes,
            });
            const status = getAttendanceStatus({
              type: "CHECK_OUT",
              actualTime: occurredAt,
              endTime: linkage.exitReference?.endTime,
              hasApprovedLicense: false,
              lateToleranceMinutes: runtimeSettings.earlyExitToleranceMinutes,
            });
            await tx.attendance.update({
              where: { id: repeatedSameType.id },
              data: {
                date: attendanceDate,
                time: occurredAt,
                eventId: linkage.attendanceEventId || undefined,
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
        bridgeGapMinutes: runtimeSettings.classBridgeGapMinutes,
      });
      const lateRef = linkage.lateReference;
      const isLate =
        resolvedType === "CHECK_IN"
          ? lateRef?.startTime
            ? isLateAgainstEventStart(occurredAt, lateRef.startTime, runtimeSettings.lateToleranceMinutes)
            : false
          : false;
      const openNoShow =
        resolvedType === "CHECK_IN"
          ? await findOpenNoShowIncidentForEvents(tx, mapping.userId, linkage.blockEventIds)
          : null;
      const minutesLate = resolvedType === "CHECK_IN" ? minutesLateAgainstEventStart(occurredAt, lateRef?.startTime) : null;
      const isVeryLate =
        resolvedType === "CHECK_IN" &&
        isLate &&
        (Boolean(openNoShow) || isVeryLateArrival(minutesLate, runtimeSettings.noShowGraceMinutes));
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

      const attendance = await tx.attendance.create({
        data: {
          ...buildBiometricAttendancePayload({
            userId: mapping.userId,
            attendanceDate,
            attendanceTime: occurredAt,
            deviceId: deviceCode,
            eventId: linkage.attendanceEventId || undefined,
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

      if (resolvedType === "CHECK_IN") {
        await maybeCreateLateArrivalIncident({
          tx,
          userId: mapping.userId,
          eventId: lateRef?.id,
          eventType: lateRef?.type,
          eventTitle: lateRef?.title,
          attendanceId: attendance.id,
          biometricPunchId: punch.id,
          attendanceTime: occurredAt,
          eventStartTime: lateRef?.startTime || null,
          lateToleranceMinutes: runtimeSettings.lateToleranceMinutes,
        });
      } else {
        await maybeCreateEarlyExitIncident({
          tx,
          userId: mapping.userId,
          eventId: linkage.exitReference?.id,
          eventType: linkage.exitReference?.type,
          eventTitle: linkage.exitReference?.title,
          attendanceId: attendance.id,
          biometricPunchId: punch.id,
          attendanceTime: occurredAt,
          eventEndTime: linkage.exitReference?.endTime || null,
          earlyExitToleranceMinutes: runtimeSettings.earlyExitToleranceMinutes,
        });
      }

      await materializeAttendanceForBlockEvents(tx, {
        userId: mapping.userId,
        attendanceDate,
        attendanceTime: occurredAt,
        type: resolvedType,
        anchorEventId: attendance.eventId,
        blockEventIds: linkage.blockEventIds,
        deviceCode,
        lateToleranceMinutes: runtimeSettings.lateToleranceMinutes,
        earlyExitToleranceMinutes: runtimeSettings.earlyExitToleranceMinutes,
      });
      await resolveNoShowIncidentsForEvents(tx, mapping.userId, linkage.blockEventIds);

      await tx.biometricDevice.update({
        where: { id: deviceDbId },
        data: { lastSeenAt: new Date() },
      });

      return { duplicate: false as const, punchId: punch.id, attendance, isLate };
    });

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
