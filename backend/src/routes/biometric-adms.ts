import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "../prisma.js";
import { buildBiometricAttendancePayload } from "../attendance-logic.js";
import { findApprovedLicenseCoveringEventTime } from "../services/medicalLeaveReconciliation.js";
import {
  findAssignedEventForAttendanceInstant,
  maybeCreateLateArrivalIncident,
  resolveNoShowIncidentsForEvents,
} from "../services/attendance-incidents.js";
import {
  buildContiguousClassBlocks,
  earlyEntryWindowMinutes,
  fetchTeacherClassSlotsForUruguayDay,
  findBlockContainingEventId,
  findBlockContainingInstant,
} from "../services/teacher-class-blocks.js";
import { uruguayStartOfDayFromInstant } from "../app-timezone.js";
import { getAttendanceOperationalSettings, isBiometricLateBySettings } from "../system-settings.js";

const r = Router();

const admsIngestSchema = z.object({
  deviceCode: z.string().min(2).max(100),
  deviceUserId: z.string().min(1).max(100),
  timestamp: z.string().datetime(),
  externalId: z.string().min(1).max(150).optional(),
  punchType: z.enum(["CHECK_IN", "CHECK_OUT"]).optional(),
  payload: z.unknown().optional(),
});

function hashSecret(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function isSecretValid(storedHash: string, providedRaw: string) {
  const providedHash = hashSecret(providedRaw);
  const a = Buffer.from(storedHash);
  const b = Buffer.from(providedHash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function normalizeIp(ip: string | undefined) {
  if (!ip) return "";
  return ip.replace("::ffff:", "").trim();
}

function resolveRequestIp(req: any) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    ?.trim();
  return normalizeIp(forwarded || req.ip || req.connection?.remoteAddress || "");
}

function isLateAgainstEventStart(attendanceTime: Date, eventStartTime: Date | null | undefined, toleranceMinutes: number) {
  if (!eventStartTime) return false;
  const minsLate = Math.floor((attendanceTime.getTime() - new Date(eventStartTime).getTime()) / (1000 * 60));
  return minsLate > toleranceMinutes;
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

async function resolveBiometricAttendanceLinkage(
  tx: any,
  params: {
    userId: string;
    occurredAt: Date;
    punchType: "CHECK_IN" | "CHECK_OUT";
    attendanceDate: Date;
    bridgeGapMinutes: number;
  },
): Promise<{
  attendanceEventId: string | undefined;
  lateReference: { id: string; title: string; type: string; startTime: Date; endTime: Date } | null;
  blockEventIds: string[];
}> {
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
        blockEventIds: block.map((e) => e.id),
      };
    }
    const fb = await findAssignedEventForAttendanceInstant(tx, userId, occurredAt);
    return {
      attendanceEventId: fb?.id,
      lateReference: fb,
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
        blockEventIds: block.map((e) => e.id),
      };
    }
  }
  const fb = await findAssignedEventForAttendanceInstant(tx, userId, occurredAt);
  return {
    attendanceEventId: fb?.id,
    lateReference: null,
    blockEventIds: fb?.id ? [fb.id] : [],
  };
}

r.post("/adms-ingest", async (req, res) => {
  const parsed = admsIngestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Payload ADMS inválido", errors: parsed.error.errors });
  }

  const ingestSecret = String(req.headers["x-biometric-secret"] || "");
  if (!ingestSecret) {
    return res.status(401).json({ message: "Falta x-biometric-secret" });
  }

  const { deviceCode, deviceUserId, timestamp, externalId, punchType, payload } = parsed.data;
  const occurredAt = new Date(timestamp);
  const requestIp = resolveRequestIp(req);

  const device = await prisma.biometricDevice.findUnique({
    where: { code: deviceCode },
    select: {
      id: true,
      name: true,
      isActive: true,
      secretHash: true,
      allowedIps: true,
    },
  });
  if (!device || !device.isActive) {
    return res.status(401).json({ message: "Dispositivo biométrico no autorizado" });
  }

  if (!isSecretValid(device.secretHash, ingestSecret)) {
    return res.status(401).json({ message: "Credenciales de dispositivo inválidas" });
  }

  if (device.allowedIps.length > 0 && !device.allowedIps.includes(requestIp)) {
    return res.status(403).json({ message: "IP de origen no permitida para este dispositivo" });
  }

  const mapping = await prisma.biometricUserMapping.findFirst({
    where: { deviceId: device.id, deviceUserId, isActive: true },
    select: { id: true, userId: true },
  });

  if (!mapping) {
    const rejectedPunch = await prisma.biometricPunch.create({
      data: {
        deviceId: device.id,
        deviceUserId,
        externalId,
        occurredAt,
        punchType: "UNKNOWN",
        processStatus: "FAILED",
        processError: "No existe mapeo activo para deviceUserId",
        payload: (payload ?? req.body) as object,
      },
      select: { id: true },
    });
    return res.status(422).json({
      message: "No existe mapeo biométrico para el usuario del dispositivo",
      punchId: rejectedPunch.id,
    });
  }

  const attendanceDate = uruguayStartOfDayFromInstant(occurredAt);
  const runtimeSettings = await getAttendanceOperationalSettings();

  try {
    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.biometricPunch.findUnique({
        where: {
          deviceId_deviceUserId_occurredAt: {
            deviceId: device.id,
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
            deviceId: device.id,
            mappingId: mapping.id,
            userId: mapping.userId,
            deviceUserId,
            externalId,
            occurredAt,
            punchType: punchType ?? "UNKNOWN",
            processStatus: "FAILED",
            processError: "Marcación bloqueada por licencia médica activa",
            payload: (payload ?? req.body) as object,
          },
          select: { id: true },
        });
        return { blockedByLicense: true as const, punchId: blockedPunch.id };
      }

      let resolvedType: "CHECK_IN" | "CHECK_OUT" = punchType ?? "CHECK_IN";
      if (!punchType) {
        const lastRow = await tx.attendance.findFirst({
          where: { userId: mapping.userId, date: attendanceDate },
          orderBy: { time: "desc" },
          select: { type: true },
        });
        resolvedType = !lastRow || lastRow.type === "CHECK_OUT" ? "CHECK_IN" : "CHECK_OUT";
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
            : isBiometricLateBySettings(occurredAt, runtimeSettings)
          : false;
      const attendance = await tx.attendance.create({
        data: buildBiometricAttendancePayload({
          userId: mapping.userId,
          attendanceDate,
          attendanceTime: occurredAt,
          deviceId: deviceCode,
          eventId: linkage.attendanceEventId || undefined,
          isLate,
          type: resolvedType,
        }),
        select: { id: true, type: true, status: true, date: true, time: true, eventId: true },
      });

      const punch = await tx.biometricPunch.create({
        data: {
          deviceId: device.id,
          mappingId: mapping.id,
          userId: mapping.userId,
          attendanceId: attendance.id,
          deviceUserId,
          externalId,
          occurredAt,
          punchType: resolvedType,
          processStatus: "PROCESSED",
          payload: (payload ?? req.body) as object,
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
      }
      await resolveNoShowIncidentsForEvents(tx, mapping.userId, linkage.blockEventIds);

      await tx.biometricDevice.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
      });

      return { duplicate: false as const, punchId: punch.id, attendance, isLate };
    });

    if ("blockedByLicense" in created) {
      return res.status(403).json({
        message: "Marcación biométrica no permitida por licencia médica activa",
        punchId: created.punchId,
      });
    }

    if (created.duplicate) {
      return res.status(200).json({
        message: "Evento biométrico duplicado (idempotencia aplicada)",
        duplicate: true,
        punchId: created.punchId,
        attendanceId: created.attendanceId,
      });
    }

    return res.status(201).json({
      message: "Marcación biométrica procesada",
      duplicate: false,
      punchId: created.punchId,
      attendance: created.attendance,
      isLate: created.isLate,
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return res.status(200).json({
        message: "Evento biométrico duplicado (idempotencia aplicada)",
        duplicate: true,
      });
    }
    console.error("Error procesando ADMS:", error);
    return res.status(500).json({ message: "Error interno procesando ADMS" });
  }
});

export default r;
