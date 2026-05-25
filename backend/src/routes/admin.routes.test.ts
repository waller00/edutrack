import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { Prisma } from "@prisma/client";
import { signAccessToken } from "../auth/jwt.js";
import { computeCICheckDigit } from "../identity/uruguay-ci.js";
import type { BuiltinProfileRole } from "../identity/profile-permissions-defaults.js";
import { DEFAULT_PROFILE_PERMISSIONS } from "../identity/profile-permissions-defaults.js";

const { prismaMock, runAdminQueryAssistantMock } = vi.hoisted(() => ({
  runAdminQueryAssistantMock: vi.fn(),
  prismaMock: {
    user: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    orgRole: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    permission: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    rolePermission: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    passwordReset: { create: vi.fn() },
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: "a1" }),
    },
    schoolYear: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

function permIdForCode(code: string) {
  return `perm-${code.replace(/\./g, "-")}`;
}

function orgRoleRowId(role: BuiltinProfileRole) {
  return `rid-${role}`;
}

function rowsFromDefaultProfileMatrix() {
  const rows: any[] = [];
  for (const role of ["ADMIN", "TEACHER", "STAFF"] as BuiltinProfileRole[]) {
    for (const p of DEFAULT_PROFILE_PERMISSIONS[role]) {
      rows.push({
        roleId: orgRoleRowId(role),
        permissionId: permIdForCode(p.id),
        enabled: p.enabled,
        scope: p.scope === "all" ? "ALL" : "OWN",
        label: p.label,
        permission: { code: p.id, module: p.module, action: p.action, isSystem: true },
        orgRole: { code: role },
      });
    }
  }
  return rows;
}

function permissionCatalogRows() {
  const byCode = new Map<string, { id: string; code: string; module: string; action: string; isSystem: boolean }>();
  for (const row of rowsFromDefaultProfileMatrix()) {
    byCode.set(row.permission.code, {
      id: row.permissionId,
      code: row.permission.code,
      module: row.permission.module,
      action: row.permission.action,
      isSystem: row.permission.isSystem,
      roleGrants: [{ label: row.label }],
    });
  }
  return [...byCode.values()];
}

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/query-assistant/run.js", () => ({
  runAdminQueryAssistant: runAdminQueryAssistantMock,
}));
vi.mock("@prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      clientVersion: string;
      meta?: Record<string, unknown>;

      constructor(message: string, options: { code: string; clientVersion: string; meta?: Record<string, unknown> }) {
        super(message);
        this.name = "PrismaClientKnownRequestError";
        this.code = options.code;
        this.clientVersion = options.clientVersion;
        this.meta = options.meta;
      }
    },
  },
  AuditAction: {
    USER_CREATED_BY_ADMIN: "USER_CREATED_BY_ADMIN",
    USER_UPDATED_BY_ADMIN: "USER_UPDATED_BY_ADMIN",
    USER_ACCOUNT_LOCK_TOGGLED: "USER_ACCOUNT_LOCK_TOGGLED",
    ADMIN_PASSWORD_RESET_ISSUED: "ADMIN_PASSWORD_RESET_ISSUED",
    SYSTEM_SETTINGS_UPDATED: "SYSTEM_SETTINGS_UPDATED",
  },
}));

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
    prismaMock.orgRole.upsert.mockResolvedValue({});
    prismaMock.orgRole.findFirst.mockImplementation((args: { where: { code: string } }) => {
      const code = args?.where?.code;
      return Promise.resolve({ id: orgRoleRowId(code as BuiltinProfileRole), code, active: true });
    });
    prismaMock.orgRole.findMany.mockResolvedValue([
      { code: "ADMIN", label: "Administrador" },
      { code: "STAFF", label: "Staff" },
      { code: "TEACHER", label: "Tutor" },
    ]);
    prismaMock.orgRole.findUnique.mockImplementation((args: { where: { code: string } }) =>
      Promise.resolve({ id: orgRoleRowId(args.where.code as BuiltinProfileRole), code: args.where.code }),
    );
    prismaMock.rolePermission.count.mockResolvedValue(1);
    prismaMock.permission.findMany.mockResolvedValue(permissionCatalogRows());
    prismaMock.schoolYear.findFirst.mockResolvedValue(null);
    prismaMock.schoolYear.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (input: any) => {
      if (typeof input === "function") return input(prismaMock);
      return Promise.all(input);
    });
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      orgRole: { code: "TEACHER" },
      firstName: "A",
      lastName: "B",
      name: "A B",
      roleId: orgRoleRowId("TEACHER"),
      username: "teacher1",
      nationalId: null,
      nationalIdDocumentExpiresAt: null,
      isApproved: true,
      approvedAt: new Date("2020-01-01T00:00:00.000Z"),
      isActive: true,
    });
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.count.mockResolvedValue(0);
    prismaMock.auditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it("GET /admin/users paginado", async () => {
    prismaMock.user.count.mockResolvedValue(2);
    prismaMock.user.findMany.mockResolvedValue([
      { id: "1", email: "a@a.com", orgRole: { code: "TEACHER" }, biometricMappings: [{ id: "bm-1" }] },
    ]);
    const res = await request(app()).get("/admin/users?page=1&pageSize=10").set(adminHdr());
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: "1", role: "TEACHER", biometricLinked: true });
    expect(res.body.data[0]).not.toHaveProperty("biometricMappings");
    expect(prismaMock.user.findMany.mock.calls[0][0].select.biometricMappings).toEqual({
      where: { isActive: true },
      select: { id: true },
      take: 1,
    });
  });

  it("GET /admin/users con filtro q arma OR", async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findMany.mockResolvedValue([]);
    await request(app()).get("/admin/users?q=juan").set(adminHdr());
    expect(prismaMock.user.findMany).toHaveBeenCalled();
    const arg = prismaMock.user.findMany.mock.calls[0][0];
    expect(arg.where.AND).toEqual(
      expect.arrayContaining([
        { NOT: { orgRole: { code: "ADMIN" } } },
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
      expect.arrayContaining([{ NOT: { orgRole: { code: "ADMIN" } } }, { orgRole: { code: "STAFF" } }]),
    );
  });

  it("GET /admin/users filtros aprobación activo verificado bloqueo y documento", async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findMany.mockResolvedValue([]);
    const res = await request(app())
      .get(
        "/admin/users?approved=false&active=true&verified=true&locked=false&docExpiring=true",
      )
      .set(adminHdr());
    expect(res.status).toBe(200);
    const arg = prismaMock.user.findMany.mock.calls[0][0];
    expect(arg.where.AND).toEqual(
      expect.arrayContaining([
        { NOT: { orgRole: { code: "ADMIN" } } },
        { isApproved: false },
        { isActive: true },
        { emailVerifiedAt: { not: null } },
        { OR: [{ lockUntil: null }, { lockUntil: { lte: expect.any(Date) } }] },
        {
          nationalIdDocumentExpiresAt: { not: null, gte: expect.any(Date), lte: expect.any(Date) },
        },
      ]),
    );
  });

  it("POST /admin/users 400 body inválido", async () => {
    const res = await request(app()).post("/admin/users").set(adminHdr()).send({ email: "bad" });
    expect(res.status).toBe(400);
  });

  describe("GET/PUT/POST /admin/profiles (matriz en Prisma)", () => {
    beforeEach(() => {
      prismaMock.rolePermission.count.mockResolvedValue(50);
      prismaMock.rolePermission.findMany.mockResolvedValue(rowsFromDefaultProfileMatrix());
      prismaMock.permission.findUnique.mockImplementation((args: { where: { code?: string } }) => {
        const code = args?.where?.code;
        if (!code) return Promise.resolve(null);
        return Promise.resolve({
          id: permIdForCode(code),
          code,
          module: "m",
          action: "a",
          isSystem: true,
        });
      });
      prismaMock.rolePermission.findUnique.mockImplementation(
        (args: { where: { roleId_permissionId: { roleId: string; permissionId: string } } }) => {
          const { roleId, permissionId } = args.where.roleId_permissionId;
          const hit = rowsFromDefaultProfileMatrix().find((r) => r.roleId === roleId && r.permissionId === permissionId);
          return Promise.resolve(hit ? { roleId, permissionId } : null);
        },
      );
      prismaMock.rolePermission.update.mockResolvedValue({});
      prismaMock.rolePermission.create.mockResolvedValue({});
      prismaMock.permission.create.mockResolvedValue({
        id: "new-perm",
        code: "reportes.read",
        module: "Reportes",
        action: "read",
        isSystem: false,
      });
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
      const teacher = res.body.roles.find((role: unknown) => (role as { role: string }).role === "TEACHER") as {
        permissions: unknown[];
      };
      const staff = res.body.roles.find((role: unknown) => (role as { role: string }).role === "STAFF") as {
        permissions: unknown[];
      };
      expect(teacher.permissions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "attendance.read", source: "system" }),
          expect.objectContaining({ id: "events.read", source: "system" }),
          expect.objectContaining({ id: "licenses.read", source: "system" }),
        ]),
      );
      expect(teacher.permissions).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "events.create" }),
          expect.objectContaining({ id: "events.update" }),
          expect.objectContaining({ id: "licenses.create" }),
        ]),
      );
      expect(staff.permissions).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "attendance.create" }),
          expect.objectContaining({ id: "licenses.create" }),
        ]),
      );
    });

    it("PUT /admin/profiles/:role/permissions/:id actualiza la matriz sin tocar usuarios", async () => {
      const snapshot = structuredClone(rowsFromDefaultProfileMatrix());
      const teacherRead = snapshot.find((r) => r.orgRole.code === "TEACHER" && r.permission.code === "attendance.read");
      if (teacherRead) teacherRead.enabled = false;
      prismaMock.rolePermission.findMany.mockResolvedValue(snapshot);
      const res = await request(app())
        .put("/admin/profiles/TEACHER/permissions/attendance.read")
        .set(adminHdr())
        .send({ enabled: false, scope: "own" });
      expect(res.status).toBe(200);
      const teacher = res.body.roles.find((role: unknown) => (role as { role: string }).role === "TEACHER") as {
        permissions: { id: string; enabled: boolean }[];
      };
      const permission = teacher.permissions.find((p) => p.id === "attendance.read");
      expect(permission?.enabled).toBe(false);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("POST /admin/profiles/:role/permissions crea permiso nuevo", async () => {
      const extra: any[] = [];
      prismaMock.permission.create.mockResolvedValue({
        id: "new-perm-id",
        code: "reportes.read",
        module: "Reportes",
        action: "read",
        isSystem: false,
      });
      prismaMock.rolePermission.create.mockImplementation(async ({ data }: { data: any }) => {
        const code = (Object.keys(DEFAULT_PROFILE_PERMISSIONS) as BuiltinProfileRole[]).find((rc) => orgRoleRowId(rc) === data.roleId) ?? "TEACHER";
        extra.push({
          roleId: data.roleId,
          permissionId: data.permissionId,
          enabled: data.enabled,
          scope: data.scope,
          label: data.label,
          orgRole: { code },
          permission: {
            code: "reportes.read",
            module: "Reportes",
            action: "read",
            isSystem: false,
          },
        });
        return {};
      });
      prismaMock.rolePermission.findMany.mockImplementation(async () => [...rowsFromDefaultProfileMatrix(), ...extra]);
      const res = await request(app())
        .post("/admin/profiles/TEACHER/permissions")
        .set(adminHdr())
        .send({ module: "Reportes", action: "read", label: "Ver mis reportes", scope: "own" });
      expect(res.status).toBe(201);
      const teacher = res.body.roles.find((role: unknown) => (role as { role: string }).role === "TEACHER") as {
        permissions: { id: string; label: string }[];
      };
      expect(teacher.permissions).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "reportes.read", label: "Ver mis reportes" })]),
      );
    });
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
      orgRole: { code: "ADMIN" },
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
    prismaMock.user.findUnique.mockResolvedValue({ orgRole: { code: "ADMIN" } });
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
    prismaMock.user.findUnique.mockResolvedValue({ orgRole: { code: "ADMIN" } });
    const res = await request(app()).post("/admin/users/adm/password/reset").set(adminHdr());
    expect(res.status).toBe(403);
    expect(prismaMock.passwordReset.create).not.toHaveBeenCalled();
  });

  it("403 sin rol ADMIN", async () => {
    const tok = signAccessToken({ sub: "t", email: "t@t.com", role: "TEACHER" });
    const res = await request(app()).get("/admin/users").set("Authorization", `Bearer ${tok}`);
    expect(res.status).toBe(403);
  });

  it("GET /admin/audit-logs devuelve datos y catálogo de acciones", async () => {
    prismaMock.auditLog.count.mockResolvedValue(1);
    prismaMock.auditLog.findMany.mockResolvedValue([
      {
        id: "log-1",
        occurredAt: new Date("2026-01-01T12:00:00.000Z"),
        action: "AUTH_LOGIN_SUCCESS",
        actorUserId: "u1",
        actorIp: "1.2.3.4",
        userAgent: "vitest",
        source: "API",
        entityType: null,
        entityId: null,
        metadata: null,
        actor: { id: "u1", name: "Test", email: "t@t.com" },
      },
    ]);
    const res = await request(app()).get("/admin/audit-logs?page=1&pageSize=10").set(adminHdr());
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(Array.isArray(res.body.actionCatalog)).toBe(true);
    expect(res.body.data[0].actionLabel).toMatch(/sesión/i);
  });

  it("POST /admin/query-assistant 400 si falta pregunta", async () => {
    const res = await request(app()).post("/admin/query-assistant").set(adminHdr()).send({ question: "" });
    expect(res.status).toBe(400);
    expect(runAdminQueryAssistantMock).not.toHaveBeenCalled();
  });

  it("POST /admin/query-assistant devuelve resultado del servicio", async () => {
    prismaMock.schoolYear.findFirst.mockResolvedValue({ id: "sy-active" });
    prismaMock.schoolYear.findUnique.mockResolvedValue({ id: "sy-active", code: 2026 });
    runAdminQueryAssistantMock.mockResolvedValue({
      intent: "HOURS_WORKED_SUMMARY",
      summary: "Resumen de prueba",
      columns: [{ key: "name", label: "Nombre" }],
      rows: [{ name: "Ana" }],
    });
    const res = await request(app())
      .post("/admin/query-assistant")
      .set(adminHdr())
      .send({ question: "horas en octubre" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("HOURS_WORKED_SUMMARY");
    expect(res.body.summary).toBe("Resumen de prueba");
    expect(res.body.rows).toHaveLength(1);
    expect(runAdminQueryAssistantMock).toHaveBeenCalledWith("horas en octubre", {
      allYears: false,
      schoolYearId: "sy-active",
      schoolYearCode: 2026,
    });
  });

  it("POST /admin/query-assistant respeta schoolYearId enviado", async () => {
    const sy = "00000000-0000-4000-8000-0000000000aa";
    prismaMock.schoolYear.findUnique.mockResolvedValue({ id: sy, code: 2025 });
    runAdminQueryAssistantMock.mockResolvedValue({
      intent: "ASSIGNED_EVENTS_SUMMARY",
      summary: "ok",
      columns: [],
      rows: [],
    });
    const res = await request(app())
      .post("/admin/query-assistant")
      .set(adminHdr())
      .send({ question: "eventos asignados", schoolYearId: sy });

    expect(res.status).toBe(200);
    expect(runAdminQueryAssistantMock).toHaveBeenCalledWith("eventos asignados", {
      allYears: false,
      schoolYearId: sy,
      schoolYearCode: 2025,
    });
  });

  it("POST /admin/query-assistant permite todos los ciclos", async () => {
    runAdminQueryAssistantMock.mockResolvedValue({
      intent: "ASSIGNED_EVENTS_SUMMARY",
      summary: "ok",
      columns: [],
      rows: [],
    });
    const res = await request(app())
      .post("/admin/query-assistant")
      .set(adminHdr())
      .send({ question: "eventos asignados", allYears: true });

    expect(res.status).toBe(200);
    expect(runAdminQueryAssistantMock).toHaveBeenCalledWith("eventos asignados", {
      allYears: true,
      schoolYearId: undefined,
      schoolYearCode: undefined,
    });
  });

  it("POST /admin/query-assistant 503 si falta OPENAI_API_KEY", async () => {
    runAdminQueryAssistantMock.mockRejectedValue(new Error("OPENAI_API_KEY_NOT_CONFIGURED"));
    const res = await request(app())
      .post("/admin/query-assistant")
      .set(adminHdr())
      .send({ question: "horas en octubre" });
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/OPENAI_API_KEY/i);
  });
});
