import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../auth/jwt.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    inAppNotification: { create: vi.fn().mockResolvedValue({ id: "n1" }) },
    medicalLeave: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: "a1" }),
    },
    user: { findUnique: vi.fn() },
    event: { findMany: vi.fn() },
    attendance: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("@prisma/client", () => ({
  AuditAction: {
    MEDICAL_LEAVE_CREATED: "MEDICAL_LEAVE_CREATED",
    MEDICAL_LEAVE_UPDATED: "MEDICAL_LEAVE_UPDATED",
    MEDICAL_LEAVE_DEACTIVATED: "MEDICAL_LEAVE_DEACTIVATED",
  },
}));

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
      .get("/medical-leaves/all?userId=u1&type=MEDICAL_LEAVE&status=ACTIVE&startDate=2025-01-01T00:00:00.000Z&endDate=2025-01-31T00:00:00.000Z&page=2&pageSize=5")
      .set(admin());
    expect(res.status).toBe(200);
    expect(res.body.pagination.totalPages).toBe(1);
    const where = prismaMock.medicalLeave.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe("u1");
    expect(where.type).toBe("MEDICAL_LEAVE");
    expect(where.status).toBe("ACTIVE");
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
      status: "ACTIVE",
      user: { id: uid, name: "U", email: "u@u.com", orgRole: { code: "STAFF" } },
    });
    prismaMock.event.findMany.mockResolvedValue([]);
    prismaMock.attendance.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app()).post("/medical-leaves").set(admin()).send(leaveBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("L1");
    expect(res.body.reconciliation).toBeDefined();
    expect(prismaMock.inAppNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: uid,
          type: "LICENSE_CREATED",
          actionUrl: "/me/licenses",
        }),
      }),
    );
  });

  it("POST /medical-leaves 400 certificado inválido", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: uid });
    const res = await request(app())
      .post("/medical-leaves")
      .set(admin())
      .send({
        ...leaveBody,
        certificate: "data:text/plain;base64,Zm9v",
      });
    expect(res.status).toBe(400);
  });

  it("POST /medical-leaves 201 con certificado URL", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: uid });
    prismaMock.medicalLeave.create.mockResolvedValue({
      id: "L2",
      ...leaveBody,
      certificate: "https://example.com/cert.pdf",
      status: "ACTIVE",
      user: { id: uid, name: "U", email: "u@u.com", orgRole: { code: "STAFF" } },
    });
    prismaMock.event.findMany.mockResolvedValue([]);
    prismaMock.attendance.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app())
      .post("/medical-leaves")
      .set(admin())
      .send({
        ...leaveBody,
        certificate: "https://example.com/cert.pdf",
      });
    expect(res.status).toBe(201);
    expect(prismaMock.medicalLeave.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ certificate: "https://example.com/cert.pdf" }),
      }),
    );
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
    const res = await request(app()).put("/medical-leaves/l1").set(admin()).send({ startDate: "BAD" });
    expect(res.status).toBe(400);
  });

  it("PUT /medical-leaves/:id 404", async () => {
    prismaMock.medicalLeave.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .put("/medical-leaves/l1")
      .set(admin())
      .send({ reason: "actualizada" });
    expect(res.status).toBe(404);
  });

  it("PUT /medical-leaves/:id edita y dispara reconciliación", async () => {
    const lic = {
      id: "l1",
      userId: uid,
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-01-05"),
      type: "MEDICAL_LEAVE",
      reason: "x",
      status: "ACTIVE",
    };
    prismaMock.medicalLeave.findUnique.mockResolvedValue(lic);
    prismaMock.medicalLeave.update.mockResolvedValue({
      ...lic,
      reason: "actualizada",
      status: "ACTIVE",
      user: { id: uid, name: "U", email: "u@u.com", orgRole: { code: "STAFF" } },
    });
    prismaMock.event.findMany.mockResolvedValue([]);
    prismaMock.attendance.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app())
      .put("/medical-leaves/l1")
      .set(admin())
      .send({ reason: "actualizada" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body.reconciliation).toBeDefined();
    expect(prismaMock.inAppNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: uid,
          type: "LICENSE_UPDATED",
          actionUrl: "/me/licenses",
        }),
      }),
    );
  });

  it("PUT /medical-leaves/:id acepta campos opcionales en null (como desde Prisma/UI)", async () => {
    const lic = {
      id: "l1",
      userId: uid,
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-01-05"),
      type: "MEDICAL_LEAVE",
      reason: "motivo",
      notes: null,
      doctorName: null,
      doctorPhone: null,
      status: "ACTIVE",
    };
    prismaMock.medicalLeave.findUnique.mockResolvedValue(lic);
    prismaMock.medicalLeave.update.mockResolvedValue({
      ...lic,
      reason: "solo motivo",
      user: { id: uid, name: "U", email: "u@u.com", orgRole: { code: "STAFF" } },
    });
    prismaMock.event.findMany.mockResolvedValue([]);
    prismaMock.attendance.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app())
      .put("/medical-leaves/l1")
      .set(admin())
      .send({
        type: "MEDICAL_LEAVE",
        startDate: "2025-01-01T12:00:00.000Z",
        endDate: "2025-01-05T12:00:00.000Z",
        reason: "solo motivo",
        notes: null,
        doctorName: null,
        doctorPhone: null,
        certificate: null,
      });
    expect(res.status).toBe(200);
    expect(prismaMock.medicalLeave.update).toHaveBeenCalled();
  });

  it("PUT /medical-leaves/:id valida fechas", async () => {
    const lic = {
      id: "l1",
      userId: uid,
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-01-05"),
      type: "MEDICAL_LEAVE",
      reason: "x",
    };
    prismaMock.medicalLeave.findUnique.mockResolvedValue(lic);
    const res = await request(app())
      .put("/medical-leaves/l1")
      .set(admin())
      .send({ startDate: "2025-02-01T00:00:00.000Z", endDate: "2025-01-01T00:00:00.000Z" });
    expect(res.status).toBe(400);
  });

  it("PUT /medical-leaves/:id 500 en error interno", async () => {
    prismaMock.medicalLeave.findUnique.mockRejectedValueOnce(new Error("db"));
    const res = await request(app())
      .put("/medical-leaves/l1")
      .set(admin())
      .send({ reason: "actualizada" });
    expect(res.status).toBe(500);
  });

  it("DELETE /medical-leaves/:id desactiva", async () => {
    prismaMock.medicalLeave.findUnique.mockResolvedValue({ id: "l1" });
    prismaMock.medicalLeave.update.mockResolvedValue({});
    const res = await request(app()).delete("/medical-leaves/l1").set(admin());
    expect(res.status).toBe(200);
    expect(prismaMock.medicalLeave.update).toHaveBeenCalled();
  });

  it("DELETE /medical-leaves/:id 404 si no existe", async () => {
    prismaMock.medicalLeave.findUnique.mockResolvedValue(null);
    const res = await request(app()).delete("/medical-leaves/l1").set(admin());
    expect(res.status).toBe(404);
  });

  it("DELETE /medical-leaves/:id 500 si update falla", async () => {
    prismaMock.medicalLeave.findUnique.mockResolvedValue({ id: "l1" });
    prismaMock.medicalLeave.update.mockRejectedValueOnce(new Error("db"));
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
      user: { id: "other-user", name: "Other", email: "o@o.com", orgRole: { code: "STAFF" } },
    });
    const res = await request(app()).get("/medical-leaves/l1").set(staff());
    expect(res.status).toBe(403);
  });

  it("GET /medical-leaves/:id permite al admin", async () => {
    prismaMock.medicalLeave.findUnique.mockResolvedValue({
      id: "l1",
      userId: uid,
      user: { id: uid, name: "U", email: "u@u.com", orgRole: { code: "STAFF" } },
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
