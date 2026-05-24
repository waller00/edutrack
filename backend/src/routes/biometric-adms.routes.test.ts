import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import crypto from "crypto";
import biometricAdmsRoutes from "./biometric-adms.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    biometricDevice: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    biometricUserMapping: {
      findFirst: vi.fn(),
    },
    biometricPunch: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    attendance: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    event: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    attendanceIncident: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    inAppNotification: {
      create: vi.fn(),
    },
    systemSettings: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/medicalLeaveReconciliation.js", () => ({
  findApprovedLicenseCoveringEventTime: vi.fn(),
}));
vi.mock("../services/attendance-incidents.js", () => ({
  findOpenNoShowIncidentForEvents: vi.fn(),
  findAssignedEventForAttendanceInstant: vi.fn(),
  findAssignedEventNearAttendanceInstant: vi.fn(),
  maybeCreateLateArrivalIncident: vi.fn(),
  resolveNoShowIncidentsForEvents: vi.fn(),
}));

import { findApprovedLicenseCoveringEventTime } from "../services/medicalLeaveReconciliation.js";
import {
  findOpenNoShowIncidentForEvents,
  findAssignedEventForAttendanceInstant,
  findAssignedEventNearAttendanceInstant,
  maybeCreateLateArrivalIncident,
  resolveNoShowIncidentsForEvents,
} from "../services/attendance-incidents.js";
const findLicenseMock = vi.mocked(findApprovedLicenseCoveringEventTime);
const findOpenNoShowMock = vi.mocked(findOpenNoShowIncidentForEvents);
const findAssignedEventMock = vi.mocked(findAssignedEventForAttendanceInstant);
const findAssignedEventNearMock = vi.mocked(findAssignedEventNearAttendanceInstant);
const lateIncidentMock = vi.mocked(maybeCreateLateArrivalIncident);
const resolveNoShowMock = vi.mocked(resolveNoShowIncidentsForEvents);

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function app() {
  const a = express();
  a.use(express.json());
  a.use("/biometric", biometricAdmsRoutes);
  return a;
}

const payload = {
  deviceCode: "F22-TEST-01",
  deviceUserId: "1001",
  timestamp: "2026-05-05T13:10:00.000Z",
};

describe("biometric ADMS ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    findLicenseMock.mockResolvedValue(null);
    findOpenNoShowMock.mockResolvedValue(null);
    findAssignedEventMock.mockResolvedValue(null);
    findAssignedEventNearMock.mockResolvedValue(null);
    lateIncidentMock.mockResolvedValue(null);
    resolveNoShowMock.mockResolvedValue(0);
    prismaMock.systemSettings.upsert.mockResolvedValue({
      id: "default",
      livenessCheckEnabled: false,
      attendanceNoShowGraceMinutes: 15,
      attendanceLateToleranceMinutes: 5,
      attendanceClassBridgeGapMinutes: 60,
      attendanceMonitorEnabled: true,
      attendanceMonitorIntervalMs: 120000,
      biometricLateHour: 8,
      biometricLateMinute: 30,
    });
    prismaMock.biometricDevice.findUnique.mockResolvedValue({
      id: "device-1",
      code: "F22-TEST-01",
      name: "F22",
      isActive: true,
      secretHash: sha256("local-secret"),
      allowedIps: [],
      timezone: "America/Montevideo",
      admsSerial: null,
    });
  });

  it("401 si falta x-biometric-secret", async () => {
    const res = await request(app()).post("/biometric/adms-ingest").send(payload);
    expect(res.status).toBe(401);
  });

  it("422 si no existe mapeo de usuario", async () => {
    prismaMock.biometricUserMapping.findFirst.mockResolvedValue(null);
    prismaMock.biometricPunch.create.mockResolvedValue({ id: "p-rejected" });

    const res = await request(app())
      .post("/biometric/adms-ingest")
      .set("x-biometric-secret", "local-secret")
      .send(payload);

    expect(res.status).toBe(422);
    expect(res.body.punchId).toBe("p-rejected");
  });

  it("201 procesa marcación sin evento como presente", async () => {
    prismaMock.biometricUserMapping.findFirst.mockResolvedValue({ id: "map-1", userId: "user-1" });
    prismaMock.biometricPunch.findUnique.mockResolvedValue(null);
    prismaMock.attendance.findFirst.mockResolvedValue(null);
    prismaMock.event.findMany.mockResolvedValue([]);
    prismaMock.attendance.create.mockResolvedValue({
      id: "att-1",
      type: "CHECK_IN",
      status: "PRESENT",
      date: new Date("2026-05-05T00:00:00.000Z"),
      time: new Date(payload.timestamp),
    });
    prismaMock.biometricPunch.create.mockResolvedValue({ id: "p-1" });
    prismaMock.biometricDevice.update.mockResolvedValue({});

    const res = await request(app())
      .post("/biometric/adms-ingest")
      .set("x-biometric-secret", "local-secret")
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.duplicate).toBe(false);
    expect(res.body.attendance.id).toBe("att-1");
    expect(prismaMock.attendance.create.mock.calls[0][0].data.status).toBe("PRESENT");
    expect(prismaMock.attendance.create.mock.calls[0][0].data.eventId).toBeUndefined();
  });

  it("vincula evento cercano y deja presente si la marca fue antes del inicio", async () => {
    prismaMock.biometricUserMapping.findFirst.mockResolvedValue({ id: "map-1", userId: "user-1" });
    prismaMock.biometricPunch.findUnique.mockResolvedValue(null);
    prismaMock.attendance.findFirst.mockResolvedValue(null);
    prismaMock.event.findMany.mockResolvedValue([]);
    findAssignedEventNearMock.mockResolvedValue({
      id: "event-1",
      title: "Clase Natalia",
      type: "REUNION",
      startTime: new Date("2026-05-05T13:11:00.000Z"),
      endTime: new Date("2026-05-05T14:11:00.000Z"),
    });
    prismaMock.attendance.create.mockResolvedValue({
      id: "att-1",
      type: "CHECK_IN",
      status: "PRESENT",
      date: new Date("2026-05-05T00:00:00.000Z"),
      time: new Date(payload.timestamp),
      eventId: "event-1",
    });
    prismaMock.biometricPunch.create.mockResolvedValue({ id: "p-1" });
    prismaMock.biometricDevice.update.mockResolvedValue({});

    const res = await request(app())
      .post("/biometric/adms-ingest")
      .set("x-biometric-secret", "local-secret")
      .send(payload);

    expect(res.status).toBe(201);
    expect(prismaMock.attendance.create.mock.calls[0][0].data.status).toBe("PRESENT");
    expect(prismaMock.attendance.create.mock.calls[0][0].data.eventId).toBe("event-1");
  });

  it("marca llegada muy tarde por minutos reales aunque no exista no-show abierto", async () => {
    prismaMock.biometricUserMapping.findFirst.mockResolvedValue({ id: "map-1", userId: "user-1" });
    prismaMock.biometricPunch.findUnique.mockResolvedValue(null);
    prismaMock.attendance.findFirst.mockResolvedValue(null);
    prismaMock.event.findMany.mockResolvedValue([]);
    findAssignedEventNearMock.mockResolvedValue({
      id: "event-1",
      title: "Clase Natalia",
      type: "REUNION",
      startTime: new Date("2026-05-05T12:52:00.000Z"),
      endTime: new Date("2026-05-05T14:00:00.000Z"),
    });
    prismaMock.attendance.create.mockResolvedValue({
      id: "att-1",
      type: "CHECK_IN",
      status: "LATE",
      date: new Date("2026-05-05T00:00:00.000Z"),
      time: new Date(payload.timestamp),
      notes: "Llegada muy tarde: 18 min tarde - Dispositivo: F22-TEST-01",
    });
    prismaMock.biometricPunch.create.mockResolvedValue({ id: "p-1" });
    prismaMock.biometricDevice.update.mockResolvedValue({});

    const res = await request(app())
      .post("/biometric/adms-ingest")
      .set("x-biometric-secret", "local-secret")
      .send(payload);

    expect(res.status).toBe(201);
    expect(prismaMock.attendance.create.mock.calls[0][0].data.status).toBe("LATE");
    expect(prismaMock.attendance.create.mock.calls[0][0].data.notes).toContain("Llegada muy tarde: 18 min tarde");
  });

  it("marca salida anticipada contra fin planificado del evento", async () => {
    prismaMock.biometricUserMapping.findFirst.mockResolvedValue({ id: "map-1", userId: "user-1" });
    prismaMock.biometricPunch.findUnique.mockResolvedValue(null);
    prismaMock.attendance.findMany.mockResolvedValue([]);
    prismaMock.event.findMany.mockResolvedValue([]);
    findAssignedEventNearMock.mockResolvedValue({
      id: "event-1",
      title: "Clase Natalia",
      type: "REUNION",
      startTime: new Date("2026-05-05T13:00:00.000Z"),
      endTime: new Date("2026-05-05T14:00:00.000Z"),
    });
    prismaMock.attendance.create.mockResolvedValue({
      id: "att-1",
      type: "CHECK_OUT",
      status: "EARLY_EXIT",
      date: new Date("2026-05-05T00:00:00.000Z"),
      time: new Date(payload.timestamp),
      eventId: "event-1",
    });
    prismaMock.biometricPunch.create.mockResolvedValue({ id: "p-1" });
    prismaMock.biometricDevice.update.mockResolvedValue({});

    const res = await request(app())
      .post("/biometric/adms-ingest")
      .set("x-biometric-secret", "local-secret")
      .send({ ...payload, punchType: "CHECK_OUT" });

    expect(res.status).toBe(201);
    expect(prismaMock.attendance.create.mock.calls[0][0].data.status).toBe("EARLY_EXIT");
    expect(prismaMock.attendance.create.mock.calls[0][0].data.notes).toContain("SALIDA ANTICIPADA");
  });

  it("marca como llegada muy tarde cuando ya había no-show abierto para el evento", async () => {
    prismaMock.biometricUserMapping.findFirst.mockResolvedValue({ id: "map-1", userId: "user-1" });
    prismaMock.biometricPunch.findUnique.mockResolvedValue(null);
    prismaMock.attendance.findFirst.mockResolvedValue(null);
    prismaMock.event.findMany.mockResolvedValue([
      {
        id: "event-1",
        title: "Clase",
        type: "CLASE",
        startTime: new Date("2026-05-05T13:00:00.000Z"),
        endTime: new Date("2026-05-05T14:00:00.000Z"),
      },
    ]);
    findOpenNoShowMock.mockResolvedValue({ id: "inc-1", eventId: "event-1" });
    prismaMock.attendance.create.mockResolvedValue({
      id: "att-1",
      type: "CHECK_IN",
      status: "LATE",
      date: new Date("2026-05-05T00:00:00.000Z"),
      time: new Date(payload.timestamp),
      notes: "Llegada muy tarde: 10 min tarde - Dispositivo: F22-TEST-01",
    });
    prismaMock.biometricPunch.create.mockResolvedValue({ id: "p-1" });
    prismaMock.biometricDevice.update.mockResolvedValue({});

    const res = await request(app())
      .post("/biometric/adms-ingest")
      .set("x-biometric-secret", "local-secret")
      .send(payload);

    expect(res.status).toBe(201);
    expect(prismaMock.attendance.create.mock.calls[0][0].data.notes).toBe(
      "Llegada muy tarde: 10 min tarde - Dispositivo: F22-TEST-01",
    );
    expect(resolveNoShowMock).toHaveBeenCalledWith(prismaMock, "user-1", ["event-1"]);
  });

  it("200 cuando llega duplicado (idempotencia)", async () => {
    prismaMock.biometricUserMapping.findFirst.mockResolvedValue({ id: "map-1", userId: "user-1" });
    prismaMock.biometricPunch.findUnique.mockResolvedValue({ id: "p-existing", attendanceId: "att-1" });

    const res = await request(app())
      .post("/biometric/adms-ingest")
      .set("x-biometric-secret", "local-secret")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(res.body.punchId).toBe("p-existing");
  });
});
