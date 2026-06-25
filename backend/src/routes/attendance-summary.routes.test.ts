import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../test-utils/bearer-token.js";

const { prismaMock, payrollMock, planMock, resolveMock } = vi.hoisted(() => ({
  prismaMock: {
    schoolYear: { findUnique: vi.fn(), findFirst: vi.fn() },
    event: { findUnique: vi.fn(), findMany: vi.fn() },
    attendance: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    user: { findMany: vi.fn() },
    substitution: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  payrollMock: { buildPayrollAttendanceData: vi.fn() },
  planMock: { getPlannedInstances: vi.fn() },
  resolveMock: { resolveAttendanceAndJustification: vi.fn() },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/analytics/exports/payrollAttendanceReport.js", () => payrollMock);
vi.mock("../services/analytics/planInstances.js", () => planMock);
vi.mock("../services/analytics/resolveInstances.js", () => resolveMock);

import attendanceRoutes from "./attendance.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use("/attendance", attendanceRoutes);
  return a;
}

const tok = (role = "TEACHER", sub = "user-1") =>
  signAccessToken({ sub, email: "u@u.com", role: role as "TEACHER" });

const userUuid = "00000000-0000-4000-8000-000000000099";

function person(userId: string) {
  return {
    userId,
    nombre: "Ada Lovelace",
    rol: "Docente",
    email: "ada@example.com",
    rows: [{ fecha: "2026-05-20", estado: "Ausente no justificado" }],
    stats: { esperadas: 4, presente: 3, tarde: 0, ausenteNoJustificado: 1, pctAsistencia: 75 },
  };
}

describe("attendance /summary (mock analytics)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.substitution.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$executeRaw.mockResolvedValue(1);
    prismaMock.auditLog.create.mockResolvedValue({});
    payrollMock.buildPayrollAttendanceData.mockResolvedValue({
      from: "2026-01-01",
      to: "2026-05-31",
      persons: [person(userUuid)],
      total: { esperadas: 4, presente: 3 },
    });
  });

  it("401 sin auth", async () => {
    const res = await request(app()).get("/attendance/summary");
    expect(res.status).toBe(401);
  });

  it("TEACHER recibe solo su propio resumen (fuerza userId propio)", async () => {
    const res = await request(app())
      .get("/attendance/summary?from=2026-01-01&to=2026-05-31")
      .set("Authorization", `Bearer ${tok("TEACHER", "user-1")}`);
    expect(res.status).toBe(200);
    expect(payrollMock.buildPayrollAttendanceData).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ userId: "user-1" }) }),
    );
    // El payroll mock devuelve userUuid; al filtrar por userId propio no matchea → person null, lo importante es el scope.
    expect(res.body).toHaveProperty("person");
  });

  it("TEACHER no puede ver el resumen de otra persona (403)", async () => {
    const res = await request(app())
      .get(`/attendance/summary?userId=${userUuid}`)
      .set("Authorization", `Bearer ${tok("TEACHER", "user-1")}`);
    expect(res.status).toBe(403);
    expect(payrollMock.buildPayrollAttendanceData).not.toHaveBeenCalled();
  });

  it("ADMIN obtiene el resumen de la persona pedida", async () => {
    const res = await request(app())
      .get(`/attendance/summary?userId=${userUuid}&from=2026-01-01&to=2026-05-31`)
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(200);
    expect(res.body.person.userId).toBe(userUuid);
    expect(res.body.person.stats.pctAsistencia).toBe(75);
  });

  it("ADMIN sin userId devuelve todas las personas", async () => {
    const res = await request(app())
      .get("/attendance/summary?from=2026-01-01&to=2026-05-31")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.persons)).toBe(true);
    expect(res.body.persons).toHaveLength(1);
  });

  it("500 si el reporte falla", async () => {
    payrollMock.buildPayrollAttendanceData.mockRejectedValueOnce?.(new Error("boom"));
    payrollMock.buildPayrollAttendanceData.mockRejectedValue(new Error("boom"));
    const res = await request(app())
      .get("/attendance/summary")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(500);
  });
});

describe("attendance /justify-range (mock analytics)", () => {
  const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000);

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.substitution.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$executeRaw.mockResolvedValue(1);
    prismaMock.auditLog.create.mockResolvedValue({});
    planMock.getPlannedInstances.mockResolvedValue([
      { eventId: "ev1", plannedDate: "2026-05-20", plannedEndTime: pastEnd, userIdRequired: userUuid },
    ]);
    resolveMock.resolveAttendanceAndJustification.mockResolvedValue([
      { planned: { eventId: "ev1", plannedDate: "2026-05-20" }, checkInStatusResolved: "ABSENT_NOT_JUSTIFIED" },
    ]);
    prismaMock.event.findUnique.mockResolvedValue({
      id: "ev1",
      title: "Clase",
      type: "CLASE",
      startTime: new Date("2026-05-20T18:00:00.000Z"),
      endTime: new Date("2026-05-20T19:00:00.000Z"),
      assignedUserId: userUuid,
      schoolYearId: "sy1",
    });
    prismaMock.attendance.findFirst.mockResolvedValue(null);
    prismaMock.attendance.create.mockResolvedValue({
      id: "att-1",
      status: "ABSENT_NOT_JUSTIFIED",
      user: {},
      event: {},
    });
    prismaMock.attendance.findUnique.mockResolvedValue({ id: "att-1", status: "ABSENT_NOT_JUSTIFIED", notes: null });
    prismaMock.attendance.update.mockResolvedValue({ id: "att-1", status: "ABSENT_JUSTIFIED", user: {}, event: {} });
  });

  it("400 body inválido", async () => {
    const res = await request(app())
      .post("/attendance/justify-range")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ userId: userUuid });
    expect(res.status).toBe(400);
  });

  it("403 sin permiso de admin", async () => {
    const res = await request(app())
      .post("/attendance/justify-range")
      .set("Authorization", `Bearer ${tok("TEACHER")}`)
      .send({ userId: userUuid, from: "2026-05-01", to: "2026-05-31", reason: "Licencia" });
    expect(res.status).toBe(403);
  });

  it("materializa y justifica las faltas del rango", async () => {
    const res = await request(app())
      .post("/attendance/justify-range")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ userId: userUuid, from: "2026-05-01", to: "2026-05-31", type: "ABSENCE", reason: "Licencia médica" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.justified).toBe(1);
    expect(res.body.created).toBe(1);
    expect(prismaMock.attendance.create).toHaveBeenCalled();
  });

  it("ignora instancias futuras (plannedEndTime > now)", async () => {
    planMock.getPlannedInstances.mockResolvedValueOnce([
      {
        eventId: "ev-fut",
        plannedDate: "2099-01-01",
        plannedEndTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        userIdRequired: userUuid,
      },
    ]);
    resolveMock.resolveAttendanceAndJustification.mockResolvedValueOnce([]);
    const res = await request(app())
      .post("/attendance/justify-range")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ userId: userUuid, from: "2099-01-01", to: "2099-12-31", reason: "x" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.justified).toBe(0);
  });
});

describe("attendance /my-attendances includeAbsences (mock analytics)", () => {
  const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000);

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.substitution.findMany.mockResolvedValue([]);
    planMock.getPlannedInstances.mockResolvedValue([
      { eventId: "ev1", plannedDate: "2026-05-20", plannedEndTime: pastEnd, userIdRequired: "user-1" },
    ]);
    resolveMock.resolveAttendanceAndJustification.mockResolvedValue([
      {
        planned: {
          plannedInstanceId: "ev1_2026-05-20",
          eventId: "ev1",
          eventTitle: "Clase",
          eventType: "CLASE",
          plannedDate: "2026-05-20",
          plannedStartTime: new Date("2026-05-20T18:00:00.000Z"),
          plannedEndTime: pastEnd,
          userIdRequired: "user-1",
        },
        checkInStatusResolved: "ABSENT_NOT_JUSTIFIED",
        userDisplayName: "Yo",
        userEmail: "yo@example.com",
        userRole: "TEACHER",
      },
    ]);
  });

  it("sin el flag devuelve solo marcas reales", async () => {
    prismaMock.attendance.findMany.mockResolvedValue([{ id: "real-1", type: "CHECK_IN", date: new Date(), time: new Date() }]);
    const res = await request(app())
      .get("/attendance/my-attendances")
      .set("Authorization", `Bearer ${tok("TEACHER", "user-1")}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(planMock.getPlannedInstances).not.toHaveBeenCalled();
  });

  it("con includeAbsences agrega las faltas derivadas propias", async () => {
    prismaMock.attendance.findMany.mockResolvedValue([]);
    const res = await request(app())
      .get("/attendance/my-attendances?includeAbsences=true&startDate=2026-05-01&endDate=2026-05-31")
      .set("Authorization", `Bearer ${tok("TEACHER", "user-1")}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("absence:ev1_2026-05-20");
    expect(res.body[0].status).toBe("ABSENT_NOT_JUSTIFIED");
  });

  it("no duplica una falta ya materializada como marca real", async () => {
    prismaMock.attendance.findMany.mockResolvedValue([
      { id: "real-1", type: "CHECK_IN", eventId: "ev1", date: new Date("2026-05-20T00:00:00.000Z"), time: new Date("2026-05-20T18:00:00.000Z"), status: "ABSENT_NOT_JUSTIFIED" },
    ]);
    const res = await request(app())
      .get("/attendance/my-attendances?includeAbsences=true&startDate=2026-05-01&endDate=2026-05-31")
      .set("Authorization", `Bearer ${tok("TEACHER", "user-1")}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("real-1");
  });
});
