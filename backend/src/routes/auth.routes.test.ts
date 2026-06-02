import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../test-utils/bearer-token.js";

const {
  prismaMock,
  sendMailMock,
  createKeycloakUserMock,
  syncRegisteredSsoUserMock,
  getSsoRegistrationMock,
  consumeSsoRegistrationMock,
  ensureDefaultPermissionsMock,
} = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    systemSettings: {
      upsert: vi.fn(),
    },
    livenessSession: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    rolePermission: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(),
    emailVerification: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  sendMailMock: vi.fn().mockResolvedValue(undefined),
  createKeycloakUserMock: vi.fn().mockResolvedValue("kc-id-1"),
  syncRegisteredSsoUserMock: vi.fn().mockResolvedValue(undefined),
  getSsoRegistrationMock: vi.fn().mockResolvedValue(null),
  consumeSsoRegistrationMock: vi.fn().mockResolvedValue(null),
  ensureDefaultPermissionsMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../notifications/email.js", () => ({ sendMail: sendMailMock }));
vi.mock("../auth/keycloak.js", () => ({
  createKeycloakUser: createKeycloakUserMock,
  syncRegisteredSsoUser: syncRegisteredSsoUserMock,
}));
vi.mock("../auth/sso-registration.js", () => ({
  getSsoRegistration: getSsoRegistrationMock,
  consumeSsoRegistration: consumeSsoRegistrationMock,
}));
vi.mock("../identity/org-role-service.js", () => ({
  normalizeOrgRoleCode: (raw: string) => raw.trim().toUpperCase(),
  getOrgRoleIdByCodeOrThrow: vi.fn().mockResolvedValue("mock-org-role-id"),
}));
vi.mock("../config/system-settings.js", () => ({
  isLivenessRequiredForRegistration: () => false,
  isDiditConfigured: () => false,
}));
vi.mock("../identity/profile-permissions-repository.js", () => ({
  ensureDefaultProfilePermissionsIfNeeded: ensureDefaultPermissionsMock,
}));

import authRoutes from "./auth.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use("/auth", authRoutes);
  return a;
}

describe("auth routes (cuenta + registro, Keycloak)", () => {
  const authHeader = (role = "STAFF", sub = "user-1") => ({
    Authorization: `Bearer ${signAccessToken({ sub, email: `${sub}@example.com`, role: role as "STAFF" })}`,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    sendMailMock.mockResolvedValue(undefined);
    createKeycloakUserMock.mockResolvedValue("kc-id-1");
    syncRegisteredSsoUserMock.mockResolvedValue(undefined);
    getSsoRegistrationMock.mockResolvedValue(null);
    consumeSsoRegistrationMock.mockResolvedValue(null);
    ensureDefaultPermissionsMock.mockResolvedValue(undefined);
    prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === "function") {
        return (arg as (tx: { user: typeof prismaMock.user; livenessSession: { update: ReturnType<typeof vi.fn> } }) => Promise<unknown>)({
          user: prismaMock.user,
          livenessSession: { update: vi.fn().mockResolvedValue({}) },
        });
      }
      return Promise.all(arg as Promise<unknown>[]);
    });
    process.env.FRONTEND_URL = "http://frontend.local";
    process.env.NODE_ENV = "test";
  });

  // Evita filtrar FRONTEND_URL a otros archivos de test (vitest corre en un único
  // fork, sin paralelismo de archivos: el env global es compartido).
  const previousFrontendUrl = process.env.FRONTEND_URL;
  afterEach(() => {
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
  });

  it("GET /auth/check-username nombre corto", async () => {
    const res = await request(app()).get("/auth/check-username").query({ u: "ab" });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });

  it("POST /auth/register crea usuario en Postgres y Keycloak", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "u-new",
      email: "nuevo@example.com",
      username: "nuevo.user",
    });
    const res = await request(app())
      .post("/auth/register")
      .send({
        email: "nuevo@example.com",
        password: "Segura123!",
        firstName: "Nuevo",
        lastName: "Usuario",
        phone: "099123456",
      });
    expect(res.status).toBe(200);
    expect(createKeycloakUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "nuevo@example.com",
        username: "nuevo.user",
      }),
    );
    expect(res.body.email).toBe("nuevo@example.com");
  });

  it("GET /auth/register/sso devuelve prefills de Google", async () => {
    getSsoRegistrationMock.mockResolvedValueOnce({
      kcId: "kc-google-1",
      email: "google@example.com",
      firstName: "Google",
      lastName: "User",
      emailVerified: true,
    });

    const res = await request(app()).get("/auth/register/sso").query({ token: "token-google" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      email: "google@example.com",
      firstName: "Google",
      lastName: "User",
      emailLocked: true,
      provider: "google",
    }));
  });

  it("POST /auth/register con token Google no exige contraseña ni crea usuario Keycloak nuevo", async () => {
    getSsoRegistrationMock.mockResolvedValue({
      kcId: "kc-google-1",
      email: "google@example.com",
      firstName: "Google",
      lastName: "User",
      emailVerified: true,
    });
    consumeSsoRegistrationMock.mockResolvedValue({
      kcId: "kc-google-1",
      email: "google@example.com",
    });
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "u-google",
      email: "google@example.com",
      username: "google.user",
    });

    const res = await request(app())
      .post("/auth/register")
      .send({
        email: "google@example.com",
        ssoRegistrationToken: "token-google-registration-1",
        firstName: "Google",
        lastName: "User",
        birthdate: "1990-01-01T00:00:00.000Z",
        role: "TEACHER",
      });

    expect(res.status).toBe(200);
    expect(createKeycloakUserMock).not.toHaveBeenCalled();
    expect(syncRegisteredSsoUserMock).toHaveBeenCalledWith(expect.objectContaining({
      kcId: "kc-google-1",
      email: "google@example.com",
      username: "google.user",
      role: "TEACHER",
      emailVerified: true,
    }));
    expect(prismaMock.emailVerification.create).not.toHaveBeenCalled();
    expect(consumeSsoRegistrationMock).toHaveBeenCalledWith("token-google-registration-1");
  });

  it("POST /auth/verify token válido", async () => {
    prismaMock.emailVerification.findUnique.mockResolvedValue({
      token: "12345678901234567890123456789012",
      userId: "u1",
      usedAt: null,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    const res = await request(app())
      .post("/auth/verify")
      .send({ token: "12345678901234567890123456789012" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("GET /auth/me devuelve perfil sin campos legacy", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      name: "Usuario",
      emailVerifiedAt: new Date(),
      username: "u.test",
      nationalId: "12345678",
      nationalIdDocumentExpiresAt: null,
      firstName: "U",
      lastName: "Test",
      phone: null,
      birthdate: new Date("1990-01-01"),
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
      orgRole: { code: "STAFF" },
    });
    const res = await request(app()).get("/auth/me").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("STAFF");
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.twoFactorEnabled).toBeUndefined();
    expect(res.body.hasPassword).toBeUndefined();
  });

  it("GET /auth/me marca needsProfileCompletion cuando faltan datos", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      name: "Usuario",
      emailVerifiedAt: null,
      username: null,
      nationalId: null,
      nationalIdDocumentExpiresAt: null,
      firstName: null,
      lastName: null,
      phone: null,
      birthdate: null,
      isApproved: false,
      approvedAt: null,
      isActive: true,
      orgRole: { code: "STAFF" },
    });
    const res = await request(app()).get("/auth/me").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.needsProfileCompletion).toBe(true);
    // El menú lo arma el frontend a partir de `permissions`; ya no se devuelve navLinks.
    expect(res.body.navLinks).toBeUndefined();
    expect(Array.isArray(res.body.permissions)).toBe(true);
  });

  it("GET /auth/registration-options informa estado de liveness/Didit", async () => {
    const res = await request(app()).get("/auth/registration-options");
    expect(res.status).toBe(200);
    expect(res.body.livenessCheckEnabled).toBe(false);
    expect(res.body.diditConfigured).toBe(false);
  });

  it("GET /auth/check-username disponible cuando no existe", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app()).get("/auth/check-username").query({ u: "nuevo.user" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true, valid: true });
  });

  it("POST /auth/register valida body inválido", async () => {
    const res = await request(app())
      .post("/auth/register")
      .send({ email: "no-es-email", password: "x" });
    expect(res.status).toBe(400);
  });

  it("POST /auth/register rechaza email ya registrado", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u-existente" });
    const res = await request(app())
      .post("/auth/register")
      .send({
        email: "repetido@example.com",
        password: "Segura123!",
        firstName: "Repe",
        lastName: "Tido",
      });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Email/i);
  });

  it("POST /auth/register rechaza celular inválido", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .post("/auth/register")
      .send({
        email: "tel@example.com",
        password: "Segura123!",
        firstName: "Tel",
        lastName: "Malo",
        phone: "1234567",
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Celular/i);
  });

  it("POST /auth/register devuelve 502 si falla Keycloak", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "u-kc-fail",
      email: "kcfail@example.com",
      username: "kc.fail",
    });
    createKeycloakUserMock.mockRejectedValueOnce(new Error("kc down"));
    const res = await request(app())
      .post("/auth/register")
      .send({
        email: "kcfail@example.com",
        password: "Segura123!",
        firstName: "Kc",
        lastName: "Fail",
      });
    expect(res.status).toBe(502);
  });

  it("POST /auth/register devuelve 409 si Prisma detecta duplicado durante el alta", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const duplicate = new Error("Unique constraint failed") as Error & { code?: string };
    duplicate.code = "P2002";
    prismaMock.user.create.mockRejectedValueOnce(duplicate);

    const res = await request(app())
      .post("/auth/register")
      .send({
        email: "race@example.com",
        password: "Segura123!",
        firstName: "Race",
        lastName: "Condition",
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/registrado/i);
    expect(createKeycloakUserMock).not.toHaveBeenCalled();
  });

  it("POST /auth/verify rechaza token vencido", async () => {
    prismaMock.emailVerification.findUnique.mockResolvedValue({
      token: "12345678901234567890123456789012",
      userId: "u1",
      usedAt: null,
      expiresAt: new Date("2000-01-01T00:00:00.000Z"),
    });
    const res = await request(app())
      .post("/auth/verify")
      .send({ token: "12345678901234567890123456789012" });
    expect(res.status).toBe(400);
  });

  it("POST /auth/verify/resend genera nuevo token", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      emailVerifiedAt: null,
    });
    prismaMock.emailVerification.create.mockResolvedValue({});
    const res = await request(app()).post("/auth/verify/resend").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(prismaMock.emailVerification.create).toHaveBeenCalled();
  });

  it("PUT /auth/profile actualiza nombre", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      nationalId: "12345678",
      firstName: "Viejo",
      lastName: "Nombre",
      isApproved: false,
    });
    prismaMock.user.update.mockResolvedValue({ id: "user-1" });
    const res = await request(app())
      .put("/auth/profile")
      .set(authHeader())
      .send({ firstName: "Nuevo", lastName: "Apellido" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  it("PUT /auth/profile permite a un ADMIN cambiar el rol", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      nationalId: "12345678",
      firstName: "Admin",
      lastName: "User",
      isApproved: true,
    });
    prismaMock.user.update.mockResolvedValue({ id: "user-1" });
    const res = await request(app())
      .put("/auth/profile")
      .set(authHeader("ADMIN", "admin-1"))
      .send({ role: "TEACHER" });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  it("POST /auth/register rechaza cédula ya registrada", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "u-con-ci" });
    const res = await request(app())
      .post("/auth/register")
      .send({
        email: "ci@example.com",
        password: "Segura123!",
        firstName: "Con",
        lastName: "Cedula",
        nationalId: "11111111",
      });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Cédula|Documento/i);
  });

  it("GET /auth/me tolera fallo al inicializar permisos", async () => {
    ensureDefaultPermissionsMock.mockRejectedValueOnce(new Error("db down"));
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      name: "Usuario",
      emailVerifiedAt: new Date(),
      username: "u.test",
      nationalId: "12345678",
      nationalIdDocumentExpiresAt: null,
      firstName: "U",
      lastName: "Test",
      phone: null,
      birthdate: new Date("1990-01-01"),
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
      orgRole: { code: "STAFF" },
    });
    const res = await request(app()).get("/auth/me").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("STAFF");
  });

  it("PUT /auth/profile devuelve 409 si el username está en uso", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        id: "user-1",
        nationalId: "12345678",
        firstName: "Viejo",
        lastName: "Nombre",
        isApproved: false,
      })
      .mockResolvedValueOnce({ id: "otro-user", username: "tomado" });
    const res = await request(app())
      .put("/auth/profile")
      .set(authHeader())
      .send({ username: "tomado" });
    expect(res.status).toBe(409);
  });
});
