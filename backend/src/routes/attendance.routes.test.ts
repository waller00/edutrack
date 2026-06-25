import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../test-utils/bearer-token.js";

const eid = "00000000-0000-4000-8000-0000000000e1";
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    schoolYear: { findUnique: vi.fn(), findFirst: vi.fn() },
    event: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    attendance: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    attendanceIncident: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    medicalLeave: { findFirst: vi.fn(), findMany: vi.fn() },
    systemSettings: { upsert: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));

import attendanceRoutes from "./attendance.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use("/attendance", attendanceRoutes);
  return a;
}

const tok = (role = "TEACHER") =>
  signAccessToken({ sub: "user-1", email: "u@u.com", role: role as "TEACHER" });

const validBody = {
  type: "CHECK_IN",
  date: "2025-06-01T12:00:00.000Z",
  time: "2025-06-01T08:05:00.000Z",
  eventId: eid,
};

describe("attendance /register (prisma mock)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.schoolYear.findFirst.mockResolvedValue(null);
    prismaMock.schoolYear.findUnique.mockResolvedValue(null);
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.$executeRaw.mockResolvedValue(1);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.auditLog.create.mockResolvedValue({});
    prismaMock.event.findMany.mockResolvedValue([]);
    prismaMock.event.findFirst.mockResolvedValue(null);
    prismaMock.attendance.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.medicalLeave.findMany.mockResolvedValue([]);
    prismaMock.systemSettings.upsert.mockResolvedValue({
      id: "default",
      attendanceNoShowGraceMinutes: 15,
      attendanceLateToleranceMinutes: 5,
      attendanceClassBridgeGapMinutes: 60,
      attendanceMonitorEnabled: true,
      attendanceMonitorIntervalMs: 120000,
      biometricDuplicateWindowMinutes: 5,
    });
  });

  it("401 sin auth", async () => {
    const res = await request(app()).post("/attendance/register").send(validBody);
    expect(res.status).toBe(401);
  });

  it("400 body inválido", async () => {
    const res = await request(app())
      .post("/attendance/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("404 evento inexistente", async () => {
    prismaMock.event.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .post("/attendance/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send(validBody);
    expect(res.status).toBe(404);
  });

  it("403 no asignado al evento", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: eid,
      assignedUserId: "otro-usuario",
      type: "CLASE",
      status: "SCHEDULED",
      startTime: new Date("2025-06-01T08:00:00.000Z"),
      endTime: new Date("2025-06-01T09:00:00.000Z"),
    });
    const res = await request(app())
      .post("/attendance/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("permite registrar asistencia al suplente oficial usando el horario de la suplencia", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: eid,
      assignedUserId: "titular-1",
      type: "CLASE",
      status: "SCHEDULED",
      startDate: new Date("2026-05-01T03:00:00.000Z"),
      startTime: new Date("2026-05-01T08:00:00.000Z"),
      endTime: new Date("2026-05-01T09:00:00.000Z"),
      schoolYearId: "sy-1",
    });
    prismaMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: "sub-1",
          startTime: new Date("2026-05-05T13:00:00.000Z"),
          endTime: new Date("2026-05-05T14:00:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([]);
    prismaMock.attendance.findFirst.mockResolvedValue(null);
    prismaMock.medicalLeave.findMany.mockResolvedValue([]);
    prismaMock.attendance.create.mockResolvedValue({
      id: "a-sub-1",
      status: "PRESENT",
      user: {},
      event: {},
    });

    const res = await request(app())
      .post("/attendance/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send({
        ...validBody,
        date: "2026-05-05T03:00:00.000Z",
        time: "2026-05-05T13:04:00.000Z",
      });

    expect(res.status).toBe(200);
    expect(prismaMock.attendance.create.mock.calls[0][0].data.status).toBe("PRESENT");
    expect(prismaMock.attendance.create.mock.calls[0][0].data.eventId).toBe(eid);
  });

  it("409 duplicado mismo día y tipo", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: eid,
      assignedUserId: "user-1",
      type: "CLASE",
      status: "SCHEDULED",
      startTime: new Date("2025-06-01T08:00:00.000Z"),
      endTime: new Date("2025-06-01T09:00:00.000Z"),
    });
    prismaMock.attendance.findFirst.mockResolvedValue({ id: "dup" });
    const res = await request(app())
      .post("/attendance/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send(validBody);
    expect(res.status).toBe(409);
    expect(String(res.body.message)).toMatch(/entrada|registro/i);
    expect(prismaMock.attendance.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          eventId: eid,
          type: "CHECK_IN",
          date: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      }),
    );
  });

  it("201 registro feliz", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: eid,
      assignedUserId: "user-1",
      type: "CLASE",
      status: "SCHEDULED",
      startDate: new Date("2025-06-01T00:00:00.000Z"),
      startTime: new Date("2025-06-01T08:00:00.000Z"),
      endTime: new Date("2025-06-01T09:00:00.000Z"),
    });
    prismaMock.attendance.findFirst.mockResolvedValue(null);
    prismaMock.medicalLeave.findMany.mockResolvedValue([]);
    prismaMock.attendance.create.mockResolvedValue({
      id: "a1",
      status: "PRESENT",
      user: {},
      event: {},
    });
    const res = await request(app())
      .post("/attendance/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("a1");
  });

  it("POST /attendance/register respeta tolerancia de llegada tarde configurada", async () => {
    prismaMock.systemSettings.upsert.mockResolvedValueOnce({
      id: "default",
      attendanceNoShowGraceMinutes: 15,
      attendanceLateToleranceMinutes: 10,
      attendanceClassBridgeGapMinutes: 60,
      attendanceMonitorEnabled: true,
      attendanceMonitorIntervalMs: 120000,
      biometricDuplicateWindowMinutes: 5,
    });
    prismaMock.event.findUnique.mockResolvedValue({
      id: eid,
      assignedUserId: "user-1",
      type: "CLASE",
      status: "SCHEDULED",
      startDate: new Date("2025-06-01T00:00:00.000Z"),
      startTime: new Date("2025-06-01T08:00:00.000Z"),
      endTime: new Date("2025-06-01T09:00:00.000Z"),
    });
    prismaMock.attendance.findFirst.mockResolvedValue(null);
    prismaMock.medicalLeave.findMany.mockResolvedValue([]);
    prismaMock.attendance.create.mockResolvedValue({
      id: "a1",
      status: "PRESENT",
      user: {},
      event: {},
    });
    const res = await request(app())
      .post("/attendance/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ ...validBody, time: "2025-06-01T08:10:00.000Z" });
    expect(res.status).toBe(200);
    expect(prismaMock.attendance.create.mock.calls[0][0].data.status).toBe("PRESENT");
  });

  it("POST /attendance/register 403 si licencia activa cubre el horario del evento", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: eid,
      assignedUserId: "user-1",
      type: "CLASE",
      status: "SCHEDULED",
      startDate: new Date("2025-06-01T00:00:00.000Z"),
      startTime: new Date("2025-06-01T08:00:00.000Z"),
      endTime: new Date("2025-06-01T09:00:00.000Z"),
    });
    prismaMock.attendance.findFirst.mockResolvedValue(null);
    prismaMock.medicalLeave.findMany.mockResolvedValue([
      {
        id: "ml-1",
        userId: "user-1",
        status: "ACTIVE",
        startDate: new Date("2025-05-30T00:00:00.000Z"),
        endDate: new Date("2025-06-15T23:59:59.999Z"),
      },
    ]);
    const res = await request(app())
      .post("/attendance/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ATTENDANCE_BLOCKED_BY_LICENSE");
    expect(prismaMock.attendance.create).not.toHaveBeenCalled();
  });

  it("POST /attendance/register 500 si falla la creación", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: eid,
      assignedUserId: "user-1",
      type: "CLASE",
      status: "SCHEDULED",
      startDate: new Date("2025-06-01T00:00:00.000Z"),
      startTime: new Date("2025-06-01T08:00:00.000Z"),
      endTime: new Date("2025-06-01T09:00:00.000Z"),
    });
    prismaMock.attendance.findFirst.mockResolvedValue(null);
    prismaMock.medicalLeave.findMany.mockResolvedValue([]);
    prismaMock.attendance.create.mockRejectedValueOnce(new Error("db"));
    const res = await request(app())
      .post("/attendance/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send(validBody);
    expect(res.status).toBe(500);
  });

  it("GET /attendance/my-attendances aplica filtros", async () => {
    prismaMock.attendance.findMany.mockResolvedValue([]);
    const res = await request(app())
      .get("/attendance/my-attendances")
      .query({ startDate: "2025-06-01T00:00:00.000Z", endDate: "2025-06-30T00:00:00.000Z", type: "CHECK_IN", status: "PRESENT" })
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(200);
    expect(prismaMock.attendance.findMany).toHaveBeenCalled();
    const where = prismaMock.attendance.findMany.mock.calls[0][0].where;
    expect(where.type).toBe("CHECK_IN");
    expect(where.status).toBe("PRESENT");
    expect(where.date.gte).toBeInstanceOf(Date);
    expect(where.date.lte).toBeInstanceOf(Date);
  });

  it("GET /attendance/all devuelve paginado para admin", async () => {
    prismaMock.attendance.count.mockResolvedValue(2);
    prismaMock.attendance.findMany.mockResolvedValue([{ id: "a1" }]);
    const res = await request(app())
      .get("/attendance/all?page=2&pageSize=10&eventType=CLASE&role=STAFF")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(2);
    expect(prismaMock.attendance.count).toHaveBeenCalled();
  });

  it("GET /attendance/all incluye faltas docentes cuando se solicita feed mixto", async () => {
    prismaMock.attendance.count.mockResolvedValue(1);
    prismaMock.attendanceIncident.count.mockResolvedValue(1);
    prismaMock.attendance.findMany.mockResolvedValue([
      {
        id: "a1",
        type: "CHECK_IN",
        status: "PRESENT",
        date: new Date("2026-05-20T12:00:00.000Z"),
        time: new Date("2026-05-20T12:00:00.000Z"),
        user: {},
      },
    ]);
    prismaMock.attendanceIncident.findMany.mockResolvedValue([
      {
        id: "i1",
        type: "TEACHER_NO_SHOW",
        status: "OPEN",
        severity: "HIGH",
        title: "Docente no presente en aula",
        description: "No hay marcación de entrada.",
        detectedAt: new Date("2026-05-20T18:15:00.000Z"),
        user: {},
        event: { id: eid, title: "Evento - Test", type: "CLASE" },
      },
    ]);

    const res = await request(app())
      .get("/attendance/all?includeIncidents=true&pageSize=10")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data[0]).toMatchObject({
      id: "incident:i1",
      type: "INCIDENT",
      status: "ABSENT_NOT_JUSTIFIED",
      title: "Docente no presente en aula",
    });
    expect(prismaMock.attendanceIncident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "TEACHER_NO_SHOW", status: "OPEN" }),
      }),
    );
  });

  it("GET /attendance/all muestra ausencias virtuales de eventos vencidos sin convertirlas en incidencias", async () => {
    prismaMock.attendance.count.mockResolvedValue(0);
    prismaMock.attendanceIncident.count.mockResolvedValue(0);
    prismaMock.attendance.findMany.mockResolvedValueOnce([]);
    prismaMock.attendanceIncident.findMany.mockResolvedValue([]);
    prismaMock.event.findMany.mockResolvedValueOnce([
      {
        id: "ev-absent",
        title: "Ingles Tercero C",
        type: "CLASE",
        status: "SCHEDULED",
        startDate: new Date("2026-05-20T18:00:00.000Z"),
        startTime: new Date("2026-05-20T18:00:00.000Z"),
        endTime: new Date("2026-05-20T19:00:00.000Z"),
        isRecurring: false,
        recurrenceEnd: null,
        daysOfWeek: [],
        effectiveFrom: null,
        effectiveUntil: null,
        assignedUserId: "teacher-1",
        courseOfferingId: "co-1",
        courseOffering: { id: "co-1", course: { name: "Tercero C", code: "3C" } },
        subject: { name: "Ingles" },
      },
    ]);
    prismaMock.attendance.findMany.mockResolvedValueOnce([]);
    prismaMock.user.findMany.mockResolvedValueOnce([
      {
        id: "teacher-1",
        name: "Jorge Marrero",
        email: "jorge@example.com",
        username: "jorge",
        firstName: null,
        lastName: null,
        orgRole: { code: "TEACHER" },
      },
    ]);
    prismaMock.medicalLeave.findMany.mockResolvedValueOnce([]);

    const res = await request(app())
      .get("/attendance/all?includeIncidents=true&startDate=2026-05-20&endDate=2026-05-20")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({
      id: "absence:ev-absent_2026-05-20",
      kind: "VIRTUAL_ABSENCE",
      type: "CHECK_IN",
      status: "ABSENT_NOT_JUSTIFIED",
      user: { id: "teacher-1", name: "Jorge Marrero", role: "TEACHER" },
      event: { id: "ev-absent", title: "Ingles Tercero C", type: "CLASE" },
    });
    expect(prismaMock.attendanceIncident.findMany).toHaveBeenCalled();
  });

  it("GET /attendance/all filtra por ciclo lectivo en la columna directa schoolYearId", async () => {
    const sy = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";
    prismaMock.schoolYear.findUnique.mockResolvedValueOnce({ id: sy });
    prismaMock.attendance.count.mockResolvedValue(0);
    prismaMock.attendance.findMany.mockResolvedValue([]);
    const res = await request(app())
      .get(`/attendance/all?schoolYearId=${sy}`)
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(200);
    // Antes se filtraba vía where.event.schoolYearId (ocultaba marcas sin evento);
    // ahora se segmenta por la columna propia Attendance.schoolYearId.
    const where = prismaMock.attendance.count.mock.calls[0][0].where as { schoolYearId: string };
    expect(where.schoolYearId).toBe(sy);
  });

  it("GET /attendance/all con status=ABSENCES filtra las tres clases de ausencia", async () => {
    prismaMock.attendance.count.mockResolvedValue(0);
    prismaMock.attendance.findMany.mockResolvedValue([]);
    const res = await request(app())
      .get("/attendance/all?status=ABSENCES")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(200);
    const where = prismaMock.attendance.count.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["ABSENT_NOT_JUSTIFIED", "ABSENT_JUSTIFIED", "SUBSTITUTED"] });
  });

  it("GET /attendance/all con allYears no filtra por ciclo", async () => {
    prismaMock.attendance.count.mockResolvedValue(0);
    prismaMock.attendance.findMany.mockResolvedValue([]);
    const res = await request(app())
      .get("/attendance/all?allYears=1")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(200);
    const where = prismaMock.attendance.count.mock.calls[0][0].where;
    expect(where.event).toBeUndefined();
  });

  it("GET /attendance/all 500 si falla la consulta", async () => {
    prismaMock.attendance.count.mockRejectedValueOnce(new Error("db"));
    const res = await request(app())
      .get("/attendance/all")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(500);
  });

  it("PUT /attendance/:id 400 con body inválido", async () => {
    const res = await request(app())
      .put("/attendance/a1")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ status: "BAD" });
    expect(res.status).toBe(400);
  });

  it("PUT /attendance/:id actualiza asistencia", async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({ id: "a1", status: "PRESENT", notes: null });
    prismaMock.attendance.update.mockResolvedValue({ id: "a1", status: "LATE" });
    prismaMock.auditLog.create.mockResolvedValue({});
    const res = await request(app())
      .put("/attendance/a1")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ status: "LATE", notes: "Llegó tarde" });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("a1");
  });

  it("PUT /attendance/:id 500 si update falla", async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({ id: "a1", status: "PRESENT", notes: null });
    prismaMock.attendance.update.mockRejectedValueOnce(new Error("db"));
    const res = await request(app())
      .put("/attendance/a1")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ status: "LATE" });
    expect(res.status).toBe(500);
  });

  it("POST /attendance/:id/justify no permite justificar asistencia inexistente", async () => {
    prismaMock.attendance.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .post("/attendance/a1/justify")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ reason: "Justificante administrativo" });

    expect(res.status).toBe(404);
  });

  it("POST /attendance/:id/justify registra justificación con auditoría", async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({ id: "a1", status: "ABSENT_NOT_JUSTIFIED", notes: null });
    prismaMock.attendance.update.mockResolvedValue({ id: "a1", status: "ABSENT_JUSTIFIED", notes: "Justificación: Justificante administrativo" });

    const res = await request(app())
      .post("/attendance/a1/justify")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ type: "ABSENCE", reason: "Justificante administrativo" });

    expect(res.status).toBe(200);
    expect(prismaMock.$executeRaw).toHaveBeenCalled();
    expect(prismaMock.$executeRaw).toHaveBeenCalled();
  });

  it("DELETE /attendance/:id elimina asistencia", async () => {
    prismaMock.attendance.delete.mockResolvedValue({});
    const res = await request(app())
      .delete("/attendance/a1")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(200);
  });

  it("DELETE /attendance/:id 500 si delete falla", async () => {
    prismaMock.attendance.delete.mockRejectedValueOnce(new Error("db"));
    const res = await request(app())
      .delete("/attendance/a1")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(500);
  });

  it("DELETE /attendance/purge-all elimina todos los registros filtrados", async () => {
    prismaMock.attendance.findMany.mockResolvedValueOnce([{ id: "a1" }, { id: "a2" }]);
    prismaMock.attendance.deleteMany.mockResolvedValueOnce({ count: 2 });

    const res = await request(app())
      .delete("/attendance/purge-all?role=STAFF&eventType=CLASE")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);

    expect(res.status).toBe(200);
    expect(prismaMock.attendance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          event: expect.objectContaining({ type: "CLASE" }),
          user: { orgRole: { code: "STAFF" } },
        }),
        select: { id: true },
      }),
    );
    expect(prismaMock.attendance.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["a1", "a2"] } },
    });
  });

  it("GET /attendance/stats usa userId propio para teacher", async () => {
    prismaMock.attendance.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    const res = await request(app())
      .get("/attendance/stats")
      .set("Authorization", `Bearer ${tok("TEACHER")}`);
    expect(res.status).toBe(200);
    expect(res.body.attendanceRate).toBe(80);
    expect(prismaMock.attendance.count.mock.calls[0][0].where.userId).toBe("user-1");
  });

  it("GET /attendance/stats con filtro userId no serializa tasas nulas", async () => {
    prismaMock.attendance.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const res = await request(app())
      .get("/attendance/stats?userId=user-2")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);

    expect(res.status).toBe(200);
    expect(res.body.attendanceRate).toBe(0);
    expect(res.body.lateRate).toBe(0);
    expect(res.body.absenceRate).toBe(0);
    expect(res.body.exitRate).toBe(0);
    expect(res.body.earlyExitRate).toBe(0);
    expect(res.body.attendanceRate).not.toBeNull();
    expect(prismaMock.attendance.count.mock.calls[0][0].where.userId).toBe("user-2");
  });

  it("POST /attendance/:id/note 400 con nota vacía", async () => {
    const res = await request(app())
      .post("/attendance/a1/note")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ note: "  " });
    expect(res.status).toBe(400);
  });

  it("POST /attendance/:id/note 404 si no existe asistencia", async () => {
    prismaMock.attendance.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .post("/attendance/a1/note")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ note: "Motivo" });
    expect(res.status).toBe(404);
  });

  it("POST /attendance/:id/note 403 si no tiene permisos", async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({ id: "a1", userId: "other-user", type: "CHECK_IN" });
    const res = await request(app())
      .post("/attendance/a1/note")
      .set("Authorization", `Bearer ${tok("STAFF")}`)
      .send({ note: "Motivo" });
    expect(res.status).toBe(403);
  });

  it("POST /attendance/:id/note actualiza nota y status", async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({ id: "a1", userId: "user-1", type: "CHECK_IN", status: "PRESENT", notes: null });
    prismaMock.attendance.update.mockResolvedValue({ id: "a1", status: "LATE", notes: "Llegué tarde" });
    const res = await request(app())
      .post("/attendance/a1/note")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ note: " Llegué tarde ", markLate: true });
    expect(res.status).toBe(200);
    expect(res.body.attendance.status).toBe("LATE");
  });

  it("POST /attendance/:id/note marca salida anticipada en check-out", async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({ id: "a1", userId: "user-1", type: "CHECK_OUT", status: "EXIT", notes: null });
    prismaMock.attendance.update.mockResolvedValue({ id: "a1", status: "EARLY_EXIT", notes: "Me fui antes" });
    const res = await request(app())
      .post("/attendance/a1/note")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ note: " Me fui antes ", markEarlyExit: true });
    expect(res.status).toBe(200);
    expect(res.body.attendance.status).toBe("EARLY_EXIT");
  });

  it("POST /attendance/:id/note 500 si update falla", async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({ id: "a1", userId: "user-1", type: "CHECK_IN", status: "PRESENT", notes: null });
    prismaMock.attendance.update.mockRejectedValueOnce(new Error("db"));
    const res = await request(app())
      .post("/attendance/a1/note")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ note: "Motivo" });
    expect(res.status).toBe(500);
  });

  it("POST /attendance/mark-absences 400 sin rango requerido", async () => {
    const res = await request(app())
      .post("/attendance/mark-absences")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("POST /attendance/mark-absences trata YYYY-MM-DD como día completo de Uruguay", async () => {
    prismaMock.event.findMany.mockResolvedValue([]);

    const res = await request(app())
      .post("/attendance/mark-absences")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ startDate: "2025-06-01", endDate: "2025-06-01" });

    expect(res.status).toBe(200);
    const where = prismaMock.event.findMany.mock.calls[0][0].where;
    expect(where.startDate.gte.toISOString()).toBe("2025-06-01T03:00:00.000Z");
    expect(where.startDate.lte.toISOString()).toBe("2025-06-02T02:59:59.999Z");
  });

  it("POST /attendance/mark-absences crea ausencias justificadas y no justificadas", async () => {
    prismaMock.event.findMany.mockResolvedValue([
      {
        id: "ev1",
        assignedUserId: "user-1",
        type: "CLASE",
        status: "SCHEDULED",
        startDate: new Date("2025-06-01T08:00:00.000Z"),
        startTime: new Date("2025-06-01T08:00:00.000Z"),
        endTime: new Date("2025-06-01T09:00:00.000Z"),
      },
      {
        id: "ev2",
        assignedUserId: "user-1",
        type: "CLASE",
        status: "SCHEDULED",
        startDate: new Date("2025-06-02T08:00:00.000Z"),
        startTime: new Date("2025-06-02T08:00:00.000Z"),
        endTime: new Date("2025-06-02T09:00:00.000Z"),
      },
    ]);
    prismaMock.attendance.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prismaMock.medicalLeave.findMany
      .mockResolvedValueOnce([
        {
          reason: "Licencia médica presentada",
          startDate: new Date("2025-06-01T00:00:00.000Z"),
          endDate: new Date("2025-06-01T23:59:59.999Z"),
        },
      ])
      .mockResolvedValueOnce([]);
    prismaMock.attendance.create.mockResolvedValue({});
    const res = await request(app())
      .post("/attendance/mark-absences")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ startDate: "2025-06-01T00:00:00.000Z", endDate: "2025-06-30T00:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(res.body.markedAbsences).toBe(2);
  });

  it("POST /attendance/mark-absences ignora eventos con asistencia existente", async () => {
    prismaMock.event.findMany.mockResolvedValue([
      {
        id: "ev1",
        assignedUserId: "user-1",
        type: "CLASE",
        status: "SCHEDULED",
        startDate: new Date("2025-06-01T08:00:00.000Z"),
        startTime: new Date("2025-06-01T08:00:00.000Z"),
        endTime: new Date("2025-06-01T09:00:00.000Z"),
      },
    ]);
    prismaMock.attendance.findFirst.mockResolvedValueOnce({ id: "existing" });
    const res = await request(app())
      .post("/attendance/mark-absences")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ startDate: "2025-06-01T00:00:00.000Z", endDate: "2025-06-30T00:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(res.body.markedAbsences).toBe(0);
    expect(prismaMock.attendance.create).not.toHaveBeenCalled();
  });

  it("POST /attendance/mark-absences 500 si falla el proceso", async () => {
    prismaMock.event.findMany.mockRejectedValueOnce(new Error("db"));
    const res = await request(app())
      .post("/attendance/mark-absences")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ startDate: "2025-06-01T00:00:00.000Z", endDate: "2025-06-30T00:00:00.000Z" });
    expect(res.status).toBe(500);
  });

  it("GET /attendance/stats TEACHER solo ve sus datos", async () => {
    prismaMock.attendance.count.mockResolvedValue(3);
    const res = await request(app())
      .get("/attendance/stats")
      .set("Authorization", `Bearer ${tok("TEACHER")}`);
    expect(res.status).toBe(200);
    expect(res.body.totalAttendances).toBe(3);
    const w = prismaMock.attendance.count.mock.calls[0][0].where;
    expect(w.userId).toBe("user-1");
    expect(w.type).toBe("CHECK_IN");
  });

  it("GET /attendance/stats ADMIN filtra por userId", async () => {
    prismaMock.attendance.count.mockResolvedValue(0);
    const res = await request(app())
      .get("/attendance/stats?userId=other-user")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(200);
    expect(prismaMock.attendance.count.mock.calls[0][0].where.userId).toBe("other-user");
  });

  it("GET /attendance/stats calcula estados de salida cuando se filtra CHECK_OUT", async () => {
    prismaMock.attendance.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);

    const res = await request(app())
      .get("/attendance/stats?type=CHECK_OUT")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);

    expect(res.status).toBe(200);
    expect(res.body.exitCount).toBe(3);
    expect(res.body.earlyExitCount).toBe(1);
    expect(res.body.exitRate).toBe(75);
    expect(res.body.earlyExitRate).toBe(25);
    expect(prismaMock.attendance.count.mock.calls[0][0].where.type).toBe("CHECK_OUT");
  });

  it("GET /attendance/stats suma incidencias de ausencia cuando se pide feed mixto", async () => {
    prismaMock.attendance.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0);
    prismaMock.attendanceIncident.count.mockResolvedValueOnce(3);

    const res = await request(app())
      .get("/attendance/stats?includeIncidents=true")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);

    expect(res.status).toBe(200);
    expect(res.body.totalAttendances).toBe(13);
    expect(res.body.absentCount).toBe(4);
    expect(prismaMock.attendanceIncident.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "TEACHER_NO_SHOW", status: "OPEN" }),
      }),
    );
  });

  it("GET /attendance/stats suma ausencias virtuales de eventos vencidos", async () => {
    prismaMock.attendance.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaMock.attendanceIncident.count.mockResolvedValueOnce(0);
    prismaMock.event.findMany.mockResolvedValueOnce([
      {
        id: "ev-absent",
        title: "Ingles Tercero C",
        type: "CLASE",
        status: "SCHEDULED",
        startDate: new Date("2026-05-20T18:00:00.000Z"),
        startTime: new Date("2026-05-20T18:00:00.000Z"),
        endTime: new Date("2026-05-20T19:00:00.000Z"),
        isRecurring: false,
        recurrenceEnd: null,
        daysOfWeek: [],
        effectiveFrom: null,
        effectiveUntil: null,
        assignedUserId: "teacher-1",
        courseOfferingId: "co-1",
        courseOffering: { id: "co-1", course: { name: "Tercero C", code: "3C" } },
        subject: { name: "Ingles" },
      },
    ]);
    prismaMock.attendance.findMany.mockResolvedValueOnce([]);
    prismaMock.user.findMany.mockResolvedValueOnce([
      {
        id: "teacher-1",
        name: "Jorge Marrero",
        email: "jorge@example.com",
        username: "jorge",
        firstName: null,
        lastName: null,
        orgRole: { code: "TEACHER" },
      },
    ]);
    prismaMock.medicalLeave.findMany.mockResolvedValueOnce([]);

    const res = await request(app())
      .get("/attendance/stats?includeIncidents=true&startDate=2026-05-20&endDate=2026-05-20")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);

    expect(res.status).toBe(200);
    expect(res.body.totalAttendances).toBe(3);
    expect(res.body.absentCount).toBe(1);
    expect(res.body.presentCount).toBe(1);
  });

  it("GET /attendance/stats 500 si falla el conteo", async () => {
    prismaMock.attendance.count.mockRejectedValueOnce(new Error("db"));
    const res = await request(app())
      .get("/attendance/stats")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(500);
  });

  it("POST /attendance/mark-absences marca SUBSTITUTED cuando hay suplencia", async () => {
    prismaMock.event.findMany.mockResolvedValue([
      {
        id: "ev1",
        assignedUserId: "user-1",
        type: "CLASE",
        status: "SCHEDULED",
        startDate: new Date("2025-06-01T08:00:00.000Z"),
        startTime: new Date("2025-06-01T08:00:00.000Z"),
        endTime: new Date("2025-06-01T09:00:00.000Z"),
        schoolYearId: "sy1",
      },
    ]);
    // 1ª llamada $queryRaw: día no laborable (vacío); 2ª: suplencia encontrada
    prismaMock.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "sub-1" }]);
    prismaMock.attendance.findFirst.mockResolvedValueOnce(null);
    prismaMock.attendance.create.mockResolvedValue({});
    const res = await request(app())
      .post("/attendance/mark-absences")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ startDate: "2025-06-01T00:00:00.000Z", endDate: "2025-06-30T00:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(res.body.markedAbsences).toBe(1);
    expect(prismaMock.attendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SUBSTITUTED" }) }),
    );
  });

  it("POST /attendance/mark-absences registra ausencias previstas (expectedAbsence)", async () => {
    prismaMock.event.findMany.mockResolvedValue([
      {
        id: "ev1",
        assignedUserId: "user-1",
        type: "CLASE",
        status: "SCHEDULED",
        startDate: new Date("2025-06-01T08:00:00.000Z"),
        startTime: new Date("2025-06-01T08:00:00.000Z"),
        endTime: new Date("2025-06-01T09:00:00.000Z"),
        schoolYearId: "sy1",
      },
    ]);
    prismaMock.attendance.findFirst.mockResolvedValueOnce(null);
    prismaMock.medicalLeave.findMany.mockResolvedValue([]);
    prismaMock.attendance.create.mockResolvedValue({});
    const res = await request(app())
      .post("/attendance/mark-absences")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ startDate: "2025-06-01T00:00:00.000Z", endDate: "2025-06-30T00:00:00.000Z", expectedAbsence: true });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/ausencias previstas/i);
    expect(prismaMock.attendance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "ABSENT_NOT_JUSTIFIED",
          notes: expect.stringMatching(/prevista sin justificar/i),
        }),
      }),
    );
  });

  it("POST /attendance/register 400 si el evento está cancelado", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: eid,
      assignedUserId: "user-1",
      type: "CLASE",
      status: "CANCELLED",
      startTime: new Date("2025-06-01T08:00:00.000Z"),
      endTime: new Date("2025-06-01T09:00:00.000Z"),
    });
    const res = await request(app())
      .post("/attendance/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send(validBody);
    expect(res.status).toBe(400);
  });

  it("POST /attendance/register permite a un suplente oficial", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: eid,
      assignedUserId: "otro-docente",
      type: "CLASE",
      status: "SCHEDULED",
      startDate: new Date("2025-06-01T00:00:00.000Z"),
      startTime: new Date("2025-06-01T08:00:00.000Z"),
      endTime: new Date("2025-06-01T09:00:00.000Z"),
    });
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: "sub-1" }]).mockResolvedValueOnce([]);
    prismaMock.attendance.findFirst.mockResolvedValue(null);
    prismaMock.medicalLeave.findMany.mockResolvedValue([]);
    prismaMock.attendance.create.mockResolvedValue({ id: "a-sup", user: {}, event: {} });
    const res = await request(app())
      .post("/attendance/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send(validBody);
    expect(res.status).toBe(200);
  });

  it("POST /attendance/register 403 en día no laborable", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: eid,
      assignedUserId: "user-1",
      type: "CLASE",
      status: "SCHEDULED",
      startDate: new Date("2025-06-01T00:00:00.000Z"),
      startTime: new Date("2025-06-01T08:00:00.000Z"),
      endTime: new Date("2025-06-01T09:00:00.000Z"),
    });
    prismaMock.attendance.findFirst.mockResolvedValue(null);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "nwd-1", reason: "Feriado", date: new Date(), type: "HOLIDAY", notes: null }]);
    const res = await request(app())
      .post("/attendance/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ATTENDANCE_BLOCKED_BY_NON_WORKING_DAY");
  });

  it("POST /attendance/register procesa CHECK_OUT con tolerancia de salida", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: eid,
      assignedUserId: "user-1",
      type: "CLASE",
      status: "SCHEDULED",
      startDate: new Date("2025-06-01T00:00:00.000Z"),
      startTime: new Date("2025-06-01T08:00:00.000Z"),
      endTime: new Date("2025-06-01T09:00:00.000Z"),
    });
    prismaMock.attendance.findFirst.mockResolvedValue(null);
    prismaMock.medicalLeave.findMany.mockResolvedValue([]);
    prismaMock.attendance.create.mockResolvedValue({ id: "a-out", user: {}, event: {} });
    const res = await request(app())
      .post("/attendance/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ ...validBody, type: "CHECK_OUT", time: "2025-06-01T09:00:00.000Z" });
    expect(res.status).toBe(200);
  });

  it("PUT /attendance/:id 404 si no existe", async () => {
    prismaMock.attendance.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .put("/attendance/att-x")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ status: "PRESENT" });
    expect(res.status).toBe(404);
  });

  it("DELETE /attendance/purge-all sin coincidencias", async () => {
    prismaMock.attendance.findMany.mockResolvedValue([]);
    const res = await request(app())
      .delete("/attendance/purge-all")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(0);
    expect(prismaMock.attendance.deleteMany).not.toHaveBeenCalled();
  });

  it("GET /attendance/stats no cuenta incidencias si el tipo no es CHECK_IN", async () => {
    prismaMock.attendance.count.mockResolvedValue(0);
    const res = await request(app())
      .get("/attendance/stats?includeIncidents=true&type=CHECK_OUT")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(200);
    expect(prismaMock.attendanceIncident.count).not.toHaveBeenCalled();
  });

  it("GET /attendance/stats no cuenta incidencias si el status no es ABSENT_NOT_JUSTIFIED", async () => {
    prismaMock.attendance.count.mockResolvedValue(0);
    const res = await request(app())
      .get("/attendance/stats?includeIncidents=true&type=CHECK_IN&status=PRESENT")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(200);
    expect(prismaMock.attendanceIncident.count).not.toHaveBeenCalled();
  });

  it("POST /attendance/mark-absences con allYears no filtra por ciclo", async () => {
    prismaMock.event.findMany.mockResolvedValue([]);
    const res = await request(app())
      .post("/attendance/mark-absences")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ startDate: "2025-06-01", endDate: "2025-06-30", allYears: true });
    expect(res.status).toBe(200);
    expect(res.body.totalEvents).toBe(0);
  });

  it("POST /attendance/mark-absences aplica filtros de ciclo, usuario y evento", async () => {
    prismaMock.event.findMany.mockResolvedValue([]);
    const res = await request(app())
      .post("/attendance/mark-absences")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({
        startDate: "2025-06-01",
        endDate: "2025-06-30",
        userId: "user-1",
        eventId: "ev1",
        schoolYearId: "sy1",
      });
    expect(res.status).toBe(200);
    const where = prismaMock.event.findMany.mock.calls[0][0].where;
    expect(where.id).toBe("ev1");
    expect(where.assignedUserId).toBe("user-1");
  });

  it("POST /attendance/mark-absences ignora eventos sin docente asignado", async () => {
    prismaMock.event.findMany.mockResolvedValue([
      { id: "ev1", assignedUserId: null, startDate: new Date("2025-06-01T08:00:00.000Z"), startTime: new Date("2025-06-01T08:00:00.000Z"), endTime: new Date("2025-06-01T09:00:00.000Z") },
    ]);
    const res = await request(app())
      .post("/attendance/mark-absences")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ startDate: "2025-06-01", endDate: "2025-06-30" });
    expect(res.status).toBe(200);
    expect(res.body.markedAbsences).toBe(0);
  });

  it("POST /attendance/mark-absences salta días no laborables", async () => {
    prismaMock.event.findMany.mockResolvedValue([
      { id: "ev1", assignedUserId: "user-1", startDate: new Date("2025-06-01T08:00:00.000Z"), startTime: new Date("2025-06-01T08:00:00.000Z"), endTime: new Date("2025-06-01T09:00:00.000Z"), schoolYearId: "sy1" },
    ]);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: "nwd-1", reason: "Feriado", date: new Date(), type: "HOLIDAY", notes: null }]);
    const res = await request(app())
      .post("/attendance/mark-absences")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ startDate: "2025-06-01", endDate: "2025-06-30" });
    expect(res.status).toBe(200);
    expect(res.body.markedAbsences).toBe(0);
    expect(prismaMock.attendance.create).not.toHaveBeenCalled();
  });

  it("PUT /attendance/:id registra el motivo provisto", async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({ id: "a1", status: "PRESENT", notes: null });
    prismaMock.attendance.update.mockResolvedValue({ id: "a1", status: "LATE", notes: "x", user: {}, event: {} });
    const res = await request(app())
      .put("/attendance/a1")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ status: "LATE", reason: "Corrección manual" });
    expect(res.status).toBe(200);
  });

  it("GET /attendance/my-attendances 500 si falla la consulta", async () => {
    prismaMock.attendance.findMany.mockRejectedValueOnce(new Error("db"));
    const res = await request(app())
      .get("/attendance/my-attendances?type=CHECK_IN&status=PRESENT")
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(500);
  });

  it("GET /attendance/all mapea incidencia con campos nulos", async () => {
    prismaMock.attendance.count.mockResolvedValue(0);
    prismaMock.attendanceIncident.count.mockResolvedValue(1);
    prismaMock.attendance.findMany.mockResolvedValue([]);
    prismaMock.attendanceIncident.findMany.mockResolvedValue([
      {
        id: "inc-1",
        detectedAt: null,
        createdAt: new Date("2025-06-01T08:00:00.000Z"),
        type: "TEACHER_NO_SHOW",
        status: "OPEN",
        severity: "HIGH",
        title: "No show",
        description: null,
        user: null,
        event: null,
      },
    ]);
    const res = await request(app())
      .get("/attendance/all?includeIncidents=true")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].notes).toBeNull();
  });

  it("GET /attendance/all filtra YYYY-MM-DD como día completo de Uruguay", async () => {
    prismaMock.attendance.count.mockResolvedValue(0);
    prismaMock.attendance.findMany.mockResolvedValue([]);

    const res = await request(app())
      .get("/attendance/all?startDate=2025-06-01&endDate=2025-06-01")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);

    expect(res.status).toBe(200);
    const where = prismaMock.attendance.count.mock.calls[0][0].where;
    expect(where.date.gte.toISOString()).toBe("2025-06-01T03:00:00.000Z");
    expect(where.date.lte.toISOString()).toBe("2025-06-02T02:59:59.999Z");
  });

  it("POST /attendance/materialize-absence crea una ausencia editable desde una virtual", async () => {
    const eventId = "00000000-0000-4000-8000-0000000000e2";
    const userId = "00000000-0000-4000-8000-000000000011";
    prismaMock.event.findUnique.mockResolvedValue({
      id: eventId,
      title: "Clase nocturna",
      type: "CLASE",
      startTime: new Date("2026-06-09T01:21:00.000Z"),
      endTime: new Date("2026-06-09T01:30:00.000Z"),
      assignedUserId: userId,
      schoolYearId: "sy1",
    });
    prismaMock.attendance.findFirst.mockResolvedValueOnce(null);
    prismaMock.attendance.create.mockResolvedValue({
      id: "att-abs",
      userId,
      eventId,
      type: "CHECK_IN",
      status: "ABSENT_NOT_JUSTIFIED",
      date: new Date("2026-06-08T03:00:00.000Z"),
      time: new Date("2026-06-09T01:21:00.000Z"),
      notes: "Ausencia pendiente",
      user: { id: userId, name: "Joaquin", email: "j@example.com", orgRole: { code: "TEACHER" } },
      event: { id: eventId, title: "Clase nocturna", type: "CLASE", startTime: new Date("2026-06-09T01:21:00.000Z"), endTime: new Date("2026-06-09T01:30:00.000Z") },
    });

    const res = await request(app())
      .post("/attendance/materialize-absence")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({
        userId,
        eventId,
        date: "2026-06-08",
        status: "ABSENT_NOT_JUSTIFIED",
        notes: "Ausencia pendiente",
      });

    expect(res.status).toBe(201);
    expect(prismaMock.attendance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId,
          eventId,
          type: "CHECK_IN",
          status: "ABSENT_NOT_JUSTIFIED",
          date: new Date("2026-06-08T03:00:00.000Z"),
          time: new Date("2026-06-09T01:21:00.000Z"),
        }),
      }),
    );
    expect(res.body.id).toBe("att-abs");
  });

  it("GET /attendance/all feed mixto con todos los filtros", async () => {
    prismaMock.attendance.count.mockResolvedValue(1);
    prismaMock.attendanceIncident.count.mockResolvedValue(1);
    prismaMock.attendance.findMany.mockResolvedValue([
      {
        id: "att-1",
        date: new Date("2025-06-02T00:00:00.000Z"),
        time: new Date("2025-06-02T08:00:00.000Z"),
        type: "CHECK_IN",
        status: "PRESENT",
        user: { id: "user-1", name: "Ada", email: "a@a.com", orgRole: { code: "TEACHER" } },
        event: { id: "ev1", title: "Clase", type: "CLASE" },
      },
    ]);
    prismaMock.attendanceIncident.findMany.mockResolvedValue([
      {
        id: "inc-1",
        detectedAt: new Date("2025-06-01T08:00:00.000Z"),
        type: "TEACHER_NO_SHOW",
        status: "OPEN",
        severity: "HIGH",
        title: "No show",
        description: "Falta docente",
        user: { id: "user-1", name: "Ada", email: "a@a.com", orgRole: { code: "TEACHER" } },
        event: { id: "ev1", title: "Clase", type: "CLASE" },
      },
    ]);
    const res = await request(app())
      .get(
        `/attendance/all?includeIncidents=true&startDate=2025-06-01&endDate=2025-06-30&userId=user-1&eventId=ev1&eventType=CLASE&type=CHECK_IN&status=ABSENT_NOT_JUSTIFIED&role=teacher`,
      )
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data.some((row: { kind?: string }) => row.kind === "INCIDENT")).toBe(true);
  });
});
