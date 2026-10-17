import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../test-utils/bearer-token.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    event: { findMany: vi.fn(), findUnique: vi.fn() },
    substitution: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    nonWorkingDay: { findMany: vi.fn() },
    studentAttendanceSession: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    studentAttendanceEntry: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
    studentAttendanceJustification: { create: vi.fn() },
    studentEnrollment: { findFirst: vi.fn(), findMany: vi.fn() },
    studentAbsenceJustificationRange: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn(),
  },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/school-year-service.js", () => ({
  resolveSchoolYearIdForList: vi.fn().mockResolvedValue("sy-1"),
}));
vi.mock("../services/non-working-days.js", () => ({
  findNonWorkingDayForDate: vi.fn().mockResolvedValue(null),
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
    prismaMock.substitution.findMany.mockResolvedValue([]);
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

  describe("un día cubierto por un suplente", () => {
    const coveredClass = {
      id: "ev-1",
      title: "Matemática",
      type: "CLASE",
      status: "SCHEDULED",
      parentEventId: null,
      isRecurring: false,
      recurrenceType: "NONE",
      startDate: new Date("2026-05-11T11:00:00.000Z"),
      startTime: new Date("2026-05-11T11:00:00.000Z"),
      endTime: new Date("2026-05-11T12:00:00.000Z"),
      subject: { name: "Matemática" },
      orientation: null,
      courseOrientation: null,
      courseOffering: { course: { name: "3.º A" } },
      assignedUser: { id: "titular-1", name: "Ana Titular", username: "ana" },
      childEvents: [],
    };

    beforeEach(() => {
      prismaMock.event.findMany.mockResolvedValue([coveredClass]);
      prismaMock.substitution.findMany.mockImplementation(async (args: any) =>
        args.where.substituteUserId
          ? args.where.substituteUserId === "suplente-1" ? [{ eventId: "ev-1" }] : []
          : [{ eventId: "ev-1", date: new Date("2026-05-11T03:00:00.000Z"), substitute: { id: "suplente-1", name: "Bruno Suplente", username: "bruno" } }],
      );
    });

    it("la lista sin pasar es responsabilidad del suplente, no del titular", async () => {
      const res = await request(app())
        .get("/admin/student-attendance/pending?from=2026-05-11&to=2026-05-11")
        .set("Authorization", `Bearer ${tok()}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({ teacher: { id: "suplente-1", name: "Bruno Suplente" }, covered: true });
    });

    it("el filtro por docente encuentra al suplente y no le cuenta esa lista al titular", async () => {
      const bySubstitute = await request(app())
        .get("/admin/student-attendance/pending?from=2026-05-11&to=2026-05-11&teacherUserId=suplente-1")
        .set("Authorization", `Bearer ${tok()}`);
      expect(bySubstitute.body.data).toHaveLength(1);
      expect(prismaMock.event.findMany.mock.calls[0][0].where.OR).toEqual([
        { assignedUserId: "suplente-1" },
        { id: { in: ["ev-1"] } },
      ]);

      const byTitular = await request(app())
        .get("/admin/student-attendance/pending?from=2026-05-11&to=2026-05-11&teacherUserId=titular-1")
        .set("Authorization", `Bearer ${tok()}`);
      expect(byTitular.body.data).toHaveLength(0);
    });
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
    prismaMock.studentAttendanceEntry.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.studentAttendanceEntry.findUniqueOrThrow.mockResolvedValue({ id: ENTRY_ID, status: "ABSENT_JUSTIFIED" });

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
    expect(prismaMock.studentAttendanceEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ENTRY_ID, status: "ABSENT" },
        data: expect.objectContaining({ status: "ABSENT_JUSTIFIED" }),
      }),
    );
    expect(prismaMock.$executeRaw).toHaveBeenCalled();
  });

  it("409 si el docente cambió la marca mientras se justificaba: no se justifica a un presente", async () => {
    prismaMock.studentAttendanceEntry.findUnique.mockResolvedValue({
      id: ENTRY_ID,
      status: "ABSENT",
      note: null,
      studentId: "st-1",
      session: { id: "sess-1", occurrenceYmd: "2026-05-11", eventId: "ev-1" },
    });
    // Leída como ausente; al escribir ya no lo es.
    prismaMock.studentAttendanceEntry.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app())
      .post(`/admin/student-attendance/entries/${ENTRY_ID}/justify`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ reason: "Certificado médico" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_JUSTIFIABLE");
    expect(prismaMock.studentAttendanceJustification.create).not.toHaveBeenCalled();
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

  describe("justificación por días (ciclo básico)", () => {
    const STUDENT = "66666666-6666-4666-8666-666666666666";
    const body = { studentId: STUDENT, fromYmd: "2026-05-11", toYmd: "2026-05-12", reason: "Viaje familiar" };

    beforeEach(() => {
      prismaMock.studentEnrollment.findFirst.mockResolvedValue({
        schoolYearId: "sy-1",
        courseOffering: { course: { level: "EBI" } },
      });
      prismaMock.studentAbsenceJustificationRange.create.mockResolvedValue({ id: "range-1" });
      prismaMock.studentAttendanceEntry.findMany.mockResolvedValue([{ id: ENTRY_ID, note: null }]);
      prismaMock.studentAttendanceEntry.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.studentAttendanceEntry.findUniqueOrThrow.mockResolvedValue({});
    });

    it("crea el rango y justifica las ausencias ya marcadas", async () => {
      const res = await request(app())
        .post("/admin/student-attendance/justification-ranges")
        .set("Authorization", `Bearer ${tok()}`)
        .send(body);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ range: { id: "range-1" }, justifiedCount: 1 });
    });

    it("400 con el rango invertido", async () => {
      const res = await request(app())
        .post("/admin/student-attendance/justification-ranges")
        .set("Authorization", `Bearer ${tok()}`)
        .send({ ...body, fromYmd: "2026-05-13" });
      expect(res.status).toBe(400);
    });

    it("409 para un estudiante que no es de ciclo básico", async () => {
      prismaMock.studentEnrollment.findFirst.mockResolvedValue({
        schoolYearId: "sy-1",
        courseOffering: { course: { level: "EMS" } },
      });
      const res = await request(app())
        .post("/admin/student-attendance/justification-ranges")
        .set("Authorization", `Bearer ${tok()}`)
        .send(body);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("NOT_BASIC_CYCLE");
    });

    it("lista los rangos del estudiante", async () => {
      prismaMock.studentAbsenceJustificationRange.findMany.mockResolvedValue([{ id: "range-1" }]);
      const res = await request(app())
        .get(`/admin/student-attendance/justification-ranges?studentId=${STUDENT}`)
        .set("Authorization", `Bearer ${tok()}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ id: "range-1" }]);
      expect(prismaMock.studentAbsenceJustificationRange.findMany.mock.calls[0][0].where).toEqual({
        studentId: STUDENT,
        schoolYearId: "sy-1",
      });
    });

    it("el buscador sólo trae estudiantes de ciclo básico", async () => {
      prismaMock.studentEnrollment.findMany.mockResolvedValue([
        { student: { id: STUDENT, firstName: "Ana", lastName: "Díaz", documentId: "1" }, courseOffering: { course: { name: "7 EBI" } } },
      ]);
      const res = await request(app())
        .get("/admin/student-attendance/justification-ranges/students?q=ana diaz")
        .set("Authorization", `Bearer ${tok()}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ id: STUDENT, firstName: "Ana", lastName: "Díaz", documentId: "1", courseName: "7 EBI" }]);
      const where = prismaMock.studentEnrollment.findMany.mock.calls[0][0].where;
      expect(where.courseOffering).toEqual({ course: { level: "EBI" } });
      expect(where.AND).toHaveLength(2);
    });

    it("con menos de dos letras no busca", async () => {
      const res = await request(app())
        .get("/admin/student-attendance/justification-ranges/students?q=a")
        .set("Authorization", `Bearer ${tok()}`);
      expect(res.body.data).toEqual([]);
      expect(prismaMock.studentEnrollment.findMany).not.toHaveBeenCalled();
    });

    it("revoca un rango", async () => {
      prismaMock.studentAbsenceJustificationRange.findUnique.mockResolvedValue({ id: "range-1", revokedAt: null });
      prismaMock.studentAbsenceJustificationRange.update.mockResolvedValue({ id: "range-1" });
      const res = await request(app())
        .post("/admin/student-attendance/justification-ranges/range-1/revoke")
        .set("Authorization", `Bearer ${tok()}`);
      expect(res.status).toBe(200);
    });
  });

  describe("estado de la lista de una clase, para la Agenda", () => {
    const EVENT_ID = "11111111-1111-4111-8111-111111111111";
    const YMD = "2026-05-11"; // lunes
    const url = `/admin/student-attendance/sessions/${EVENT_ID}/${YMD}/status`;

    beforeEach(() => {
      // Matemática de los lunes 08:00–09:00 (11:00–12:00 UTC).
      prismaMock.event.findUnique.mockResolvedValue({
        id: EVENT_ID,
        title: "Matemática",
        type: "CLASE",
        status: "SCHEDULED",
        parentEventId: null,
        isRecurring: true,
        recurrenceType: "WEEKLY",
        daysOfWeek: [1],
        startDate: new Date("2026-05-04T11:00:00.000Z"),
        startTime: new Date("2026-05-04T11:00:00.000Z"),
        endTime: new Date("2026-05-04T12:00:00.000Z"),
        recurrenceEnd: new Date("2026-12-01T00:00:00.000Z"),
        effectiveFrom: null,
        effectiveUntil: null,
        childEvents: [],
        assignedUserId: "teacher-1",
        assignedUser: { id: "teacher-1", name: "Ana Pérez" },
      });
      prismaMock.substitution.findUnique.mockResolvedValue(null);
      prismaMock.studentAttendanceSession.findUnique.mockResolvedValue(null);
    });

    it("sin lista: pendiente, con el titular y desde cuándo abre", async () => {
      const res = await request(app()).get(url).set("Authorization", `Bearer ${tok()}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        startAt: "2026-05-11T11:00:00.000Z",
        endAt: "2026-05-11T12:00:00.000Z",
        opensAt: "2026-05-11T10:50:00.000Z",
        teacher: { id: "teacher-1", name: "Ana Pérez" },
        substitute: null,
        rollCall: { status: "PENDING", takenAt: null, takenBy: null },
      });
    });

    it("lista pasada: quién, cuándo y cuántos presentes, tardes y ausentes", async () => {
      prismaMock.substitution.findUnique.mockResolvedValue({ substitute: { id: "sub-1", name: "Juan Gómez" } });
      prismaMock.studentAttendanceSession.findUnique.mockResolvedValue({
        status: "TAKEN",
        takenAt: new Date("2026-05-11T11:07:00.000Z"),
        rosterSize: 4,
        takenBy: { id: "sub-1", name: "Juan Gómez" },
        entries: [{ status: "PRESENT" }, { status: "PRESENT" }, { status: "LATE" }, { status: "ABSENT" }],
      });
      const res = await request(app()).get(url).set("Authorization", `Bearer ${tok()}`);
      expect(res.body.substitute).toEqual({ id: "sub-1", name: "Juan Gómez" });
      expect(res.body.rollCall).toEqual({
        status: "TAKEN",
        takenAt: "2026-05-11T11:07:00.000Z",
        takenBy: "Juan Gómez",
        rosterSize: 4,
        counts: { PRESENT: 2, LATE: 1, ABSENT: 1, ABSENT_JUSTIFIED: 0 },
      });
    });

    it("409 si la clase no se dicta ese día", async () => {
      const res = await request(app())
        .get(`/admin/student-attendance/sessions/${EVENT_ID}/2026-05-12/status`)
        .set("Authorization", `Bearer ${tok()}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("NO_OCCURRENCE");
    });
  });
});
