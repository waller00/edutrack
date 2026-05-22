import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import zktecoIclockRoutes from "./zkteco-iclock.js";

const { prismaMock, processMock } = vi.hoisted(() => ({
  prismaMock: {
    biometricDevice: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
  processMock: vi.fn(),
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/biometric-ingest-core.js", () => ({
  findBiometricDeviceByAdmsSn: vi.fn(),
  processBiometricIngest: processMock,
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
});
