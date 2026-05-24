import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import zktecoIclockRoutes from "./zkteco-iclock.js";

const { prismaMock, processMock, captureMock } = vi.hoisted(() => ({
  prismaMock: {
    biometricDevice: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    biometricUserMapping: {
      findFirst: vi.fn(),
    },
  },
  processMock: vi.fn(),
  captureMock: vi.fn(),
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/biometric-ingest-core.js", () => ({
  findBiometricDeviceByAdmsSn: vi.fn(),
  processBiometricIngest: processMock,
}));
vi.mock("../services/biometric-link.js", () => ({
  tryCaptureBiometricLinkPunch: captureMock,
}));

import { findBiometricDeviceByAdmsSn } from "../services/biometric-ingest-core.js";

const findDeviceMock = vi.mocked(findBiometricDeviceByAdmsSn);

function app() {
  const a = express();
  a.use(express.text({ type: () => true, limit: "1mb" }));
  a.use("/iclock", zktecoIclockRoutes);
  return a;
}

describe("zkteco iclock routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.biometricDevice.update.mockResolvedValue({});
    prismaMock.biometricUserMapping.findFirst.mockResolvedValue({ id: "map-1" });
    captureMock.mockResolvedValue({ handled: false });
    findDeviceMock.mockResolvedValue({
      id: "dev-1",
      code: "F22-LOCAL-01",
      name: "F22",
      isActive: true,
      secretHash: "x",
      allowedIps: [],
      timezone: "America/Montevideo",
      admsSerial: "SN123",
    });
    processMock.mockResolvedValue({
      ok: true,
      duplicate: false,
      punchId: "p1",
      attendance: {},
    });
  });

  it("GET getrequest responde OK", async () => {
    const res = await request(app()).get("/iclock/getrequest?SN=SN123");
    expect(res.status).toBe(200);
    expect(res.text).toBe("OK");
  });

  it("GET cdata options=all devuelve configuración", async () => {
    const res = await request(app()).get("/iclock/cdata?SN=SN123&options=all");
    expect(res.status).toBe(200);
    expect(res.text).toContain("GET OPTION FROM: SN123");
    expect(res.text).toContain("Realtime=1");
  });

  it("POST cdata ATTLOG procesa fichadas", async () => {
    const res = await request(app())
      .post("/iclock/cdata?SN=SN123&table=ATTLOG")
      .set("Content-Type", "text/plain")
      .send("1001\t2026-05-21 10:00:00\t0\t1\n");

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/^OK/);
    expect(processMock).toHaveBeenCalledTimes(1);
    expect(processMock.mock.calls[0]![0]).toMatchObject({
      deviceUserId: "1001",
      punchType: "CHECK_IN",
    });
  });

  it("POST cdata ATTLOG no registra asistencia si la marca se captura para vinculación", async () => {
    captureMock.mockResolvedValue({ handled: true, linkRequestId: "lr1" });
    const res = await request(app())
      .post("/iclock/cdata?SN=SN123&table=ATTLOG")
      .set("Content-Type", "text/plain")
      .send("1001\t2026-05-21 10:00:00\t0\t1\n");

    expect(res.status).toBe(200);
    expect(res.text).toBe("OK:0");
    expect(processMock).not.toHaveBeenCalled();
  });

  it("POST cdata ATTLOG ignora marcas de PIN tomado durante vinculación", async () => {
    captureMock.mockResolvedValue({ handled: false, reason: "PIN_TAKEN" });
    const res = await request(app())
      .post("/iclock/cdata?SN=SN123&table=ATTLOG")
      .set("Content-Type", "text/plain")
      .send("1001\t2026-05-21 10:00:00\t0\t1\n");

    expect(res.status).toBe(200);
    expect(res.text).toBe("OK:0");
    expect(processMock).not.toHaveBeenCalled();
  });

  it("GET getrequest sin SN devuelve 400", async () => {
    const res = await request(app()).get("/iclock/getrequest");
    expect(res.status).toBe(400);
    expect(res.text).toContain("missing SN");
  });

  it("POST ATTLOG sin dispositivo registrado responde OK", async () => {
    findDeviceMock.mockResolvedValue(null);
    const res = await request(app())
      .post("/iclock/cdata?SN=UNKNOWN&table=ATTLOG")
      .set("Content-Type", "text/plain")
      .send("1001\t2026-05-21 10:00:00\t0\t1\n");
    expect(res.status).toBe(200);
    expect(res.text).toBe("OK");
    expect(processMock).not.toHaveBeenCalled();
  });

  it("rechaza IP no permitida en ATTLOG", async () => {
    findDeviceMock.mockResolvedValue({
      id: "dev-1",
      code: "F22-LOCAL-01",
      name: "F22",
      isActive: true,
      secretHash: "x",
      allowedIps: ["10.0.0.5"],
      timezone: "America/Montevideo",
      admsSerial: "SN123",
    });
    const res = await request(app())
      .post("/iclock/cdata?SN=SN123&table=ATTLOG")
      .set("Content-Type", "text/plain")
      .set("X-Forwarded-For", "192.168.1.6")
      .send("1001\t2026-05-21 10:00:00\t0\t1\n");
    expect(res.status).toBe(403);
    expect(res.text).toContain("IP not allowed");
  });

  it("POST registry responde OK", async () => {
    const res = await request(app()).post("/iclock/registry?SN=SN123");
    expect(res.status).toBe(200);
    expect(res.text).toBe("OK");
  });
});
