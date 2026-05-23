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
vi.mock("./biometric-ingest-core.js", () => ({
  processBiometricIngest: vi.fn(),
}));

import {
  createBiometricLinkRequest,
  tryCaptureBiometricLinkPunch,
  confirmBiometricLinkRequest,
} from "./biometric-link.js";
import { processBiometricIngest } from "./biometric-ingest-core.js";

describe("biometric-link service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.biometricLinkRequest.updateMany.mockResolvedValue({ count: 0 });
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

  it("confirma y reprocesa marca capturada", async () => {
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
    prismaMock.biometricPunch.findUnique.mockResolvedValue({
      deviceUserId: "1007",
      occurredAt: new Date("2026-05-22T16:00:00Z"),
      externalId: "ext-1",
      punchType: "CHECK_IN",
      payload: {},
    });
    prismaMock.biometricPunch.delete.mockResolvedValue({});
    vi.mocked(processBiometricIngest).mockResolvedValue({
      ok: true,
      duplicate: false,
      punchId: "p2",
      attendance: { id: "att1" },
    });

    const result = await confirmBiometricLinkRequest({ userId: "u1", linkRequestId: "lr1" });
    expect(result.ok).toBe(true);
    expect(processBiometricIngest).toHaveBeenCalled();
  });
});
