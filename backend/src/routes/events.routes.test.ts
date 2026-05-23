import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../auth/jwt.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(async (cb) => cb(prismaMock)),
    course: { findFirst: vi.fn() },
    courseOffering: { findFirst: vi.fn() },
    subject: { findFirst: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
    inAppNotification: { create: vi.fn().mockResolvedValue({ id: "n1" }) },
    event: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/school-year-service.js", () => ({
  getActiveSchoolYearId: vi.fn().mockResolvedValue("sy-default"),
  resolveSchoolYearIdForList: vi.fn().mockResolvedValue("sy-default"),
  getActiveSchoolYear: vi.fn().mockResolvedValue({ id: "sy-default", code: 2026, status: "ACTIVE" }),
}));
vi.mock("@prisma/client", () => ({
  AuditAction: {
    EVENT_CREATED: "EVENT_CREATED",
  },
}));

import eventsRoutes from "./events.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use("/events", eventsRoutes);
  return a;
}

const iso = "2025-12-15T14:00:00.000Z";
const minimalEvent = {
  title: "Clase test",
  type: "CLASE",
  startDate: iso,
  startTime: "10:00",
  endTime: "11:00",
  isRecurring: false,
  daysOfWeek: [],
  recurrenceType: "NONE" as const,
};

describe("events routes (prisma mock)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.course.findFirst.mockResolvedValue(null);
    prismaMock.courseOffering.findFirst.mockResolvedValue(null);
    prismaMock.subject.findFirst.mockResolvedValue(null);
  });

  it("POST /events 400 validación zod", async () => {
    const tok = signAccessToken({ sub: "a", email: "a@a.com", role: "ADMIN" });
    const res = await request(app()).post("/events").set("Authorization", `Bearer ${tok}`).send({});
    expect(res.status).toBe(400);
  });

  it("POST /events TEACHER no asigna a otro usuario", async () => {
    const tok = signAccessToken({ sub: "t1", email: "t@t.com", role: "TEACHER" });
    const other = "00000000-0000-4000-8000-000000000002";
    const res = await request(app())
      .post("/events")
      .set("Authorization", `Bearer ${tok}`)
      .send({ ...minimalEvent, assignedUserId: other });
    expect(res.status).toBe(403);
  });

  it("POST /events ADMIN crea", async () => {
    prismaMock.event.create.mockResolvedValue({
      id: "ev1",
      title: "X",
      userId: "adm",
      assignedUserId: null,
      user: {},
      assignedUser: null,
    });
    const tok = signAccessToken({ sub: "adm", email: "a@a.com", role: "ADMIN" });
    const res = await request(app())
      .post("/events")
      .set("Authorization", `Bearer ${tok}`)
      .send(minimalEvent);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("ev1");
    expect(prismaMock.inAppNotification.create).not.toHaveBeenCalled();
    expect(prismaMock.course.findFirst).not.toHaveBeenCalled();
  });

  it("POST /events 400 si courseId no existe o está inactivo", async () => {
    const courseId = "00000000-0000-4000-8000-0000000000c1";
    prismaMock.course.findFirst.mockResolvedValueOnce(null);
    const tok = signAccessToken({ sub: "adm", email: "a@a.com", role: "ADMIN" });
    const res = await request(app())
      .post("/events")
      .set("Authorization", `Bearer ${tok}`)
      .send({ ...minimalEvent, courseId });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Curso/i);
    expect(prismaMock.event.create).not.toHaveBeenCalled();
  });

  it("POST /events 400 si subjectId sin courseId", async () => {
    const subId = "00000000-0000-4000-8000-0000000000a1";
    const tok = signAccessToken({ sub: "adm", email: "a@a.com", role: "ADMIN" });
    const res = await request(app())
      .post("/events")
      .set("Authorization", `Bearer ${tok}`)
      .send({ ...minimalEvent, subjectId: subId });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/curso/i);
    expect(prismaMock.event.create).not.toHaveBeenCalled();
  });

  it("POST /events 400 si subjectId no pertenece al curso", async () => {
    const courseId = "00000000-0000-4000-8000-0000000000c2";
    const subId = "00000000-0000-4000-8000-0000000000a1";
    prismaMock.courseOffering.findFirst.mockResolvedValueOnce({ id: "off-1", courseId, schoolYearId: "sy-default" });
    prismaMock.subject.findFirst.mockResolvedValueOnce(null);
    const tok = signAccessToken({ sub: "adm", email: "a@a.com", role: "ADMIN" });
    const res = await request(app())
      .post("/events")
      .set("Authorization", `Bearer ${tok}`)
      .send({ ...minimalEvent, courseId, subjectId: subId });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Asignatura/i);
    expect(prismaMock.event.create).not.toHaveBeenCalled();
  });

  it("POST /events ADMIN crea con courseId activo", async () => {
    const courseId = "00000000-0000-4000-8000-0000000000c2";
    prismaMock.courseOffering.findFirst.mockResolvedValueOnce({ id: "off-1", courseId, schoolYearId: "sy-default" });
    prismaMock.event.create.mockResolvedValue({
      id: "ev1",
      title: "X",
      userId: "adm",
      assignedUserId: null,
      user: {},
      assignedUser: null,
      courseOffering: { id: "off-1", courseId, course: { id: courseId, name: "Curso", code: "c1" } },
    });
    const tok = signAccessToken({ sub: "adm", email: "a@a.com", role: "ADMIN" });
    const res = await request(app())
      .post("/events")
      .set("Authorization", `Bearer ${tok}`)
      .send({ ...minimalEvent, courseId });
    expect(res.status).toBe(200);
    expect(prismaMock.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ courseOfferingId: "off-1", schoolYearId: "sy-default" }),
      }),
    );
  });

  it("POST /events ADMIN asigna a otro usuario y crea aviso en app", async () => {
    const teacherId = "00000000-0000-4000-8000-000000000002";
    prismaMock.event.create.mockResolvedValue({
      id: "ev2",
      title: "Reunión pedagógica",
      userId: "adm",
      assignedUserId: teacherId,
      user: { id: "adm", orgRole: { code: "ADMIN" } },
      assignedUser: { id: teacherId, name: "Doc", email: "t@t.com", orgRole: { code: "TEACHER" } },
    });
    const tok = signAccessToken({ sub: "adm", email: "a@a.com", role: "ADMIN" });
    const res = await request(app())
      .post("/events")
      .set("Authorization", `Bearer ${tok}`)
      .send({ ...minimalEvent, title: "Reunión pedagógica", assignedUserId: teacherId });
    expect(res.status).toBe(200);
    expect(prismaMock.inAppNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: teacherId,
          type: "EVENT_ASSIGNED",
          actionUrl: "/me/events",
        }),
      }),
    );
  });

  it("POST /events 500 si create falla", async () => {
    prismaMock.event.create.mockRejectedValueOnce(new Error("db"));
    const tok = signAccessToken({ sub: "adm", email: "a@a.com", role: "ADMIN" });
    const res = await request(app())
      .post("/events")
      .set("Authorization", `Bearer ${tok}`)
      .send(minimalEvent);
    expect(res.status).toBe(500);
  });

  it("GET /events/my-events expande lista", async () => {
    prismaMock.event.findMany.mockResolvedValue([
      {
        id: "e1",
        isRecurring: false,
        daysOfWeek: [],
        startDate: iso,
        user: {},
        assignedUser: null,
        _count: { attendances: 0 },
      },
    ]);
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "STAFF" });
    const res = await request(app())
      .get("/events/my-events")
      .set("Authorization", `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /events/my-events aplica filtros de tipo y status", async () => {
    prismaMock.event.findMany.mockResolvedValue([]);
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "STAFF" });
    const res = await request(app())
      .get("/events/my-events?type=CLASE&status=SCHEDULED")
      .set("Authorization", `Bearer ${tok}`);
    expect(res.status).toBe(200);
    const where = prismaMock.event.findMany.mock.calls[0][0].where;
    expect(where.type).toBe("CLASE");
    expect(where.status).toBe("SCHEDULED");
    expect(where.schoolYearId).toBe("sy-default");
  });

  it("GET /events/my-events aplica filtro courseId", async () => {
    prismaMock.event.findMany.mockResolvedValue([]);
    const cid = "00000000-0000-4000-8000-0000000000c1";
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "STAFF" });
    const res = await request(app())
      .get(`/events/my-events?courseId=${cid}`)
      .set("Authorization", `Bearer ${tok}`);
    expect(res.status).toBe(200);
    const where = prismaMock.event.findMany.mock.calls[0][0].where;
    expect(where.courseOffering.courseId).toBe(cid);
  });

  it("GET /events/all ADMIN", async () => {
    prismaMock.event.count.mockResolvedValue(1);
    prismaMock.event.findMany.mockResolvedValue([]);
    const tok = signAccessToken({ sub: "a", email: "a@a.com", role: "ADMIN" });
    const res = await request(app()).get("/events/all").set("Authorization", `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("GET /events/all aplica filtros", async () => {
    prismaMock.event.count.mockResolvedValue(0);
    prismaMock.event.findMany.mockResolvedValue([]);
    const tok = signAccessToken({ sub: "a", email: "a@a.com", role: "ADMIN" });
    const res = await request(app())
      .get("/events/all?userId=u1&assignedUserId=u2&type=CLASE&status=SCHEDULED&startDate=2025-01-01T00:00:00.000Z&endDate=2025-01-31T00:00:00.000Z")
      .set("Authorization", `Bearer ${tok}`);
    expect(res.status).toBe(200);
    const where = prismaMock.event.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe("u1");
    expect(where.assignedUserId).toBe("u2");
    expect(where.type).toBe("CLASE");
    expect(where.status).toBe("SCHEDULED");
    expect(where.AND[0].OR[0].startDate.gte).toBeInstanceOf(Date);
    expect(where.AND[0].OR[0].startDate.lte).toBeInstanceOf(Date);
    expect(where.AND[0].OR[1].startDate.lte).toBeInstanceOf(Date);
    expect(where.AND[0].OR[1].OR[1].recurrenceEnd.gte).toBeInstanceOf(Date);
    expect(where.schoolYearId).toBe("sy-default");
  });

  it("GET /events/all expande recurrentes y devuelve la próxima instancia del rango", async () => {
    prismaMock.event.count.mockResolvedValue(1);
    prismaMock.event.findMany.mockResolvedValue([
      {
        id: "rec-1",
        title: "Sociología",
        type: "CLASE",
        status: "SCHEDULED",
        isRecurring: true,
        recurrenceType: "WEEKLY",
        recurrenceEnd: new Date("2026-06-30T23:59:59.000Z"),
        daysOfWeek: [1],
        startDate: new Date("2026-03-03T00:00:00.000Z"),
        startTime: new Date("2026-03-03T10:00:00.000Z"),
        endTime: new Date("2026-03-03T11:30:00.000Z"),
        user: {},
        assignedUser: null,
        childEvents: [],
        _count: { attendances: 0 },
      },
    ]);
    const tok = signAccessToken({ sub: "a", email: "a@a.com", role: "ADMIN" });
    const rangeStart = "2026-05-23T12:00:00.000Z";
    const res = await request(app())
      .get(`/events/all?startDate=${rangeStart}&endDate=2026-05-30T12:00:00.000Z&status=SCHEDULED`)
      .set("Authorization", `Bearer ${tok}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toContain("rec-1_");
    expect(new Date(res.body.data[0].startDate).getTime()).toBeGreaterThanOrEqual(new Date(rangeStart).getTime());
    expect(res.body.data[0].startDate).not.toContain("2026-03-03");
  });

  it("GET /events/all aplica filtro courseId", async () => {
    prismaMock.event.count.mockResolvedValue(0);
    prismaMock.event.findMany.mockResolvedValue([]);
    const cid = "00000000-0000-4000-8000-0000000000c2";
    const tok = signAccessToken({ sub: "a", email: "a@a.com", role: "ADMIN" });
    const res = await request(app())
      .get(`/events/all?courseId=${cid}`)
      .set("Authorization", `Bearer ${tok}`);
    expect(res.status).toBe(200);
    const where = prismaMock.event.findMany.mock.calls[0][0].where;
    expect(where.courseOffering.courseId).toBe(cid);
  });

  it("GET /events/all 500 si falla prisma", async () => {
    prismaMock.event.count.mockRejectedValueOnce(new Error("db"));
    const tok = signAccessToken({ sub: "a", email: "a@a.com", role: "ADMIN" });
    const res = await request(app()).get("/events/all").set("Authorization", `Bearer ${tok}`);
    expect(res.status).toBe(500);
  });

  it("GET /events/:id 500 si falla findUnique", async () => {
    prismaMock.event.findUnique.mockRejectedValueOnce(new Error("db"));
    const tok = signAccessToken({ sub: "a", email: "a@a.com", role: "ADMIN" });
    const res = await request(app())
      .get("/events/00000000-0000-4000-8000-000000000099")
      .set("Authorization", `Bearer ${tok}`);
    expect(res.status).toBe(500);
  });

  it("GET /events/:id 404", async () => {
    prismaMock.event.findUnique.mockResolvedValue(null);
    const tok = signAccessToken({ sub: "a", email: "a@a.com", role: "ADMIN" });
    const res = await request(app())
      .get("/events/00000000-0000-4000-8000-000000000099")
      .set("Authorization", `Bearer ${tok}`);
    expect(res.status).toBe(404);
  });

  it("GET /events/:id 403 sin permiso", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: "e1",
      userId: "other",
      assignedUserId: null,
      user: {},
      assignedUser: null,
      attendances: [],
    });
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "TEACHER" });
    const res = await request(app())
      .get("/events/00000000-0000-4000-8000-000000000099")
      .set("Authorization", `Bearer ${tok}`);
    expect(res.status).toBe(403);
  });

  it("GET /events/:id devuelve evento cuando el usuario asignado tiene permiso", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: "e1",
      userId: "other",
      assignedUserId: "u1",
      user: {},
      assignedUser: {},
      attendances: [],
    });
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "TEACHER" });
    const res = await request(app())
      .get("/events/00000000-0000-4000-8000-000000000099")
      .set("Authorization", `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("e1");
  });

  it("PUT /events/:id 400 con body inválido", async () => {
    const tok = signAccessToken({ sub: "a", email: "a@a.com", role: "ADMIN" });
    const res = await request(app())
      .put("/events/e1")
      .set("Authorization", `Bearer ${tok}`)
      .send({ title: "" });
    expect(res.status).toBe(400);
  });

  it("PUT /events/:id 404 si no existe", async () => {
    prismaMock.event.findUnique.mockResolvedValue(null);
    const tok = signAccessToken({ sub: "a", email: "a@a.com", role: "ADMIN" });
    const res = await request(app())
      .put("/events/e1")
      .set("Authorization", `Bearer ${tok}`)
      .send({ title: "Nuevo" });
    expect(res.status).toBe(404);
  });

  it("PUT /events/:id 403 sin permisos", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      userId: "other",
      assignedUserId: "another",
    });
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "TEACHER" });
    const res = await request(app())
      .put("/events/e1")
      .set("Authorization", `Bearer ${tok}`)
      .send({ title: "Nuevo" });
    expect(res.status).toBe(403);
  });

  it("PUT /events/:id actualiza fechas y payload", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      userId: "u1",
      assignedUserId: null,
    });
    prismaMock.event.update.mockResolvedValue({ id: "e1", title: "Nuevo" });
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "TEACHER" });
    const res = await request(app())
      .put("/events/e1")
      .set("Authorization", `Bearer ${tok}`)
      .send({ title: "Nuevo", startDate: iso, startTime: iso, endTime: "2025-12-15T15:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(prismaMock.event.update).toHaveBeenCalled();
  });

  it("PUT /events/:id permite limpiar descripción y desasignar usuario", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      userId: "u1",
      assignedUserId: "00000000-0000-4000-8000-000000000010",
      startDate: new Date("2025-12-15T13:00:00.000Z"),
      startTime: new Date("2025-12-15T13:00:00.000Z"),
      endTime: new Date("2025-12-15T14:00:00.000Z"),
      isRecurring: false,
      recurrenceType: "NONE",
      recurrenceEnd: null,
      daysOfWeek: [],
      status: "SCHEDULED",
    });
    prismaMock.event.update.mockResolvedValue({ id: "e1", description: null, assignedUserId: null });
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "TEACHER" });

    const res = await request(app())
      .put("/events/e1")
      .set("Authorization", `Bearer ${tok}`)
      .send({ description: "", assignedUserId: "" });

    expect(res.status).toBe(200);
    expect(prismaMock.event.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          description: null,
          assignedUserId: null,
        }),
      }),
    );
  });

  it("PUT /events/:id reemplaza logicamente al mover de ciclo si tiene asistencias", async () => {
    const courseId = "00000000-0000-4000-8000-0000000000c1";
    prismaMock.event.findUnique.mockResolvedValue({
      id: "e1",
      title: "Clase",
      description: null,
      type: "CLASE",
      userId: "u1",
      assignedUserId: null,
      location: null,
      schoolYearId: "sy-2025",
      courseOfferingId: "off-old",
      courseOffering: { courseId: "00000000-0000-4000-8000-0000000000c0" },
      subjectId: null,
      _count: { attendances: 1 },
      startDate: new Date("2025-12-15T13:00:00.000Z"),
      startTime: new Date("2025-12-15T13:00:00.000Z"),
      endTime: new Date("2025-12-15T14:00:00.000Z"),
      isRecurring: false,
      recurrenceType: "NONE",
      recurrenceEnd: null,
      daysOfWeek: [],
      status: "SCHEDULED",
    });
    prismaMock.event.create.mockResolvedValueOnce({ id: "e2", title: "Clase", assignedUserId: null });
    prismaMock.event.update.mockResolvedValueOnce({ id: "e1", status: "CANCELLED" });
    prismaMock.courseOffering.findFirst.mockResolvedValueOnce({
      id: "off-new",
      courseId,
      schoolYearId: "sy-2026",
    });
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "TEACHER" });

    const res = await request(app())
      .put(`/events/e1?schoolYearId=sy-2026`)
      .set("Authorization", `Bearer ${tok}`)
      .send({ courseId });

    expect(res.status).toBe(200);
    expect(res.body.historicalReplacement).toBe(true);
    expect(res.body.replacedEventId).toBe("e1");
    expect(prismaMock.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ schoolYearId: "sy-2026", courseOfferingId: "off-new" }),
      }),
    );
    expect(prismaMock.event.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "e1" },
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
  });

  it("PUT /events/:id reemplaza logicamente al cambiar horario si tiene asistencias", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: "e1",
      title: "Clase",
      description: null,
      type: "CLASE",
      userId: "u1",
      assignedUserId: null,
      location: null,
      schoolYearId: "sy-2026",
      courseOfferingId: null,
      courseOffering: null,
      subjectId: null,
      _count: { attendances: 1 },
      startDate: new Date("2025-12-15T13:00:00.000Z"),
      startTime: new Date("2025-12-15T13:00:00.000Z"),
      endTime: new Date("2025-12-15T14:00:00.000Z"),
      isRecurring: false,
      recurrenceType: "NONE",
      recurrenceEnd: null,
      daysOfWeek: [],
      status: "SCHEDULED",
    });
    prismaMock.event.create.mockResolvedValueOnce({ id: "e2", title: "Clase", assignedUserId: null });
    prismaMock.event.update.mockResolvedValueOnce({ id: "e1", status: "CANCELLED" });
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "TEACHER" });

    const res = await request(app())
      .put("/events/e1")
      .set("Authorization", `Bearer ${tok}`)
      .send({ startTime: "10:30" });

    expect(res.status).toBe(200);
    expect(res.body.historicalReplacement).toBe(true);
    expect(prismaMock.event.create).toHaveBeenCalled();
    expect(prismaMock.event.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "e1" },
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
  });

  it("PUT /events/:id permite editar texto si tiene asistencias", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      userId: "u1",
      assignedUserId: null,
      schoolYearId: "sy-2026",
      courseOfferingId: null,
      courseOffering: null,
      subjectId: null,
      _count: { attendances: 1 },
      startDate: new Date("2025-12-15T10:00:00.000Z"),
      startTime: new Date("2025-12-15T10:00:00.000Z"),
      endTime: new Date("2025-12-15T11:00:00.000Z"),
      isRecurring: false,
      recurrenceType: "NONE",
      recurrenceEnd: null,
      daysOfWeek: [],
      status: "SCHEDULED",
    });
    prismaMock.event.update.mockResolvedValue({ id: "e1", title: "Titulo corregido" });
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "TEACHER" });

    const res = await request(app())
      .put("/events/e1")
      .set("Authorization", `Bearer ${tok}`)
      .send({ title: "Titulo corregido", description: "Nota" });

    expect(res.status).toBe(200);
    expect(prismaMock.event.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "Titulo corregido", description: "Nota" }),
      }),
    );
  });

  it("PUT /events/:id 500 si update falla", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      userId: "u1",
      assignedUserId: null,
    });
    prismaMock.event.update.mockRejectedValueOnce(new Error("db"));
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "TEACHER" });
    const res = await request(app())
      .put("/events/e1")
      .set("Authorization", `Bearer ${tok}`)
      .send({ title: "Nuevo" });
    expect(res.status).toBe(500);
  });

  it("PUT /events/:id/cancel 404 si no existe", async () => {
    prismaMock.event.findUnique.mockResolvedValue(null);
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "TEACHER" });
    const res = await request(app())
      .put("/events/e1/cancel")
      .set("Authorization", `Bearer ${tok}`)
      .send({});
    expect(res.status).toBe(404);
  });

  it("PUT /events/:id/cancel 403 si no tiene permisos", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      userId: "other",
      assignedUserId: null,
      status: "SCHEDULED",
      description: "Desc",
    });
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "TEACHER" });
    const res = await request(app())
      .put("/events/e1/cancel")
      .set("Authorization", `Bearer ${tok}`)
      .send({ reason: "No va" });
    expect(res.status).toBe(403);
  });

  it("PUT /events/:id/cancel agrega motivo al description", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      userId: "u1",
      assignedUserId: null,
      status: "SCHEDULED",
      description: "Desc",
    });
    prismaMock.event.update.mockResolvedValue({ id: "e1", status: "CANCELLED" });
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "TEACHER" });
    const res = await request(app())
      .put("/events/e1/cancel")
      .set("Authorization", `Bearer ${tok}`)
      .send({ reason: "No va" });
    expect(res.status).toBe(200);
    expect(prismaMock.event.update).toHaveBeenCalled();
  });

  it("PUT /events/:id/cancel conserva description si no hay motivo", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      userId: "u1",
      assignedUserId: null,
      status: "SCHEDULED",
      description: "Desc",
    });
    prismaMock.event.update.mockResolvedValue({ id: "e1", status: "CANCELLED", description: "Desc" });
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "TEACHER" });
    const res = await request(app())
      .put("/events/e1/cancel")
      .set("Authorization", `Bearer ${tok}`)
      .send({});
    expect(res.status).toBe(200);
    expect(prismaMock.event.update.mock.calls[0][0].data.description).toBe("Desc");
  });

  it("PUT /events/:id/cancel 500 si update falla", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      userId: "u1",
      assignedUserId: null,
      status: "SCHEDULED",
      description: "Desc",
    });
    prismaMock.event.update.mockRejectedValueOnce(new Error("db"));
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "TEACHER" });
    const res = await request(app())
      .put("/events/e1/cancel")
      .set("Authorization", `Bearer ${tok}`)
      .send({ reason: "No va" });
    expect(res.status).toBe(500);
  });

  it("DELETE /events/:id maneja errores internos", async () => {
    prismaMock.event.findUnique.mockResolvedValueOnce({
      id: "e1",
      title: "Evento",
      status: "SCHEDULED",
      description: null,
    });
    prismaMock.event.update.mockRejectedValueOnce(new Error("db"));
    const tok = signAccessToken({ sub: "a", email: "a@a.com", role: "ADMIN" });
    const res = await request(app())
      .delete("/events/e1")
      .set("Authorization", `Bearer ${tok}`);
    expect(res.status).toBe(500);
  });

  it("DELETE /events/:id responde 404 si no existe", async () => {
    prismaMock.event.findUnique.mockResolvedValueOnce(null);
    const tok = signAccessToken({ sub: "a", email: "a@a.com", role: "ADMIN" });
    const res = await request(app())
      .delete("/events/e1")
      .set("Authorization", `Bearer ${tok}`);
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/no encontrado/i);
  });

  it("PUT /events/:id/cancel ya cancelado 400", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      userId: "u1",
      assignedUserId: null,
      status: "CANCELLED",
      description: "",
    });
    const tok = signAccessToken({ sub: "u1", email: "u@u.com", role: "TEACHER" });
    const res = await request(app())
      .put("/events/e1/cancel")
      .set("Authorization", `Bearer ${tok}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("DELETE /events/:id ADMIN", async () => {
    prismaMock.event.findUnique.mockResolvedValueOnce({
      id: "e1",
      title: "Evento",
      status: "SCHEDULED",
      description: "Desc",
    });
    prismaMock.event.update.mockResolvedValueOnce({ id: "e1", status: "CANCELLED" });
    const tok = signAccessToken({ sub: "a", email: "a@a.com", role: "ADMIN" });
    const res = await request(app())
      .delete("/events/e1")
      .set("Authorization", `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.softDeleted).toBe(true);
    expect(prismaMock.event.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CANCELLED",
          description: expect.stringContaining("[Eliminado logicamente]"),
        }),
      }),
    );
    expect(prismaMock.event.delete).not.toHaveBeenCalled();
  });
});
