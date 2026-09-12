import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../test-utils/bearer-token.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    event: { findMany: vi.fn() },
    nonWorkingDay: { findMany: vi.fn() },
    studentAttendanceSession: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    studentAttendanceEntry: { findUnique: vi.fn(), update: vi.fn() },
    studentAttendanceJustification: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn(),
  },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/school-year-service.js", () => ({
  resolveSchoolYearIdForList: vi.fn().mockResolvedValue("sy-1"),
}));

import adminStudentAttendanceRoutes from "./admin-student-attendance.js";
import { authGuard, requirePermission } from "../middlewares/auth.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  // Se monta igual que en admin.ts: authGuard global + permiso de scope all.
  a.use("/admin/student-attendance", authGuard, requirePermission("student-attendance.manage", "all"), adminStudentAttendanceRoutes);
  return a;
}

const tok = (role = "ADMIN", sub = "admin-1") =>
  signAccessToken({ sub, email: "a@a.com", role: role as "ADMIN" });

const ENTRY_ID = "55555555-5555-4555-8555-555555555555";

describe("admin student-attendance routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-05-13T12:00:00.000Z"));
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.auditLog.create.mockResolvedValue({});
    prismaMock.event.findMany.mockResolvedValue([]);
    prismaMock.nonWorkingDay.findMany.mockResolvedValue([]);
    prismaMock.studentAttendanceSession.findMany.mockResolvedValue([]);
    prismaMock.studentAttendanceJustification.create.mockResolvedValue({ id: "just-1" });
  });

  it("401 sin auth", async () => {
    const res = await request(app()).get("/admin/student-attendance/pending");
    expect(res.status).toBe(401);
  });

  it("403 para un docente: el control es de administración", async () => {
    const res = await request(app())
      .get("/admin/student-attendance/pending")
      .set("Authorization", `Bearer ${tok("TEACHER", "teacher-1")}`);
    expect(res.status).toBe(403);
  });

  it("lista vacía cuando no hay clases en el rango", async () => {
    const res = await request(app())
      .get("/admin/student-attendance/pending?from=2026-05-11&to=2026-05-13")
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, data: [] });
  });

  it("400 si el rango está invertido", async () => {
    const res = await request(app())
      .get("/admin/student-attendance/pending?from=2026-05-20&to=2026-05-01")
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(400);
  });

  it("400 si la fecha no es YYYY-MM-DD", async () => {
    const res = await request(app())
      .get("/admin/student-attendance/pending?from=05-2026")
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(400);
  });

  it("recorta rangos mayores al máximo y lo informa", async () => {
    const res = await request(app())
      .get("/admin/student-attendance/pending?from=2026-01-01&to=2026-12-31")
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(200);
    expect(res.body.rangeClamped).toBe(true);
  });

  it("400 si la justificación no trae motivo", async () => {
    const res = await request(app())
      .post(`/admin/student-attendance/entries/${ENTRY_ID}/justify`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ reason: "" });
    expect(res.status).toBe(400);
  });

  it("404 si la marca no existe", async () => {
    prismaMock.studentAttendanceEntry.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .post(`/admin/student-attendance/entries/${ENTRY_ID}/justify`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ reason: "Certificado médico" });
    expect(res.status).toBe(404);
  });

  it("409 si el estado no es ausente: no hay nada que justificar", async () => {
    prismaMock.studentAttendanceEntry.findUnique.mockResolvedValue({
      id: ENTRY_ID,
      status: "PRESENT",
      note: null,
      studentId: "st-1",
      session: { id: "sess-1", occurrenceYmd: "2026-05-11", eventId: "ev-1" },
    });
    const res = await request(app())
      .post(`/admin/student-attendance/entries/${ENTRY_ID}/justify`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ reason: "Certificado médico" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_JUSTIFIABLE");
  });

  it("justifica una ausencia dejando la transición y la auditoría", async () => {
    prismaMock.studentAttendanceEntry.findUnique.mockResolvedValue({
      id: ENTRY_ID,
      status: "ABSENT",
      note: null,
      studentId: "st-1",
      session: { id: "sess-1", occurrenceYmd: "2026-05-11", eventId: "ev-1" },
    });
    prismaMock.studentAttendanceEntry.update.mockResolvedValue({ id: ENTRY_ID, status: "ABSENT_JUSTIFIED" });

    const res = await request(app())
      .post(`/admin/student-attendance/entries/${ENTRY_ID}/justify`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ reason: "Certificado médico" });

    expect(res.status).toBe(200);
    expect(prismaMock.studentAttendanceJustification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ previousStatus: "ABSENT", newStatus: "ABSENT_JUSTIFIED" }),
      }),
    );
    expect(prismaMock.studentAttendanceEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ABSENT_JUSTIFIED" }) }),
    );
    expect(prismaMock.$executeRaw).toHaveBeenCalled();
  });

  it("400 al reabrir sin motivo", async () => {
    const res = await request(app())
      .post("/admin/student-attendance/sessions/sess-1/reopen")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ reason: "" });
    expect(res.status).toBe(400);
  });

  it("reabre una planilla cerrada y lo audita", async () => {
    prismaMock.studentAttendanceSession.findUnique.mockResolvedValue({
      id: "sess-1",
      eventId: "ev-1",
      occurrenceYmd: "2026-05-11",
    });
    prismaMock.studentAttendanceSession.update.mockResolvedValue({ id: "sess-1" });

    const res = await request(app())
      .post("/admin/student-attendance/sessions/sess-1/reopen")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ reason: "El docente pidió corregir" });

    expect(res.status).toBe(200);
    expect(prismaMock.studentAttendanceSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lockedAt: null, lockedByUserId: null } }),
    );
    expect(prismaMock.$executeRaw).toHaveBeenCalled();
  });
});
