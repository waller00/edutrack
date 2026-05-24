import type { Request } from "express";
import { BiometricLinkRequestStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { recordAuditEvent } from "./audit-log.js";

const ACTIVE_STATUSES: BiometricLinkRequestStatus[] = ["WAITING_PUNCH", "PENDING_CONFIRM"];

export function biometricLinkTtlSeconds() {
  const n = Number(process.env.BIOMETRIC_LINK_TTL_SECONDS || 120);
  return Number.isFinite(n) && n >= 30 && n <= 600 ? n : 120;
}

function maxLinkRequestsPerDay() {
  const n = Number(process.env.BIOMETRIC_LINK_MAX_PER_DAY || 20);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 20;
}

export async function expireStaleBiometricLinkRequests() {
  const now = new Date();
  await prisma.biometricLinkRequest.updateMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      expiresAt: { lt: now },
    },
    data: { status: "EXPIRED" },
  });
}

export async function listActiveBiometricDevices() {
  return prisma.biometricDevice.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, admsSerial: true },
  });
}

export async function getUserBiometricMapping(userId: string) {
  return prisma.biometricUserMapping.findFirst({
    where: { userId, isActive: true, device: { isActive: true } },
    select: {
      id: true,
      deviceUserId: true,
      createdAt: true,
      device: { select: { id: true, code: true, name: true } },
    },
  });
}

export async function deactivateUserBiometricMapping(userId: string, req?: Request) {
  const mapping = await prisma.biometricUserMapping.findFirst({
    where: { userId, isActive: true },
    select: { id: true, deviceId: true, deviceUserId: true },
  });
  if (!mapping) {
    return { ok: false as const, reason: "NOT_FOUND" as const };
  }

  await prisma.biometricUserMapping.update({
    where: { id: mapping.id },
    data: { isActive: false },
  });

  recordAuditEvent({
    action: "BIOMETRIC_MAPPING_REMOVED",
    actorUserId: userId,
    req,
    entityType: "BiometricUserMapping",
    entityId: mapping.id,
    metadata: {
      deviceId: mapping.deviceId,
      deviceUserId: mapping.deviceUserId,
    },
  });

  return { ok: true as const };
}

async function countUserLinkRequestsToday(userId: string) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return prisma.biometricLinkRequest.count({
    where: {
      userId,
      createdAt: { gte: start },
      status: { not: "CANCELLED" },
    },
  });
}

async function findActiveLinkOnDevice(deviceId: string, excludeUserId?: string) {
  return prisma.biometricLinkRequest.findFirst({
    where: {
      deviceId,
      status: { in: ACTIVE_STATUSES },
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
    select: { id: true, userId: true, status: true },
  });
}

export async function createBiometricLinkRequest(params: {
  userId: string;
  deviceId?: string;
  deviceCode?: string;
  actorIp?: string;
  req?: Request;
}) {
  await expireStaleBiometricLinkRequests();

  const { userId, deviceId, deviceCode, actorIp, req } = params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, isApproved: true, orgRole: { select: { code: true } } },
  });
  if (!user?.isActive || !user.isApproved) {
    return { ok: false as const, reason: "USER_INACTIVE" as const };
  }
  if (user.orgRole.code === "STUDENT") {
    return { ok: false as const, reason: "ROLE_NOT_ALLOWED" as const };
  }

  const existingMapping = await getUserBiometricMapping(userId);
  if (existingMapping) {
    return {
      ok: false as const,
      reason: "ALREADY_LINKED" as const,
      mapping: existingMapping,
    };
  }

  const todayCount = await countUserLinkRequestsToday(userId);
  if (todayCount >= maxLinkRequestsPerDay()) {
    return { ok: false as const, reason: "RATE_LIMIT" as const };
  }

  let device = null as { id: string; code: string; name: string } | null;
  if (deviceId) {
    device = await prisma.biometricDevice.findFirst({
      where: { id: deviceId, isActive: true },
      select: { id: true, code: true, name: true },
    });
  } else if (deviceCode) {
    device = await prisma.biometricDevice.findFirst({
      where: { code: deviceCode, isActive: true },
      select: { id: true, code: true, name: true },
    });
  } else {
    const devices = await listActiveBiometricDevices();
    if (devices.length === 1) {
      device = devices[0]!;
    } else if (devices.length === 0) {
      return { ok: false as const, reason: "NO_DEVICES" as const };
    } else {
      return { ok: false as const, reason: "DEVICE_REQUIRED" as const, devices };
    }
  }

  if (!device) {
    return { ok: false as const, reason: "DEVICE_NOT_FOUND" as const };
  }

  const otherActive = await findActiveLinkOnDevice(device.id);
  if (otherActive) {
    return { ok: false as const, reason: "DEVICE_BUSY" as const };
  }

  await prisma.biometricLinkRequest.updateMany({
    where: { userId, status: { in: ACTIVE_STATUSES } },
    data: { status: "CANCELLED" },
  });

  const expiresAt = new Date(Date.now() + biometricLinkTtlSeconds() * 1000);
  const linkRequest = await prisma.biometricLinkRequest.create({
    data: {
      userId,
      deviceId: device.id,
      status: "WAITING_PUNCH",
      expiresAt,
      createdByIp: actorIp?.slice(0, 45) || null,
    },
    include: {
      device: { select: { id: true, code: true, name: true } },
    },
  });

  recordAuditEvent({
    action: "BIOMETRIC_LINK_STARTED",
    actorUserId: userId,
    req,
    entityType: "BiometricLinkRequest",
    entityId: linkRequest.id,
    metadata: { deviceId: device.id, deviceCode: device.code, expiresAt: expiresAt.toISOString() },
  });

  return { ok: true as const, linkRequest };
}

export async function getActiveBiometricLinkRequest(userId: string) {
  await expireStaleBiometricLinkRequests();

  const linkRequest = await prisma.biometricLinkRequest.findFirst({
    where: {
      userId,
      status: { in: ACTIVE_STATUSES },
    },
    orderBy: { createdAt: "desc" },
    include: {
      device: { select: { id: true, code: true, name: true } },
    },
  });

  if (!linkRequest) {
    return null;
  }

  if (linkRequest.expiresAt < new Date()) {
    await prisma.biometricLinkRequest.update({
      where: { id: linkRequest.id },
      data: { status: "EXPIRED" },
    });
    return { ...linkRequest, status: "EXPIRED" as const };
  }

  return linkRequest;
}

export type TryCaptureLinkPunchParams = {
  deviceDbId: string;
  deviceCode: string;
  deviceUserId: string;
  occurredAt: Date;
  externalId: string;
  punchType?: "CHECK_IN" | "CHECK_OUT";
  payload: unknown;
};

/**
 * Si hay una solicitud WAITING_PUNCH en el dispositivo, captura el PIN de la marca.
 */
export async function tryCaptureBiometricLinkPunch(params: TryCaptureLinkPunchParams) {
  await expireStaleBiometricLinkRequests();

  const { deviceDbId, deviceUserId, occurredAt, externalId, punchType, payload } = params;

  const linkRequest = await prisma.biometricLinkRequest.findFirst({
    where: {
      deviceId: deviceDbId,
      status: "WAITING_PUNCH",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, isActive: true, isApproved: true } },
    },
  });

  if (!linkRequest) {
    return { handled: false as const };
  }

  const existingPinMapping = await prisma.biometricUserMapping.findFirst({
    where: { deviceId: deviceDbId, deviceUserId, isActive: true },
    select: { id: true, userId: true },
  });
  if (existingPinMapping && existingPinMapping.userId !== linkRequest.userId) {
    console.warn("[biometric-link] PIN ya vinculado a otro usuario", {
      deviceUserId,
      deviceId: deviceDbId,
      linkUserId: linkRequest.userId,
      ownerUserId: existingPinMapping.userId,
    });
    return { handled: false as const, reason: "PIN_TAKEN" as const };
  }

  const punch = await prisma.biometricPunch.create({
    data: {
      deviceId: deviceDbId,
      userId: linkRequest.userId,
      deviceUserId,
      externalId,
      occurredAt,
      punchType: punchType ?? "UNKNOWN",
      processStatus: "LINK_CAPTURED",
      processError: "Pendiente de confirmación de vínculo",
      payload: payload as object,
    },
    select: { id: true },
  });

  await prisma.biometricLinkRequest.update({
    where: { id: linkRequest.id },
    data: {
      status: "PENDING_CONFIRM",
      candidateDeviceUserId: deviceUserId,
      candidatePunchId: punch.id,
    },
  });

  recordAuditEvent({
    action: "BIOMETRIC_LINK_DETECTED",
    actorUserId: linkRequest.userId,
    entityType: "BiometricLinkRequest",
    entityId: linkRequest.id,
    metadata: {
      deviceId: deviceDbId,
      deviceUserId,
      punchId: punch.id,
    },
  });

  return {
    handled: true as const,
    linkRequestId: linkRequest.id,
    userId: linkRequest.userId,
    deviceUserId,
  };
}

export async function confirmBiometricLinkRequest(params: {
  userId: string;
  linkRequestId: string;
  req?: Request;
}) {
  await expireStaleBiometricLinkRequests();

  const { userId, linkRequestId, req } = params;

  const linkRequest = await prisma.biometricLinkRequest.findUnique({
    where: { id: linkRequestId },
    include: { device: { select: { id: true, code: true, name: true } } },
  });

  if (!linkRequest || linkRequest.userId !== userId) {
    return { ok: false as const, reason: "NOT_FOUND" as const };
  }
  if (linkRequest.status !== "PENDING_CONFIRM") {
    return { ok: false as const, reason: "INVALID_STATUS" as const, status: linkRequest.status };
  }
  if (linkRequest.expiresAt < new Date()) {
    await prisma.biometricLinkRequest.update({
      where: { id: linkRequest.id },
      data: { status: "EXPIRED" },
    });
    return { ok: false as const, reason: "EXPIRED" as const };
  }
  if (!linkRequest.candidateDeviceUserId) {
    return { ok: false as const, reason: "NO_CANDIDATE" as const };
  }

  const deviceUserId = linkRequest.candidateDeviceUserId;
  const deviceId = linkRequest.deviceId;

  const pinTaken = await prisma.biometricUserMapping.findFirst({
    where: {
      deviceId,
      deviceUserId,
      isActive: true,
      userId: { not: userId },
    },
    select: { id: true },
  });
  if (pinTaken) {
    return { ok: false as const, reason: "PIN_TAKEN" as const };
  }

  const mapping = await prisma.$transaction(async (tx) => {
    await tx.biometricUserMapping.updateMany({
      where: { deviceId, userId, isActive: true },
      data: { isActive: false },
    });

    const created = await tx.biometricUserMapping.upsert({
      where: {
        deviceId_userId: { deviceId, userId },
      },
      create: {
        deviceId,
        userId,
        deviceUserId,
        isActive: true,
      },
      update: {
        deviceUserId,
        isActive: true,
      },
      select: { id: true, deviceUserId: true },
    });

    await tx.biometricLinkRequest.update({
      where: { id: linkRequest.id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
      },
    });

    return created;
  });

  recordAuditEvent({
    action: "BIOMETRIC_LINK_CONFIRMED",
    actorUserId: userId,
    req,
    entityType: "BiometricUserMapping",
    entityId: mapping.id,
    metadata: {
      linkRequestId: linkRequest.id,
      deviceId,
      deviceCode: linkRequest.device.code,
      deviceUserId,
    },
  });

  if (linkRequest.candidatePunchId) {
    await prisma.biometricPunch.delete({ where: { id: linkRequest.candidatePunchId } }).catch(() => undefined);
  }

  return {
    ok: true as const,
    mapping: {
      id: mapping.id,
      deviceUserId: mapping.deviceUserId,
      device: linkRequest.device,
    },
  };
}

export async function cancelBiometricLinkRequest(params: {
  userId: string;
  linkRequestId: string;
  req?: Request;
}) {
  const linkRequest = await prisma.biometricLinkRequest.findUnique({
    where: { id: params.linkRequestId },
    select: { id: true, userId: true, status: true, candidatePunchId: true },
  });

  if (!linkRequest || linkRequest.userId !== params.userId) {
    return { ok: false as const, reason: "NOT_FOUND" as const };
  }
  if (!ACTIVE_STATUSES.includes(linkRequest.status)) {
    return { ok: false as const, reason: "INVALID_STATUS" as const };
  }

  await prisma.biometricLinkRequest.update({
    where: { id: linkRequest.id },
    data: { status: "CANCELLED" },
  });

  if (linkRequest.candidatePunchId) {
    await prisma.biometricPunch
      .delete({ where: { id: linkRequest.candidatePunchId } })
      .catch(() => undefined);
  }

  recordAuditEvent({
    action: "BIOMETRIC_LINK_CANCELLED",
    actorUserId: params.userId,
    req: params.req,
    entityType: "BiometricLinkRequest",
    entityId: linkRequest.id,
  });

  return { ok: true as const };
}
