import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../test-utils/bearer-token.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    event: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    substitution: { findUnique: vi.fn(), findMany: vi.fn() },
    studentEnrollment: { findMany: vi.fn() },
    studentAttendanceSession: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    studentAttendanceEntry: { upsert: vi.fn() },
    medicalLeave: { findMany: vi.fn() },
    systemSettings: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn(),
  },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/non-working-days.js", () => ({
  findNonWorkingDayForDate: vi.fn().mockResolvedValue(null),
}));
vi.mock("../config/system-settings.js", () => ({
  getStudentRollCallSettings: vi.fn().mockResolvedValue({
    editWindowHours: 48,
    copyPreviousEnabled: true,
    dailyAbsenceThresholdPercent: 50,
  }),
}));

import { findNonWorkingDayForDate } from "../services/non-working-days.js";
import studentAttendanceRoutes from "./student-attendance.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use("/student-attendance", studentAttendanceRoutes);
  return a;
}

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const STUDENT_A = "22222222-2222-4222-8222-222222222222";
const STUDENT_B = "33333333-3333-4333-8333-333333333333";
const TEACHER_ID = "teacher-1";
const YMD = "2026-05-11"; // lunes

const tok = (role = "TEACHER", sub = TEACHER_ID) =>
  signAccessToken({ sub, email: "t@t.com", role: role as "TEACHER" });

/** Clase semanal de los lunes 08:00–09:00 UY (11:00–12:00 UTC). */
function classEvent(overrides: Record<string, unknown> = {}) {
  return {
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
    assignedUserId: TEACHER_ID,
    schoolYearId: "sy-1",
    courseOfferingId: "co-1",
    orientationId: null,
    courseOrientationId: null,
    subjectId: "su-1",
    subject: { id: "su-1", name: "Matemática", code: null },
    orientation: null,
    courseOrientation: null,
    courseOffering: { id: "co-1", course: { id: "c-1", name: "3ºB", code: null } },
    assignedUser: { id: TEACHER_ID, name: "Ana", username: "ana" },
    ...overrides,
  };
}

function roster() {
  return [
    { id: "en-1", student: { id: STUDENT_A, firstName: "Ana", lastName: "Alvez", documentId: "1" } },
    { id: "en-2", student: { id: STUDENT_B, firstName: "Bruno", lastName: "Bentos", documentId: "2" } },
  ];
}

const body = (entries: unknown[]) => ({ entries });

describe("student-attendance routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-05-11T13:00:00.000Z")); // clase ya terminada, dentro de ventana
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.auditLog.create.mockResolvedValue({});
    prismaMock.event.findUnique.mockResolvedValue(classEvent());
    prismaMock.substitution.findUnique.mockResolvedValue(null);
    prismaMock.substitution.findMany.mockResolvedValue([]);
    prismaMock.studentEnrollment.findMany.mockResolvedValue(roster());
    prismaMock.studentAttendanceSession.findUnique.mockResolvedValue(null);
    prismaMock.studentAttendanceSession.findMany.mockResolvedValue([]);
    prismaMock.studentAttendanceSession.upsert.mockResolvedValue({ id: "sess-1" });
    prismaMock.studentAttendanceEntry.upsert.mockResolvedValue({});
    prismaMock.medicalLeave.findMany.mockResolvedValue([]);
    (findNonWorkingDayForDate as any).mockResolvedValue(null);
  });

  it("401 sin auth", async () => {
    const res = await request(app()).get(`/student-attendance/sessions/${EVENT_ID}/${YMD}`);
    expect(res.status).toBe(401);
  });

  it("400 si el eventId es el compuesto uuid_ymd de una ocurrencia", async () => {
    const res = await request(app())
      .get(`/student-attendance/sessions/${EVENT_ID}_${YMD}/${YMD}`)
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(400);
  });

  it("404 si la clase no existe", async () => {
    prismaMock.event.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .get(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(404);
  });

  it("403 si el docente no es el asignado ni suplente", async () => {
    prismaMock.event.findUnique.mockResolvedValue(classEvent({ assignedUserId: "otro" }));
    const res = await request(app())
      .get(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(403);
  });

  it("200 si es suplente activo ese día", async () => {
    prismaMock.event.findUnique.mockResolvedValue(classEvent({ assignedUserId: "otro" }));
    prismaMock.substitution.findUnique.mockResolvedValue({ substituteUserId: TEACHER_ID });
    const res = await request(app())
      .get(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(200);
    expect(res.body.students).toHaveLength(2);
  });

  it("409 si la clase no se dicta ese día", async () => {
    const res = await request(app())
      .get(`/student-attendance/sessions/${EVENT_ID}/2026-05-12`)
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NO_OCCURRENCE");
  });

  it("409 si la ocurrencia está suspendida ese día", async () => {
    prismaMock.event.findUnique.mockResolvedValue(
      classEvent({ childEvents: [{ startDate: new Date("2026-05-11T11:00:00.000Z"), status: "CANCELLED" }] }),
    );
    const res = await request(app())
      .get(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("OCCURRENCE_SUSPENDED");
  });

  it("409 con redirectEventId si la fecha pertenece a otra versión del horario", async () => {
    prismaMock.event.findUnique.mockResolvedValue(
      classEvent({ effectiveFrom: new Date("2026-06-01T03:00:00.000Z"), revisionOf: "root-1" }),
    );
    prismaMock.event.findFirst.mockResolvedValue({ id: "version-vieja" });
    const res = await request(app())
      .get(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "OUT_OF_EFFECTIVE_WINDOW", redirectEventId: "version-vieja" });
  });

  it("409 si el día es no laborable", async () => {
    (findNonWorkingDayForDate as any).mockResolvedValue({ id: "nw", reason: "Feriado" });
    const res = await request(app())
      .get(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NON_WORKING_DAY");
  });

  it("400 si el body intenta escribir ABSENT_JUSTIFIED", async () => {
    const res = await request(app())
      .put(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send(body([{ studentId: STUDENT_A, status: "ABSENT_JUSTIFIED" }]));
    expect(res.status).toBe(400);
  });

  it("400 si manda un alumno que ya no está en el grupo", async () => {
    const res = await request(app())
      .put(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send(body([{ studentId: "44444444-4444-4444-8444-444444444444", status: "PRESENT" }]));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("STUDENT_NOT_IN_ROSTER");
  });

  it("guarda la lista y hace upsert una vez por alumno", async () => {
    const res = await request(app())
      .put(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send(body([
        { studentId: STUDENT_A, status: "PRESENT" },
        { studentId: STUDENT_B, status: "LATE", note: "llegó 8:15" },
      ]));
    expect(res.status).toBe(200);
    expect(prismaMock.studentAttendanceEntry.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.studentAttendanceSession.upsert).toHaveBeenCalledTimes(1);
  });

  it("conserva la justificación de secretaría si el docente reenvía ABSENT", async () => {
    prismaMock.studentAttendanceSession.findUnique.mockResolvedValue({
      id: "sess-1",
      takenAt: new Date("2026-05-11T12:10:00.000Z"),
      takenByUserId: TEACHER_ID,
      lockedAt: null,
      entries: [{ studentId: STUDENT_A, status: "ABSENT_JUSTIFIED" }],
    });
    await request(app())
      .put(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send(body([{ studentId: STUDENT_A, status: "ABSENT" }]));

    const call = prismaMock.studentAttendanceEntry.upsert.mock.calls[0][0];
    expect(call.update.status).toBe("ABSENT_JUSTIFIED");
  });

  it("409 fuera de la ventana de edición del docente", async () => {
    vi.setSystemTime(new Date("2026-05-20T13:00:00.000Z"));
    const res = await request(app())
      .put(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send(body([{ studentId: STUDENT_A, status: "PRESENT" }]));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("WINDOW_EXPIRED");
  });

  it("administración sí puede editar fuera de la ventana", async () => {
    vi.setSystemTime(new Date("2026-05-20T13:00:00.000Z"));
    const res = await request(app())
      .put(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
      .set("Authorization", `Bearer ${tok("ADMIN", "admin-1")}`)
      .send(body([{ studentId: STUDENT_A, status: "PRESENT" }]));
    expect(res.status).toBe(200);
  });

  it("my-classes devuelve eventId y ymd separados, nunca el compuesto", async () => {
    prismaMock.event.findMany.mockResolvedValue([classEvent()]);
    const res = await request(app())
      .get(`/student-attendance/my-classes?date=${YMD}`)
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].eventId).toBe(EVENT_ID);
    expect(res.body[0].ymd).toBe(YMD);
    expect(res.body[0].rollCall.status).toBe("PENDING");
  });

  it("my-classes rechaza una fecha inválida", async () => {
    const res = await request(app())
      .get("/student-attendance/my-classes?date=05-2026")
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(400);
  });

  describe("la lista abre 10 minutos antes de la clase", () => {
    it("409 NOT_STARTED si el docente la quiere pasar antes", async () => {
      vi.setSystemTime(new Date("2026-05-11T10:49:00.000Z")); // 07:49, la clase es 08:00
      const res = await request(app())
        .put(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
        .set("Authorization", `Bearer ${tok()}`)
        .send(body([{ studentId: STUDENT_A, status: "PRESENT" }]));
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: "NOT_STARTED",
        message: "La lista se abre a las 07:50, 10 minutos antes de la clase.",
      });
      expect(prismaMock.studentAttendanceSession.upsert).not.toHaveBeenCalled();
    });

    it("a las 07:50 ya se puede", async () => {
      vi.setSystemTime(new Date("2026-05-11T10:50:00.000Z"));
      const res = await request(app())
        .put(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
        .set("Authorization", `Bearer ${tok()}`)
        .send(body([{ studentId: STUDENT_A, status: "PRESENT" }]));
      expect(res.status).toBe(200);
    });

    it("administración tampoco pasa la lista de una clase de mañana", async () => {
      vi.setSystemTime(new Date("2026-05-10T13:00:00.000Z"));
      const res = await request(app())
        .put(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
        .set("Authorization", `Bearer ${tok("ADMIN", "admin-1")}`)
        .send(body([{ studentId: STUDENT_A, status: "PRESENT" }]));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("NOT_STARTED");
    });

    it("la planilla dice desde cuándo abre", async () => {
      vi.setSystemTime(new Date("2026-05-11T10:00:00.000Z"));
      const res = await request(app())
        .get(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
        .set("Authorization", `Bearer ${tok()}`);
      expect(res.status).toBe(200);
      expect(res.body.rollCall).toMatchObject({
        canEdit: false,
        blockedReason: "NOT_STARTED",
        opensAt: "2026-05-11T10:50:00.000Z",
      });
    });
  });

  describe("quién da la clase", () => {
    it("la planilla trae titular, suplente y quién pasó la lista", async () => {
      prismaMock.event.findUnique.mockResolvedValue(classEvent({ assignedUserId: "otro", assignedUser: { id: "otro", name: "Ana Pérez" } }));
      prismaMock.substitution.findUnique.mockResolvedValue({
        substituteUserId: TEACHER_ID,
        substitute: { id: TEACHER_ID, name: null, firstName: "Juan", lastName: "Gómez" },
      });
      prismaMock.studentAttendanceSession.findUnique.mockResolvedValue({
        id: "sess-1",
        status: "TAKEN",
        takenAt: new Date("2026-05-11T11:07:00.000Z"),
        takenBy: { id: TEACHER_ID, name: null, firstName: "Juan", lastName: "Gómez" },
        lockedAt: null,
        entries: [],
      });
      const res = await request(app())
        .get(`/student-attendance/sessions/${EVENT_ID}/${YMD}`)
        .set("Authorization", `Bearer ${tok()}`);
      expect(res.status).toBe(200);
      expect(res.body.teacher).toEqual({ id: "otro", name: "Ana Pérez" });
      expect(res.body.substitute).toEqual({ id: TEACHER_ID, name: "Juan Gómez" });
      expect(res.body.rollCall.takenBy).toBe("Juan Gómez");
    });

    it("my-classes dice quién cubre la clase del titular y desde cuándo abre", async () => {
      prismaMock.event.findMany.mockResolvedValue([classEvent()]);
      prismaMock.substitution.findMany.mockResolvedValue([
        { eventId: EVENT_ID, substituteUserId: "suplente-1", substitute: { id: "suplente-1", name: "Juan Gómez" } },
      ]);
      const res = await request(app())
        .get(`/student-attendance/my-classes?date=${YMD}`)
        .set("Authorization", `Bearer ${tok()}`);
      expect(res.status).toBe(200);
      expect(res.body[0]).toMatchObject({
        teacher: { id: TEACHER_ID, name: "Ana" },
        substitute: { id: "suplente-1", name: "Juan Gómez" },
        isSubstitution: false,
      });
      expect(res.body[0].rollCall.opensAt).toBe("2026-05-11T10:50:00.000Z");
    });

    it("my-classes incluye la clase que el docente cubre como suplente", async () => {
      prismaMock.substitution.findMany.mockResolvedValue([
        { eventId: EVENT_ID, substituteUserId: TEACHER_ID, substitute: { id: TEACHER_ID, name: "Ana" } },
      ]);
      prismaMock.event.findMany.mockResolvedValue([classEvent({ assignedUserId: "otro", assignedUser: { id: "otro", name: "Beatriz" } })]);
      const res = await request(app())
        .get(`/student-attendance/my-classes?date=${YMD}`)
        .set("Authorization", `Bearer ${tok()}`);
      const where = prismaMock.event.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ assignedUserId: TEACHER_ID }, { id: { in: [EVENT_ID] } }]);
      expect(res.body[0]).toMatchObject({ isSubstitution: true, teacher: { name: "Beatriz" } });
      expect(res.body[0].rollCall.canEdit).toBe(true);
    });
  });

  describe("reminder: listas que me toca pasar hoy", () => {
    beforeEach(() => {
      vi.setSystemTime(new Date("2026-05-11T11:05:00.000Z")); // 08:05, en plena clase
      prismaMock.event.findMany.mockResolvedValue([classEvent()]);
    });

    it("trae la clase de hoy sin pasar, con sus horarios", async () => {
      const res = await request(app())
        .get("/student-attendance/reminder")
        .set("Authorization", `Bearer ${tok()}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        eventId: EVENT_ID,
        ymd: YMD,
        startAt: "2026-05-11T11:00:00.000Z",
        endAt: "2026-05-11T12:00:00.000Z",
      });
      expect(res.body.items[0].rollCall.opensAt).toBe("2026-05-11T10:50:00.000Z");
    });

    it("siempre las propias, aunque quien pida tenga alcance total", async () => {
      await request(app())
        .get("/student-attendance/reminder")
        .set("Authorization", `Bearer ${tok("ADMIN", "admin-1")}`);
      const where = prismaMock.event.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ assignedUserId: "admin-1" }, { id: { in: [] } }]);
    });

    it("no recuerda una lista ya pasada", async () => {
      prismaMock.studentAttendanceSession.findMany.mockResolvedValue([
        { id: "sess-1", eventId: EVENT_ID, status: "TAKEN", takenAt: new Date("2026-05-11T11:03:00.000Z"), lockedAt: null },
      ]);
      const res = await request(app())
        .get("/student-attendance/reminder")
        .set("Authorization", `Bearer ${tok()}`);
      expect(res.body.items).toEqual([]);
    });

    it("al titular cubierto por un suplente no le recuerda nada", async () => {
      prismaMock.substitution.findMany.mockResolvedValue([
        { eventId: EVENT_ID, substituteUserId: "suplente-1", substitute: { id: "suplente-1", name: "Juan" } },
      ]);
      const res = await request(app())
        .get("/student-attendance/reminder")
        .set("Authorization", `Bearer ${tok()}`);
      expect(res.body.items).toEqual([]);
    });

    it("con licencia aprobada ese día, tampoco", async () => {
      prismaMock.medicalLeave.findMany.mockResolvedValue([
        { id: "lic-1", startDate: new Date("2026-05-11T00:00:00.000Z"), endDate: new Date("2026-05-11T00:00:00.000Z") },
      ]);
      const res = await request(app())
        .get("/student-attendance/reminder")
        .set("Authorization", `Bearer ${tok()}`);
      expect(res.body.items).toEqual([]);
    });

    it("en un día no laborable no hay nada que pasar", async () => {
      (findNonWorkingDayForDate as any).mockResolvedValue({ id: "nw", reason: "Feriado" });
      const res = await request(app())
        .get("/student-attendance/reminder")
        .set("Authorization", `Bearer ${tok()}`);
      expect(res.body.items).toEqual([]);
    });
  });
});
