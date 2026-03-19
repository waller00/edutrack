import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../jwt.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    medicalLeave: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    attendance: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("../prisma.js", () => ({ prisma: prismaMock }));

import medicalRoutes from "./medical-leaves.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use("/medical-leaves", medicalRoutes);
  return a;
}

const admin = () => ({
  Authorization: `Bearer ${signAccessToken({ sub: "a", email: "a@a.com", role: "ADMIN" })}`,
});
const staff = () => ({
  Authorization: `Bearer ${signAccessToken({ sub: "s", email: "s@s.com", role: "STAFF" })}`,
});

const uid = "00000000-0000-4000-8000-000000000001";
const leaveBody = {
  userId: uid,
  type: "MEDICAL_LEAVE",
  startDate: "2025-01-01T00:00:00.000Z",
  endDate: "2025-01-10T00:00:00.000Z",
  reason: "Reposo",
};

describe("medical-leaves (prisma mock)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /medical-leaves/all ADMIN", async () => {
    prismaMock.medicalLeave.findMany.mockResolvedValue([]);
    prismaMock.medicalLeave.count.mockResolvedValue(0);
    const res = await request(app()).get("/medical-leaves/all").set(admin());
    expect(res.status).toBe(200);
    expect(res.body.pagination).toBeDefined();
  });

  it("GET /medical-leaves/my-leaves", async () => {
    prismaMock.medicalLeave.findMany.mockResolvedValue([]);
    prismaMock.medicalLeave.count.mockResolvedValue(0);
    const res = await request(app()).get("/medical-leaves/my-leaves").set(staff());
    expect(res.status).toBe(200);
  });

  it("GET /medical-leaves/all aplica filtros y paginación", async () => {
    prismaMock.medicalLeave.findMany.mockResolvedValue([]);
    prismaMock.medicalLeave.count.mockResolvedValue(3);
    const res = await request(app())
      .get("/medical-leaves/all?userId=u1&type=MEDICAL_LEAVE&status=APPROVED&startDate=2025-01-01T00:00:00.000Z&endDate=2025-01-31T00:00:00.000Z&page=2&pageSize=5")
      .set(admin());
    expect(res.status).toBe(200);
    expect(res.body.pagination.totalPages).toBe(1);
    const where = prismaMock.medicalLeave.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe("u1");
    expect(where.type).toBe("MEDICAL_LEAVE");
    expect(where.status).toBe("APPROVED");
    expect(where.startDate.gte).toBeInstanceOf(Date);
    expect(where.endDate.lte).toBeInstanceOf(Date);
  });

  it("POST /medical-leaves 400 zod", async () => {
    const res = await request(app()).post("/medical-leaves").set(admin()).send({});
    expect(res.status).toBe(400);
  });

  it("POST /medical-leaves 404 usuario inexistente", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app()).post("/medical-leaves").set(admin()).send(leaveBody);
    expect(res.status).toBe(404);
  });

  it("POST /medical-leaves 400 fechas invertidas", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: uid });
    const res = await request(app())
      .post("/medical-leaves")
      .set(admin())
      .send({
        ...leaveBody,
        startDate: "2025-02-01T00:00:00.000Z",
        endDate: "2025-01-01T00:00:00.000Z",
      });
    expect(res.status).toBe(400);
  });

  it("POST /medical-leaves 201", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: uid });
    prismaMock.medicalLeave.create.mockResolvedValue({
      id: "L1",
      ...leaveBody,
      user: { id: uid, name: "U", email: "u@u.com", role: "STAFF" },
    });
    const res = await request(app()).post("/medical-leaves").set(admin()).send(leaveBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("L1");
  });

  it("POST /medical-leaves 500 si prisma falla", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: uid });
    prismaMock.medicalLeave.create.mockRejectedValueOnce(new Error("db"));
    const res = await request(app()).post("/medical-leaves").set(admin()).send(leaveBody);
    expect(res.status).toBe(500);
  });

  it("403 staff en /all", async () => {
    const res = await request(app()).get("/medical-leaves/all").set(staff());
    expect(res.status).toBe(403);
  });

  it("PUT /medical-leaves/:id 400", async () => {
    const res = await request(app()).put("/medical-leaves/l1").set(admin()).send({ status: "BAD" });
    expect(res.status).toBe(400);
  });

  it("PUT /medical-leaves/:id 404", async () => {
    prismaMock.medicalLeave.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .put("/medical-leaves/l1")
      .set(admin())
      .send({ status: "APPROVED" });
    expect(res.status).toBe(404);
  });

  it("PUT /medical-leaves/:id APPROVED dispara justificación", async () => {
    const lic = {
      id: "l1",
      userId: uid,
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-01-05"),
      type: "MEDICAL_LEAVE",
      reason: "x",
    };
    prismaMock.medicalLeave.findUnique.mockResolvedValue(lic);
    prismaMock.medicalLeave.update.mockResolvedValue({
      ...lic,
      status: "APPROVED",
      user: { id: uid, name: "U", email: "u@u.com", role: "STAFF" },
    });
    prismaMock.attendance.findMany.mockResolvedValue([]);
    prismaMock.attendance.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app())
      .put("/medical-leaves/l1")
      .set(admin())
      .send({ status: "APPROVED" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");
  });

  it("PUT /medical-leaves/:id con notas persiste aprobador cuando cambia estado", async () => {
    const lic = {
      id: "l1",
      userId: uid,
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-01-05"),
      type: "MEDICAL_LEAVE",
      reason: "x",
    };
    prismaMock.medicalLeave.findUnique.mockResolvedValue(lic);
    prismaMock.medicalLeave.update.mockResolvedValue({
      ...lic,
      status: "REJECTED",
      notes: "Faltan datos",
      user: { id: uid, name: "U", email: "u@u.com", role: "STAFF" },
    });
    const res = await request(app())
      .put("/medical-leaves/l1")
      .set(admin())
      .send({ status: "REJECTED", notes: "Faltan datos" });
    expect(res.status).toBe(200);
    expect(prismaMock.medicalLeave.update).toHaveBeenCalled();
  });

  it("PUT /medical-leaves/:id 500 en error interno", async () => {
    prismaMock.medicalLeave.findUnique.mockRejectedValueOnce(new Error("db"));
    const res = await request(app())
      .put("/medical-leaves/l1")
      .set(admin())
      .send({ status: "APPROVED" });
    expect(res.status).toBe(500);
  });

  it("DELETE /medical-leaves/:id", async () => {
    prismaMock.medicalLeave.findUnique.mockResolvedValue({ id: "l1" });
    prismaMock.medicalLeave.delete.mockResolvedValue({});
    const res = await request(app()).delete("/medical-leaves/l1").set(admin());
    expect(res.status).toBe(200);
  });

  it("DELETE /medical-leaves/:id 404 si no existe", async () => {
    prismaMock.medicalLeave.findUnique.mockResolvedValue(null);
    const res = await request(app()).delete("/medical-leaves/l1").set(admin());
    expect(res.status).toBe(404);
  });

  it("DELETE /medical-leaves/:id 500 si delete falla", async () => {
    prismaMock.medicalLeave.findUnique.mockResolvedValue({ id: "l1" });
    prismaMock.medicalLeave.delete.mockRejectedValueOnce(new Error("db"));
    const res = await request(app()).delete("/medical-leaves/l1").set(admin());
    expect(res.status).toBe(500);
  });

  it("GET /medical-leaves/:id 404", async () => {
    prismaMock.medicalLeave.findUnique.mockResolvedValue(null);
    const res = await request(app()).get("/medical-leaves/lx").set(staff());
    expect(res.status).toBe(404);
  });

  it("GET /medical-leaves/:id 403 si no es admin ni dueño", async () => {
    prismaMock.medicalLeave.findUnique.mockResolvedValue({
      id: "l1",
      userId: "other-user",
      user: { id: "other-user", name: "Other", email: "o@o.com", role: "STAFF" },
    });
    const res = await request(app()).get("/medical-leaves/l1").set(staff());
    expect(res.status).toBe(403);
  });

  it("GET /medical-leaves/:id permite al admin", async () => {
    prismaMock.medicalLeave.findUnique.mockResolvedValue({
      id: "l1",
      userId: uid,
      user: { id: uid, name: "U", email: "u@u.com", role: "STAFF" },
    });
    const res = await request(app()).get("/medical-leaves/l1").set(admin());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("l1");
  });

  it("GET /medical-leaves/:id 500 en error interno", async () => {
    prismaMock.medicalLeave.findUnique.mockRejectedValueOnce(new Error("db"));
    const res = await request(app()).get("/medical-leaves/l1").set(admin());
    expect(res.status).toBe(500);
  });
});
