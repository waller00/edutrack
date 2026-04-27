import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { Prisma } from "@prisma/client";
import { signAccessToken } from "../jwt.js";
import { computeCICheckDigit } from "../uruguay-ci.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    passwordReset: { create: vi.fn() },
  },
}));

vi.mock("../prisma.js", () => ({ prisma: prismaMock }));

import adminRoutes from "./admin.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use("/admin", adminRoutes);
  return a;
}

const adminHdr = () => ({
  Authorization: `Bearer ${signAccessToken({ sub: "adm", email: "a@a.com", role: "ADMIN" })}`,
});

describe("admin routes (prisma mock)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      role: "TEACHER",
      firstName: "A",
      lastName: "B",
    });
    process.env.PROFILE_PERMISSIONS_FILE = `/tmp/profile-permissions-${process.pid}-${Math.random()}.json`;
  });

  it("GET /admin/users paginado", async () => {
    prismaMock.user.count.mockResolvedValue(2);
    prismaMock.user.findMany.mockResolvedValue([
      { id: "1", email: "a@a.com", role: "TEACHER" },
    ]);
    const res = await request(app()).get("/admin/users?page=1&pageSize=10").set(adminHdr());
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data).toHaveLength(1);
  });

  it("GET /admin/users con filtro q arma OR", async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findMany.mockResolvedValue([]);
    await request(app()).get("/admin/users?q=juan").set(adminHdr());
    expect(prismaMock.user.findMany).toHaveBeenCalled();
    const arg = prismaMock.user.findMany.mock.calls[0][0];
    expect(arg.where.AND).toEqual(
      expect.arrayContaining([
        { NOT: { role: "ADMIN" } },
        expect.objectContaining({ OR: expect.any(Array) }),
      ]),
    );
  });

  it("GET /admin/users capea pageSize y filtra por role", async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findMany.mockResolvedValue([]);
    const res = await request(app()).get("/admin/users?pageSize=999&role=STAFF").set(adminHdr());
    expect(res.status).toBe(200);
    const arg = prismaMock.user.findMany.mock.calls[0][0];
    expect(arg.take).toBe(100);
    expect(arg.where.AND).toEqual(
      expect.arrayContaining([{ NOT: { role: "ADMIN" } }, { role: "STAFF" }]),
    );
  });

  it("POST /admin/users 400 body inválido", async () => {
    const res = await request(app()).post("/admin/users").set(adminHdr()).send({ email: "bad" });
    expect(res.status).toBe(400);
  });

  it("GET /admin/profiles devuelve perfiles por rol", async () => {
    const res = await request(app()).get("/admin/profiles").set(adminHdr());
    expect(res.status).toBe(200);
    expect(res.body.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "TEACHER", label: "Tutor" }),
        expect.objectContaining({ role: "ADMIN", label: "Administrador" }),
      ]),
    );
  });

  it("PUT /admin/profiles/:role/permissions/:id actualiza la matriz sin tocar usuarios", async () => {
    const res = await request(app())
      .put("/admin/profiles/TEACHER/permissions/attendance.read")
      .set(adminHdr())
      .send({ enabled: false, scope: "own" });
    expect(res.status).toBe(200);
    const teacher = res.body.roles.find((role: any) => role.role === "TEACHER");
    const permission = teacher.permissions.find((p: any) => p.id === "attendance.read");
    expect(permission.enabled).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("POST /admin/profiles/:role/permissions crea permiso nuevo", async () => {
    const res = await request(app())
      .post("/admin/profiles/TEACHER/permissions")
      .set(adminHdr())
      .send({ module: "Reportes", action: "read", label: "Ver mis reportes", scope: "own" });
    expect(res.status).toBe(201);
    const teacher = res.body.roles.find((role: any) => role.role === "TEACHER");
    expect(teacher.permissions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "reportes.read", label: "Ver mis reportes" })]),
    );
  });

  it("POST /admin/users 409 email existente", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "x" });
    const res = await request(app())
      .post("/admin/users")
      .set(adminHdr())
      .send({ email: "e@e.com", role: "STAFF" });
    expect(res.status).toBe(409);
  });

  it("POST /admin/users 400 si role es ADMIN", async () => {
    const res = await request(app())
      .post("/admin/users")
      .set(adminHdr())
      .send({ email: "a@a.com", role: "ADMIN" });
    expect(res.status).toBe(400);
  });

  it("POST /admin/users 201 crea", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: "new-id" });
    const res = await request(app())
      .post("/admin/users")
      .set(adminHdr())
      .send({ email: "new@e.com", role: "TEACHER", username: "userabc" });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("new-id");
  });

  it("PUT /admin/users/:id 404 si no existe", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app()).put("/admin/users/missing").set(adminHdr()).send({ firstName: "X" });
    expect(res.status).toBe(404);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("PUT /admin/users/:id 403 no dar de baja a administrador", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "adm",
      role: "ADMIN",
      firstName: "A",
      lastName: "B",
    });
    const res = await request(app()).put("/admin/users/adm").set(adminHdr()).send({ isActive: false });
    expect(res.status).toBe(403);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("PUT /admin/users/:id 403 no promover a ADMIN", async () => {
    const res = await request(app()).put("/admin/users/u1").set(adminHdr()).send({ role: "ADMIN" });
    expect(res.status).toBe(403);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("PUT /admin/users/:id 400 cédula inválida", async () => {
    const res = await request(app())
      .put("/admin/users/u1")
      .set(adminHdr())
      .send({ nationalId: "abcdef" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Cédula/i);
  });

  it("PUT /admin/users/:id ok actualiza nombre", async () => {
    prismaMock.user.update.mockResolvedValue({});
    const res = await request(app())
      .put("/admin/users/u1")
      .set(adminHdr())
      .send({ firstName: "Ana", lastName: "López" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("PUT /admin/users/:id 409 cédula ya usada por otro", async () => {
    const d = computeCICheckDigit("3045865");
    const nationalId = `3.045.865-${d}`;
    prismaMock.user.findFirst.mockResolvedValueOnce({ id: "other-user" });
    const res = await request(app())
      .put("/admin/users/u1")
      .set(adminHdr())
      .send({ nationalId });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/cédula ya está asignada/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("PUT /admin/users/:id 409 por violación única Prisma (P2002)", async () => {
    const d = computeCICheckDigit("3045865");
    const nationalId = `3.045.865-${d}`;
    prismaMock.user.findFirst.mockResolvedValue(null);
    const err = new Prisma.PrismaClientKnownRequestError("Unique", {
      code: "P2002",
      clientVersion: "0.0.0",
      meta: { target: ["nationalId"] },
    });
    prismaMock.user.update.mockRejectedValueOnce(err);
    const res = await request(app())
      .put("/admin/users/u1")
      .set(adminHdr())
      .send({ nationalId });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/cédula ya está asignada/i);
  });

  it("PUT /admin/users/:id normaliza cédula válida", async () => {
    const d = computeCICheckDigit("3045865");
    const nationalId = `3.045.865-${d}`;
    prismaMock.user.update.mockResolvedValue({});
    const res = await request(app())
      .put("/admin/users/u1")
      .set(adminHdr())
      .send({ nationalId });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nationalId: `3045865${d}` }),
      }),
    );
  });

  it("PUT /admin/users/:id actualiza aprobación e inactividad", async () => {
    prismaMock.user.update.mockResolvedValue({});
    const res = await request(app())
      .put("/admin/users/u1")
      .set(adminHdr())
      .send({ isApproved: false, isActive: false });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: expect.objectContaining({ isApproved: false, approvedAt: null, isActive: false }),
      }),
    );
  });

  it("PUT /admin/users/:id/lock", async () => {
    prismaMock.user.update.mockResolvedValue({});
    const res = await request(app()).put("/admin/users/u1/lock?lock=true").set(adminHdr());
    expect(res.status).toBe(200);
    expect(prismaMock.user.findUnique).toHaveBeenCalled();
  });

  it("PUT /admin/users/:id/lock 403 no bloquear administrador", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: "ADMIN" });
    const res = await request(app()).put("/admin/users/adm/lock?lock=true").set(adminHdr());
    expect(res.status).toBe(403);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("PUT /admin/users/:id/lock permite desbloquear", async () => {
    prismaMock.user.update.mockResolvedValue({});
    const res = await request(app()).put("/admin/users/u1/lock?lock=false").set(adminHdr());
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lockUntil: null, failedLoginAttempts: 0 }),
      }),
    );
  });

  it("POST /admin/users/:id/password/reset devuelve token", async () => {
    prismaMock.passwordReset.create.mockResolvedValue({});
    const res = await request(app()).post("/admin/users/u1/password/reset").set(adminHdr());
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.expiresAt).toBeDefined();
  });

  it("POST /admin/users/:id/password/reset 403 para administrador", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: "ADMIN" });
    const res = await request(app()).post("/admin/users/adm/password/reset").set(adminHdr());
    expect(res.status).toBe(403);
    expect(prismaMock.passwordReset.create).not.toHaveBeenCalled();
  });

  it("403 sin rol ADMIN", async () => {
    const tok = signAccessToken({ sub: "t", email: "t@t.com", role: "TEACHER" });
    const res = await request(app()).get("/admin/users").set("Authorization", `Bearer ${tok}`);
    expect(res.status).toBe(403);
  });
});
