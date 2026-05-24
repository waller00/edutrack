import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    biometricLinkRequest: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    biometricUserMapping: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    biometricDevice: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    biometricPunch: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./audit-log.js", () => ({ recordAuditEvent: vi.fn() }));

import {
  biometricLinkTtlSeconds,
  cancelBiometricLinkRequest,
  createBiometricLinkRequest,
  tryCaptureBiometricLinkPunch,
  confirmBiometricLinkRequest,
} from "./biometric-link.js";

describe("biometric-link service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    prismaMock.biometricLinkRequest.updateMany.mockResolvedValue({ count: 0 });
  });

  it("usa TTL por defecto cuando la variable está fuera de rango", () => {
    vi.stubEnv("BIOMETRIC_LINK_TTL_SECONDS", "10");
    expect(biometricLinkTtlSeconds()).toBe(120);

    vi.stubEnv("BIOMETRIC_LINK_TTL_SECONDS", "601");
    expect(biometricLinkTtlSeconds()).toBe(120);

    vi.stubEnv("BIOMETRIC_LINK_TTL_SECONDS", "90");
    expect(biometricLinkTtlSeconds()).toBe(90);
  });

  it("rechaza estudiantes", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isActive: true,
      isApproved: true,
      orgRole: { code: "STUDENT" },
    });

    const result = await createBiometricLinkRequest({ userId: "u1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ROLE_NOT_ALLOWED");
  });

  it("rechaza usuario inactivo o no aprobado", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isActive: false, isApproved: true, orgRole: { code: "TEACHER" } });

    const result = await createBiometricLinkRequest({ userId: "u1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("USER_INACTIVE");
  });

  it("rechaza si el usuario ya tiene mapeo activo", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isActive: true,
      isApproved: true,
      orgRole: { code: "TEACHER" },
    });
    prismaMock.biometricUserMapping.findFirst.mockResolvedValue({
      id: "m1",
      deviceUserId: "1007",
      createdAt: new Date(),
      device: { id: "dev1", code: "F22-01", name: "F22" },
    });

    const result = await createBiometricLinkRequest({ userId: "u1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ALREADY_LINKED");
  });

  it("pide lector cuando hay varios activos y no se indicó uno", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isActive: true,
      isApproved: true,
      orgRole: { code: "TEACHER" },
    });
    prismaMock.biometricUserMapping.findFirst.mockResolvedValue(null);
    prismaMock.biometricLinkRequest.count.mockResolvedValue(0);
    prismaMock.biometricDevice.findMany.mockResolvedValue([
      { id: "dev1", code: "F22-01", name: "F22 entrada", admsSerial: "SN1" },
      { id: "dev2", code: "F22-02", name: "F22 pasillo", admsSerial: "SN2" },
    ]);

    const result = await createBiometricLinkRequest({ userId: "u1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("DEVICE_REQUIRED");
  });

  it("rechaza cuando no hay lectores activos", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isActive: true,
      isApproved: true,
      orgRole: { code: "TEACHER" },
    });
    prismaMock.biometricUserMapping.findFirst.mockResolvedValue(null);
    prismaMock.biometricLinkRequest.count.mockResolvedValue(0);
    prismaMock.biometricDevice.findMany.mockResolvedValue([]);

    const result = await createBiometricLinkRequest({ userId: "u1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NO_DEVICES");
  });

  it("rechaza si el lector indicado no existe o está ocupado", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isActive: true,
      isApproved: true,
      orgRole: { code: "TEACHER" },
    });
    prismaMock.biometricUserMapping.findFirst.mockResolvedValue(null);
    prismaMock.biometricLinkRequest.count.mockResolvedValue(0);
    prismaMock.biometricDevice.findFirst.mockResolvedValueOnce(null);

    const missing = await createBiometricLinkRequest({ userId: "u1", deviceCode: "F22-404" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("DEVICE_NOT_FOUND");

    prismaMock.biometricDevice.findFirst.mockResolvedValueOnce({ id: "dev1", code: "F22-01", name: "F22" });
    prismaMock.biometricLinkRequest.findFirst.mockResolvedValueOnce({
      id: "lr-other",
      userId: "u2",
      status: "WAITING_PUNCH",
    });

    const busy = await createBiometricLinkRequest({ userId: "u1", deviceCode: "F22-01" });
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.reason).toBe("DEVICE_BUSY");
  });

  it("aplica rate limit diario de solicitudes", async () => {
    vi.stubEnv("BIOMETRIC_LINK_MAX_PER_DAY", "1");
    prismaMock.user.findUnique.mockResolvedValue({
      isActive: true,
      isApproved: true,
      orgRole: { code: "TEACHER" },
    });
    prismaMock.biometricUserMapping.findFirst.mockResolvedValue(null);
    prismaMock.biometricLinkRequest.count.mockResolvedValue(1);

    const result = await createBiometricLinkRequest({ userId: "u1", deviceCode: "F22-01" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("RATE_LIMIT");
  });

  it("crea solicitud cuando hay un solo dispositivo", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isActive: true,
      isApproved: true,
      orgRole: { code: "TEACHER" },
    });
    prismaMock.biometricUserMapping.findFirst.mockResolvedValue(null);
    prismaMock.biometricLinkRequest.count.mockResolvedValue(0);
    prismaMock.biometricDevice.findMany.mockResolvedValue([
      { id: "dev1", code: "F22-01", name: "F22", admsSerial: "SN1" },
    ]);
    prismaMock.biometricLinkRequest.findFirst.mockResolvedValue(null);
    prismaMock.biometricLinkRequest.create.mockResolvedValue({
      id: "lr1",
      userId: "u1",
      deviceId: "dev1",
      status: "WAITING_PUNCH",
      expiresAt: new Date(Date.now() + 120000),
      device: { id: "dev1", code: "F22-01", name: "F22" },
    });

    const result = await createBiometricLinkRequest({ userId: "u1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.linkRequest.id).toBe("lr1");
  });

  it("captura marca para solicitud activa", async () => {
    prismaMock.biometricLinkRequest.findFirst.mockResolvedValue({
      id: "lr1",
      userId: "u1",
      user: { id: "u1", isActive: true, isApproved: true },
    });
    prismaMock.biometricUserMapping.findFirst.mockResolvedValue(null);
    prismaMock.biometricPunch.create.mockResolvedValue({ id: "p1" });
    prismaMock.biometricLinkRequest.update.mockResolvedValue({});

    const result = await tryCaptureBiometricLinkPunch({
      deviceDbId: "dev1",
      deviceCode: "F22-01",
      deviceUserId: "1007",
      occurredAt: new Date("2026-05-22T16:00:00Z"),
      externalId: "ext-1",
      payload: {},
    });

    expect(result.handled).toBe(true);
    expect(prismaMock.biometricLinkRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING_CONFIRM",
          candidateDeviceUserId: "1007",
        }),
      }),
    );
  });

  it("no captura si no hay solicitud o si el PIN pertenece a otro usuario", async () => {
    prismaMock.biometricLinkRequest.findFirst.mockResolvedValueOnce(null);

    const none = await tryCaptureBiometricLinkPunch({
      deviceDbId: "dev1",
      deviceCode: "F22-01",
      deviceUserId: "1007",
      occurredAt: new Date("2026-05-22T16:00:00Z"),
      externalId: "ext-1",
      payload: {},
    });
    expect(none.handled).toBe(false);

    prismaMock.biometricLinkRequest.findFirst.mockResolvedValueOnce({
      id: "lr1",
      userId: "u1",
      user: { id: "u1", isActive: true, isApproved: true },
    });
    prismaMock.biometricUserMapping.findFirst.mockResolvedValueOnce({ id: "m1", userId: "u2" });

    const taken = await tryCaptureBiometricLinkPunch({
      deviceDbId: "dev1",
      deviceCode: "F22-01",
      deviceUserId: "1007",
      occurredAt: new Date("2026-05-22T16:00:00Z"),
      externalId: "ext-2",
      payload: {},
    });
    expect(taken).toEqual({ handled: false, reason: "PIN_TAKEN" });
  });

  it("confirma y descarta la marca capturada sin registrarla como asistencia", async () => {
    const future = new Date(Date.now() + 60000);
    prismaMock.biometricLinkRequest.findUnique.mockResolvedValue({
      id: "lr1",
      userId: "u1",
      deviceId: "dev1",
      status: "PENDING_CONFIRM",
      expiresAt: future,
      candidateDeviceUserId: "1007",
      candidatePunchId: "p1",
      device: { id: "dev1", code: "F22-01", name: "F22" },
    });
    prismaMock.biometricUserMapping.findFirst.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        biometricUserMapping: {
          updateMany: vi.fn().mockResolvedValue({}),
          upsert: vi.fn().mockResolvedValue({ id: "m1", deviceUserId: "1007" }),
        },
        biometricLinkRequest: {
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });
    prismaMock.biometricPunch.delete.mockResolvedValue({});

    const result = await confirmBiometricLinkRequest({ userId: "u1", linkRequestId: "lr1" });
    expect(result.ok).toBe(true);
    expect(prismaMock.biometricPunch.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(prismaMock.biometricPunch.findUnique).not.toHaveBeenCalled();
  });

  it("rechaza confirmación inválida, expirada, sin candidato o con PIN tomado", async () => {
    prismaMock.biometricLinkRequest.findUnique.mockResolvedValueOnce(null);
    const missing = await confirmBiometricLinkRequest({ userId: "u1", linkRequestId: "missing" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("NOT_FOUND");

    prismaMock.biometricLinkRequest.findUnique.mockResolvedValueOnce({
      id: "lr1",
      userId: "u1",
      status: "WAITING_PUNCH",
      expiresAt: new Date(Date.now() + 60000),
      device: { id: "dev1", code: "F22-01", name: "F22" },
    });
    const invalid = await confirmBiometricLinkRequest({ userId: "u1", linkRequestId: "lr1" });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.reason).toBe("INVALID_STATUS");

    prismaMock.biometricLinkRequest.findUnique.mockResolvedValueOnce({
      id: "lr1",
      userId: "u1",
      status: "PENDING_CONFIRM",
      expiresAt: new Date(Date.now() - 60000),
      device: { id: "dev1", code: "F22-01", name: "F22" },
    });
    prismaMock.biometricLinkRequest.update.mockResolvedValueOnce({});
    const expired = await confirmBiometricLinkRequest({ userId: "u1", linkRequestId: "lr1" });
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.reason).toBe("EXPIRED");

    prismaMock.biometricLinkRequest.findUnique.mockResolvedValueOnce({
      id: "lr1",
      userId: "u1",
      status: "PENDING_CONFIRM",
      expiresAt: new Date(Date.now() + 60000),
      candidateDeviceUserId: null,
      device: { id: "dev1", code: "F22-01", name: "F22" },
    });
    const noCandidate = await confirmBiometricLinkRequest({ userId: "u1", linkRequestId: "lr1" });
    expect(noCandidate.ok).toBe(false);
    if (!noCandidate.ok) expect(noCandidate.reason).toBe("NO_CANDIDATE");

    prismaMock.biometricLinkRequest.findUnique.mockResolvedValueOnce({
      id: "lr1",
      userId: "u1",
      deviceId: "dev1",
      status: "PENDING_CONFIRM",
      expiresAt: new Date(Date.now() + 60000),
      candidateDeviceUserId: "1007",
      device: { id: "dev1", code: "F22-01", name: "F22" },
    });
    prismaMock.biometricUserMapping.findFirst.mockResolvedValueOnce({ id: "m-other" });
    const pinTaken = await confirmBiometricLinkRequest({ userId: "u1", linkRequestId: "lr1" });
    expect(pinTaken.ok).toBe(false);
    if (!pinTaken.ok) expect(pinTaken.reason).toBe("PIN_TAKEN");
  });

  it("cancela solicitudes activas y rechaza las que no corresponden", async () => {
    prismaMock.biometricLinkRequest.findUnique.mockResolvedValueOnce(null);
    const missing = await cancelBiometricLinkRequest({ userId: "u1", linkRequestId: "missing" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("NOT_FOUND");

    prismaMock.biometricLinkRequest.findUnique.mockResolvedValueOnce({
      id: "lr1",
      userId: "u1",
      status: "CONFIRMED",
      candidatePunchId: null,
    });
    const invalid = await cancelBiometricLinkRequest({ userId: "u1", linkRequestId: "lr1" });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.reason).toBe("INVALID_STATUS");

    prismaMock.biometricLinkRequest.findUnique.mockResolvedValueOnce({
      id: "lr1",
      userId: "u1",
      status: "PENDING_CONFIRM",
      candidatePunchId: "p1",
    });
    prismaMock.biometricLinkRequest.update.mockResolvedValueOnce({});
    prismaMock.biometricPunch.delete.mockResolvedValueOnce({});
    const cancelled = await cancelBiometricLinkRequest({ userId: "u1", linkRequestId: "lr1" });
    expect(cancelled.ok).toBe(true);
    expect(prismaMock.biometricPunch.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
  });
});
