import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { signAccessToken } from "../test-utils/bearer-token.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    event: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    substitution: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    attendance: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn(),
  },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/non-working-days.js", () => ({
  findNonWorkingDayForDate: vi.fn().mockResolvedValue(null),
}));

import substitutionRoutes from "./substitutions.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/substitutions", substitutionRoutes);
  return a;
}

const tok = () => signAccessToken({ sub: "admin-1", email: "a@a.com", role: "ADMIN" });

describe("substitutions routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.auditLog.create.mockResolvedValue({});
    prismaMock.substitution.count.mockResolvedValue(0);
    prismaMock.substitution.findMany.mockResolvedValue([]);
  });

  it("valida que la suplencia tenga datos mínimos", async () => {
    const res = await request(app()).post("/substitutions").set("Authorization", `Bearer ${tok()}`).send({});
    expect(res.status).toBe(400);
  });

  it("lista suplencias", async () => {
    prismaMock.substitution.count.mockResolvedValue(1);
    prismaMock.substitution.findMany.mockResolvedValue([{ id: "sub-1" }]);
    const res = await request(app())
      .get("/substitutions?from=2026-05-01&to=2026-05-31")
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("registra suplencia y deja al titular como suplido", async () => {
    const eventId = "00000000-0000-4000-8000-0000000000e1";
    const startTime = new Date("2026-05-05T15:00:00.000Z");
    const endTime = new Date("2026-05-05T15:45:00.000Z");
    prismaMock.event.findUnique.mockResolvedValue({
      id: eventId,
      title: "Matemática",
      type: "CLASE",
      status: "SCHEDULED",
      assignedUserId: "teacher-1",
      courseOfferingId: "course-1",
      subjectId: "subject-1",
      startDate: new Date("2026-05-05T12:00:00.000Z"),
      startTime,
      endTime,
      isRecurring: false,
      daysOfWeek: [],
    });
    const substituteUserId = "00000000-0000-4000-8000-0000000000d2";
    prismaMock.user.findUnique.mockResolvedValue({ id: substituteUserId, isActive: true, isApproved: true });
    prismaMock.substitution.findUnique.mockResolvedValue(null);
    const createdSub = {
      id: "sub-1",
      eventId,
      reason: "Licencia del titular",
      event: { id: eventId, title: "Matemática", type: "CLASE", status: "SCHEDULED" },
      originalTeacher: { id: "teacher-1", name: "Titular", email: "t@t.com", username: null },
      substitute: { id: substituteUserId, name: "Suplente", email: "s@s.com", username: null },
      substituteUserId,
      originalTeacherUserId: "teacher-1",
      date: new Date("2026-05-05T03:00:00.000Z"),
      startTime,
      endTime,
      notes: null,
      createdBy: null,
    };
    prismaMock.substitution.create.mockResolvedValue(createdSub);
    prismaMock.attendance.findFirst.mockResolvedValue(null);
    prismaMock.attendance.create.mockResolvedValue({ id: "att-substituted" });
    prismaMock.substitution.findUniqueOrThrow.mockResolvedValue(createdSub);

    const res = await request(app())
      .post("/substitutions")
      .set("Authorization", `Bearer ${tok()}`)
      .send({
        eventId,
        substituteUserId,
        reason: "Licencia del titular",
        occurrenceDate: "2026-05-05",
      });

    expect(res.status).toBe(201);
    expect(prismaMock.attendance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUBSTITUTED" }),
      }),
    );
  });

  it("permite registrar suplencia aunque la clase no tenga grupo ni asignatura", async () => {
    const eventId = "00000000-0000-4000-8000-0000000000e2";
    const startTime = new Date("2026-06-09T15:00:00.000Z");
    const endTime = new Date("2026-06-09T16:00:00.000Z");
    const substituteUserId = "00000000-0000-4000-8000-0000000000d3";
    prismaMock.event.findUnique.mockResolvedValue({
      id: eventId,
      title: "Turno administrativo",
      type: "CLASE",
      status: "SCHEDULED",
      assignedUserId: "staff-1",
      schoolYearId: "year-1",
      courseOfferingId: null,
      subjectId: null,
      startDate: new Date("2026-06-09T12:00:00.000Z"),
      startTime,
      endTime,
      isRecurring: false,
      daysOfWeek: [],
    });
    prismaMock.user.findUnique.mockResolvedValue({ id: substituteUserId, isActive: true, isApproved: true });
    prismaMock.substitution.findUnique.mockResolvedValue(null);
    prismaMock.substitution.create.mockResolvedValue({ id: "sub-staff", eventId });
    prismaMock.attendance.findFirst.mockResolvedValue(null);
    prismaMock.attendance.create.mockResolvedValue({ id: "att-staff" });
    prismaMock.substitution.findUniqueOrThrow.mockResolvedValue({ id: "sub-staff", eventId });

    const res = await request(app())
      .post("/substitutions")
      .set("Authorization", `Bearer ${tok()}`)
      .send({
        eventId,
        substituteUserId,
        reason: "Cobertura de staff",
        occurrenceDate: "2026-06-09",
      });

    expect(res.status).toBe(201);
    expect(prismaMock.substitution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          originalTeacherUserId: "staff-1",
          substituteUserId,
          reason: "Cobertura de staff",
        }),
      }),
    );
  });
});
