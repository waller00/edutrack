import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import biometricLinkRoutes from "./biometric-link.js";

vi.mock("../middlewares/auth.js", () => ({
  authGuard: (req: any, _res: any, next: () => void) => {
    req.user = { sub: "admin-1", id: "admin-1", role: "ADMIN" };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: () => void) => next(),
}));

const linkMock = vi.hoisted(() => ({
  listActiveBiometricDevices: vi.fn(),
  listAdminBiometricDevices: vi.fn(),
  createAdminBiometricDevice: vi.fn(),
  updateAdminBiometricDevice: vi.fn(),
  getUserBiometricMapping: vi.fn(),
  getActiveBiometricLinkRequest: vi.fn(),
  createBiometricLinkRequest: vi.fn(),
  confirmBiometricLinkRequest: vi.fn(),
  cancelBiometricLinkRequest: vi.fn(),
  deactivateUserBiometricMapping: vi.fn(),
  biometricLinkTtlSeconds: vi.fn(() => 120),
}));

vi.mock("../services/biometric-link.js", () => linkMock);

function app() {
  const a = express();
  a.use(express.json());
  a.use("/biometric", biometricLinkRoutes);
  return a;
}

describe("biometric-link routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    linkMock.getUserBiometricMapping.mockResolvedValue(null);
    linkMock.getActiveBiometricLinkRequest.mockResolvedValue(null);
    linkMock.listActiveBiometricDevices.mockResolvedValue([]);
    linkMock.listAdminBiometricDevices.mockResolvedValue([]);
  });

  it("GET /biometric/devices lista lectores", async () => {
    linkMock.listActiveBiometricDevices.mockResolvedValue([{ id: "d1", code: "F22", name: "F22" }]);
    const res = await request(app()).get("/biometric/devices");
    expect(res.status).toBe(200);
    expect(res.body.devices).toHaveLength(1);
  });

  it("GET /biometric/admin/devices lista lectores para configuración", async () => {
    linkMock.listAdminBiometricDevices.mockResolvedValue([
      { id: "d1", code: "F22", name: "Entrada", isActive: true, _count: { mappings: 2, punches: 10, linkRequests: 1 } },
    ]);
    const res = await request(app()).get("/biometric/admin/devices");
    expect(res.status).toBe(200);
    expect(res.body.devices[0].name).toBe("Entrada");
  });

  it("POST /biometric/admin/devices crea lector", async () => {
    linkMock.createAdminBiometricDevice.mockResolvedValue({ id: "d1", code: "F22", name: "Entrada" });
    const res = await request(app()).post("/biometric/admin/devices").send({
      code: "F22",
      name: "Entrada",
      secret: "secret-local",
      allowedIps: ["10.0.0.5"],
    });
    expect(res.status).toBe(201);
    expect(linkMock.createAdminBiometricDevice).toHaveBeenCalledWith(
      expect.objectContaining({ code: "F22", allowedIps: ["10.0.0.5"] }),
    );
  });

  it("PUT /biometric/admin/devices/:id actualiza lector", async () => {
    linkMock.updateAdminBiometricDevice.mockResolvedValue({ id: "d1", code: "F22", name: "Entrada 2" });
    const res = await request(app()).put("/biometric/admin/devices/d1").send({
      name: "Entrada 2",
      isActive: false,
    });
    expect(res.status).toBe(200);
    expect(linkMock.updateAdminBiometricDevice).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({ name: "Entrada 2", isActive: false }),
    );
  });

  it("POST /biometric/link-requests crea solicitud", async () => {
    linkMock.createBiometricLinkRequest.mockResolvedValue({
      ok: true,
      linkRequest: { id: "lr1", status: "WAITING_PUNCH" },
    });
    const res = await request(app()).post("/biometric/link-requests").send({});
    expect(res.status).toBe(201);
    expect(res.body.linkRequest.id).toBe("lr1");
  });

  it("POST /biometric/admin/users/:userId/biometric/link-requests crea solicitud para usuario", async () => {
    linkMock.createBiometricLinkRequest.mockResolvedValue({
      ok: true,
      linkRequest: { id: "lr1", status: "WAITING_PUNCH" },
    });
    const res = await request(app()).post("/biometric/admin/users/user-2/biometric/link-requests").send({});
    expect(res.status).toBe(201);
    expect(linkMock.createBiometricLinkRequest).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-2" }),
    );
  });

  it("POST confirm devuelve mapping", async () => {
    linkMock.confirmBiometricLinkRequest.mockResolvedValue({
      ok: true,
      mapping: { deviceUserId: "1007", device: { name: "F22" } },
    });
    const res = await request(app()).post("/biometric/link-requests/lr1/confirm");
    expect(res.status).toBe(200);
    expect(res.body.mapping.deviceUserId).toBe("1007");
  });
});
