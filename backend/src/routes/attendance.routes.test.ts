import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../jwt.js";

const eid = "00000000-0000-4000-8000-0000000000e1";
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    event: { findUnique: vi.fn(), findMany: vi.fn() },
    attendance: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    medicalLeave: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("../prisma.js", () => ({ prisma: prismaMock }));

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
  beforeEach(() => vi.clearAllMocks());

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
      startTime: null,
      endTime: null,
    });
    const res = await request(app())
      .post("/attendance/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("409 duplicado mismo día y tipo", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: eid,
      assignedUserId: "user-1",
      startTime: new Date("2025-06-01T08:00:00.000Z"),
      endTime: null,
    });
    prismaMock.attendance.findFirst.mockResolvedValue({ id: "dup" });
    const res = await request(app())
      .post("/attendance/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send(validBody);
    expect(res.status).toBe(409);
    expect(String(res.body.message)).toMatch(/entrada|registro/i);
  });

  it("201 registro feliz", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: eid,
      assignedUserId: "user-1",
      startDate: new Date("2025-06-01T00:00:00.000Z"),
      startTime: new Date("2025-06-01T08:00:00.000Z"),
      endTime: null,
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

  it("POST /attendance/register 403 si licencia activa cubre el horario del evento", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: eid,
      assignedUserId: "user-1",
      startDate: new Date("2025-06-01T00:00:00.000Z"),
      startTime: new Date("2025-06-01T08:00:00.000Z"),
      endTime: null,
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
      startDate: new Date("2025-06-01T00:00:00.000Z"),
      startTime: new Date("2025-06-01T08:00:00.000Z"),
      endTime: null,
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
    prismaMock.attendance.update.mockResolvedValue({ id: "a1", status: "LATE" });
    const res = await request(app())
      .put("/attendance/a1")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ status: "LATE", notes: "Llegó tarde" });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("a1");
  });

  it("PUT /attendance/:id 500 si update falla", async () => {
    prismaMock.attendance.update.mockRejectedValueOnce(new Error("db"));
    const res = await request(app())
      .put("/attendance/a1")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ status: "LATE" });
    expect(res.status).toBe(500);
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

  it("POST /attendance/biometric 400 sin datos obligatorios", async () => {
    const res = await request(app())
      .post("/attendance/biometric")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("POST /attendance/biometric 400 si ya existe entrada y salida", async () => {
    prismaMock.attendance.findFirst
      .mockResolvedValueOnce({ id: "in-1" })
      .mockResolvedValueOnce({ id: "out-1" });
    const res = await request(app())
      .post("/attendance/biometric")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ userId: "user-1", timestamp: "2025-06-01T12:00:00.000Z", deviceId: "dev-1" });
    expect(res.status).toBe(400);
  });

  it("POST /attendance/biometric crea salida automática si ya había entrada", async () => {
    prismaMock.attendance.findFirst
      .mockResolvedValueOnce({ id: "in-1" })
      .mockResolvedValueOnce(null);
    prismaMock.attendance.create.mockResolvedValue({ id: "out-1" });
    const res = await request(app())
      .post("/attendance/biometric")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ userId: "user-1", timestamp: "2025-06-01T12:00:00.000Z", deviceId: "dev-1" });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe("CHECK_OUT");
  });

  it("POST /attendance/biometric crea entrada y detecta retraso", async () => {
    prismaMock.attendance.findFirst.mockResolvedValueOnce(null);
    prismaMock.attendance.create.mockResolvedValue({ id: "in-1" });
    const res = await request(app())
      .post("/attendance/biometric")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ userId: "user-1", timestamp: "2025-06-01T09:10:00.000Z", deviceId: "dev-1" });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe("CHECK_IN");
    expect(res.body).toHaveProperty("isLate");
  });

  it("POST /attendance/biometric 500 si falla create", async () => {
    prismaMock.attendance.findFirst.mockResolvedValueOnce(null);
    prismaMock.attendance.create.mockRejectedValueOnce(new Error("db"));
    const res = await request(app())
      .post("/attendance/biometric")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({ userId: "user-1", timestamp: "2025-06-01T09:10:00.000Z", deviceId: "dev-1" });
    expect(res.status).toBe(500);
  });

  it("POST /attendance/:id/note 400 con nota vacía", async () => {
    const res = await request(app())
      .post("/attendance/a1/note")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ note: "  " });
    expect(res.status).toBe(400);
  });

  it("POST /attendance/:id/note 404 si no existe asistencia", async () => {
    prismaMock.attendance.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .post("/attendance/a1/note")
      .set("Authorization", `Bearer ${tok()}`)
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
    prismaMock.attendance.findUnique.mockResolvedValue({ id: "a1", userId: "user-1", type: "CHECK_IN" });
    prismaMock.attendance.update.mockResolvedValue({ id: "a1", status: "LATE", notes: "Llegué tarde" });
    const res = await request(app())
      .post("/attendance/a1/note")
      .set("Authorization", `Bearer ${tok("STAFF")}`)
      .send({ note: " Llegué tarde ", markLate: true });
    expect(res.status).toBe(200);
    expect(res.body.attendance.status).toBe("LATE");
  });

  it("POST /attendance/:id/note marca salida anticipada en check-out", async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({ id: "a1", userId: "user-1", type: "CHECK_OUT" });
    prismaMock.attendance.update.mockResolvedValue({ id: "a1", status: "JUSTIFIED_ABSENCE", notes: "Me fui antes" });
    const res = await request(app())
      .post("/attendance/a1/note")
      .set("Authorization", `Bearer ${tok("STAFF")}`)
      .send({ note: " Me fui antes ", markEarlyExit: true });
    expect(res.status).toBe(200);
    expect(res.body.attendance.status).toBe("JUSTIFIED_ABSENCE");
  });

  it("POST /attendance/:id/note 500 si update falla", async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({ id: "a1", userId: "user-1", type: "CHECK_IN" });
    prismaMock.attendance.update.mockRejectedValueOnce(new Error("db"));
    const res = await request(app())
      .post("/attendance/a1/note")
      .set("Authorization", `Bearer ${tok("STAFF")}`)
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

  it("POST /attendance/mark-absences crea ausencias justificadas y no justificadas", async () => {
    prismaMock.event.findMany.mockResolvedValue([
      {
        id: "ev1",
        assignedUserId: "user-1",
        startDate: new Date("2025-06-01T08:00:00.000Z"),
        startTime: new Date("2025-06-01T08:00:00.000Z"),
      },
      {
        id: "ev2",
        assignedUserId: "user-1",
        startDate: new Date("2025-06-02T08:00:00.000Z"),
        startTime: new Date("2025-06-02T08:00:00.000Z"),
      },
    ]);
    prismaMock.attendance.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prismaMock.medicalLeave.findFirst
      .mockResolvedValueOnce({ reason: "Certificado" })
      .mockResolvedValueOnce(null);
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
        startDate: new Date("2025-06-01T08:00:00.000Z"),
        startTime: new Date("2025-06-01T08:00:00.000Z"),
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
  });

  it("GET /attendance/stats ADMIN filtra por userId", async () => {
    prismaMock.attendance.count.mockResolvedValue(0);
    const res = await request(app())
      .get("/attendance/stats?userId=other-user")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(200);
    expect(prismaMock.attendance.count.mock.calls[0][0].where.userId).toBe("other-user");
  });

  it("GET /attendance/stats 500 si falla el conteo", async () => {
    prismaMock.attendance.count.mockRejectedValueOnce(new Error("db"));
    const res = await request(app())
      .get("/attendance/stats")
      .set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(500);
  });
});
