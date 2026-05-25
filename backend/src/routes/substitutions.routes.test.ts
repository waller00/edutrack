import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { signAccessToken } from "../auth/jwt.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    event: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    attendance: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));

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
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.$executeRaw.mockResolvedValue(1);
  });

  it("valida que la suplencia tenga datos mínimos", async () => {
    const res = await request(app()).post("/substitutions").set("Authorization", `Bearer ${tok()}`).send({});
    expect(res.status).toBe(400);
  });

  it("registra suplencia y deja al titular como suplido", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: "00000000-0000-4000-8000-0000000000e1",
      title: "Matemática",
      type: "CLASE",
      status: "SCHEDULED",
      assignedUserId: "teacher-1",
      courseOfferingId: "course-1",
      subjectId: "subject-1",
      startDate: new Date("2026-05-05T12:00:00.000Z"),
      startTime: new Date("2026-05-05T12:00:00.000Z"),
      endTime: new Date("2026-05-05T12:45:00.000Z"),
    });
    const substituteUserId = "00000000-0000-4000-8000-0000000000d2";
    prismaMock.user.findUnique.mockResolvedValue({ id: substituteUserId, isActive: true, isApproved: true });
    prismaMock.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "sub-1", eventId: "00000000-0000-4000-8000-0000000000e1" }]);
    prismaMock.attendance.findFirst.mockResolvedValue(null);
    prismaMock.attendance.create.mockResolvedValue({ id: "att-substituted" });

    const res = await request(app())
      .post("/substitutions")
      .set("Authorization", `Bearer ${tok()}`)
      .send({
        eventId: "00000000-0000-4000-8000-0000000000e1",
        substituteUserId,
        reason: "Licencia del titular",
      });

    expect(res.status).toBe(201);
    expect(prismaMock.attendance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUBSTITUTED" }),
      }),
    );
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
  });
});
