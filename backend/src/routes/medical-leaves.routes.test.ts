import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../test-utils/bearer-token.js";

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
    schoolYear: { findUnique: vi.fn() },
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
  reason: "Detalle enviado por cliente",
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
    // "Desde/Hasta" es el período: entra toda licencia vigente algún día de enero, aunque
    // haya empezado en diciembre o termine en febrero.
    expect(where.AND).toEqual([
      { startDate: { lte: new Date("2025-01-31T23:59:59.999Z") } },
      { endDate: { gte: new Date("2025-01-01T00:00:00.000Z") } },
    ]);
    expect(prismaMock.medicalLeave.findMany.mock.calls[0][0]).toMatchObject({ skip: 5, take: 5 });
  });

  it("GET /medical-leaves/all por ciclo: vigente algún día del ciclo, también el último", async () => {
    prismaMock.medicalLeave.findMany.mockResolvedValue([]);
    prismaMock.medicalLeave.count.mockResolvedValue(0);
    prismaMock.schoolYear.findUnique.mockResolvedValue({
      code: 2026,
      startsOn: new Date("2026-03-01T00:00:00.000Z"),
      endsOn: new Date("2026-12-20T00:00:00.000Z"),
    });

    await request(app()).get("/medical-leaves/all?schoolYearId=sy-1").set(admin());

    const where = prismaMock.medicalLeave.findMany.mock.calls[0][0].where;
    // El ciclo se guarda a medianoche y la licencia al mediodía: comparando instantes, una
    // licencia que empezaba el 20/12 quedaba afuera del ciclo que termina ese día.
    expect(where.AND).toEqual([
      { startDate: { lte: new Date("2026-12-20T23:59:59.999Z") } },
      { endDate: { gte: new Date("2026-03-01T00:00:00.000Z") } },
    ]);
  });

  it("GET /medical-leaves/all con un ciclo sin fechas usa su año calendario", async () => {
    prismaMock.medicalLeave.findMany.mockResolvedValue([]);
    prismaMock.medicalLeave.count.mockResolvedValue(0);
    prismaMock.schoolYear.findUnique.mockResolvedValue({ code: 2025, startsOn: null, endsOn: null });

    await request(app()).get("/medical-leaves/all?schoolYearId=sy-1").set(admin());

    // Antes el filtro se ignoraba y aparecían las licencias de todos los años.
    expect(prismaMock.medicalLeave.findMany.mock.calls[0][0].where.AND).toEqual([
      { startDate: { lte: new Date("2025-12-31T23:59:59.999Z") } },
      { endDate: { gte: new Date("2025-01-01T00:00:00.000Z") } },
    ]);
  });

  it("GET /medical-leaves/all cuenta los totales de todo el filtro, no de la página", async () => {
    prismaMock.medicalLeave.findMany.mockResolvedValue([]);
    prismaMock.medicalLeave.count
      .mockResolvedValueOnce(45)
      .mockResolvedValueOnce(40)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(30);

    const res = await request(app()).get("/medical-leaves/all?userId=u1").set(admin());

    expect(res.body.summary).toEqual({ total: 45, active: 40, inactive: 5, medical: 30 });
    expect(prismaMock.medicalLeave.count.mock.calls[1][0].where).toEqual({
      AND: [{ userId: "u1" }, { status: "ACTIVE" }],
    });
  });

  it("GET /medical-leaves/all ordena por fecha de la licencia y pone tope a la página", async () => {
    prismaMock.medicalLeave.findMany.mockResolvedValue([]);
    prismaMock.medicalLeave.count.mockResolvedValue(0);

    const res = await request(app()).get("/medical-leaves/all?pageSize=5000&page=abc").set(admin());

    expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 100 });
    expect(prismaMock.medicalLeave.findMany.mock.calls[0][0].orderBy).toEqual([
      { startDate: "desc" },
      { createdAt: "desc" },
    ]);
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
    expect(prismaMock.medicalLeave.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reason: "Licencia médica presentada",
          notes: null,
        }),
      }),
    );
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

  it("PUT /medical-leaves/:id acepta notas opcionales en null (como desde Prisma/UI)", async () => {
    const lic = {
      id: "l1",
      userId: uid,
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-01-05"),
      type: "MEDICAL_LEAVE",
      reason: "motivo",
      notes: null,
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
