import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../test-utils/bearer-token.js";

const {
  prismaMock,
  sendMailMock,
  createKeycloakUserMock,
  syncKeycloakUserIdentityMock,
  syncRegisteredSsoUserMock,
  getSsoRegistrationMock,
  consumeSsoRegistrationMock,
  ensureDefaultPermissionsMock,
  livenessRequiredMock,
  diditConfiguredMock,
  syncLivenessMock,
  fetchDecisionMock,
  expiryErrorMock,
  getOrgRoleIdMock,
  saveSessionMock,
  newSessionIdMock,
} = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
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
  syncKeycloakUserIdentityMock: vi.fn().mockResolvedValue(undefined),
  syncRegisteredSsoUserMock: vi.fn().mockResolvedValue(undefined),
  getSsoRegistrationMock: vi.fn().mockResolvedValue(null),
  consumeSsoRegistrationMock: vi.fn().mockResolvedValue(null),
  ensureDefaultPermissionsMock: vi.fn().mockResolvedValue(undefined),
  livenessRequiredMock: vi.fn().mockReturnValue(false),
  diditConfiguredMock: vi.fn().mockReturnValue(false),
  syncLivenessMock: vi.fn().mockResolvedValue(undefined),
  fetchDecisionMock: vi.fn().mockResolvedValue(null),
  expiryErrorMock: vi.fn().mockReturnValue(null),
  getOrgRoleIdMock: vi.fn().mockResolvedValue("mock-org-role-id"),
  saveSessionMock: vi.fn().mockResolvedValue(undefined),
  newSessionIdMock: vi.fn().mockReturnValue("perf-sid-1"),
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../notifications/email.js", () => ({ sendMail: sendMailMock }));
vi.mock("../auth/keycloak.js", () => ({
  createKeycloakUser: createKeycloakUserMock,
  syncKeycloakUserIdentity: syncKeycloakUserIdentityMock,
  syncRegisteredSsoUser: syncRegisteredSsoUserMock,
  freeKeycloakUsernameIfOrphan: vi.fn().mockResolvedValue(false),
}));
vi.mock("../auth/sso-registration.js", () => ({
  getSsoRegistration: getSsoRegistrationMock,
  consumeSsoRegistration: consumeSsoRegistrationMock,
}));
vi.mock("../auth/session-store.js", () => ({ newSessionId: newSessionIdMock, saveSession: saveSessionMock }));
vi.mock("../identity/org-role-service.js", () => ({
  normalizeOrgRoleCode: (raw: string) => raw.trim().toUpperCase(),
  getOrgRoleIdByCodeOrThrow: getOrgRoleIdMock,
}));
vi.mock("../config/system-settings.js", () => ({
  isLivenessRequiredForRegistration: livenessRequiredMock,
  isDiditConfigured: diditConfiguredMock,
}));
vi.mock("../integrations/didit/sync-session.js", () => ({
  syncLivenessSessionFromDiditApi: syncLivenessMock,
  fetchDiditDecisionJson: fetchDecisionMock,
}));
vi.mock("../integrations/didit/register-verification-from-decision.js", () => ({
  getDocumentExpiryValidationErrorFromDecision: expiryErrorMock,
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
    syncKeycloakUserIdentityMock.mockResolvedValue(undefined);
    syncRegisteredSsoUserMock.mockResolvedValue(undefined);
    getSsoRegistrationMock.mockResolvedValue(null);
    consumeSsoRegistrationMock.mockResolvedValue(null);
    ensureDefaultPermissionsMock.mockResolvedValue(undefined);
    livenessRequiredMock.mockReturnValue(false);
    diditConfiguredMock.mockReturnValue(false);
    syncLivenessMock.mockResolvedValue(undefined);
    fetchDecisionMock.mockResolvedValue(null);
    expiryErrorMock.mockReturnValue(null);
    getOrgRoleIdMock.mockResolvedValue("mock-org-role-id");
    saveSessionMock.mockResolvedValue(undefined);
    newSessionIdMock.mockReturnValue("perf-sid-1");
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
    delete process.env.EDUTRACK_PERFORMANCE_AUTH_ENABLED;
    delete process.env.EDUTRACK_PERFORMANCE_AUTH_SECRET;
    delete process.env.EDUTRACK_PERFORMANCE_SESSION_TTL_MINUTES;
  });

  // Evita filtrar FRONTEND_URL a otros archivos de test (vitest corre en un único
  // fork, sin paralelismo de archivos: el env global es compartido).
  const previousFrontendUrl = process.env.FRONTEND_URL;
  afterEach(() => {
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
    delete process.env.EDUTRACK_PERFORMANCE_AUTH_ENABLED;
    delete process.env.EDUTRACK_PERFORMANCE_AUTH_SECRET;
    delete process.env.EDUTRACK_PERFORMANCE_SESSION_TTL_MINUTES;
  });

  it("GET /auth/check-username nombre corto", async () => {
    const res = await request(app()).get("/auth/check-username").query({ u: "ab" });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });

  it("POST /auth/performance/session queda apagado por defecto", async () => {
    const res = await request(app())
      .post("/auth/performance/session")
      .set("x-edutrack-performance-secret", "secret")
      .send({ identifier: "perf@example.com" });

    expect(res.status).toBe(404);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("POST /auth/performance/session rechaza secret invalido", async () => {
    process.env.EDUTRACK_PERFORMANCE_AUTH_ENABLED = "true";
    process.env.EDUTRACK_PERFORMANCE_AUTH_SECRET = "expected-secret";

    const res = await request(app())
      .post("/auth/performance/session")
      .set("x-edutrack-performance-secret", "wrong-secret")
      .send({ identifier: "perf@example.com" });

    expect(res.status).toBe(403);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("POST /auth/performance/session crea sesion para usuario habilitado", async () => {
    process.env.EDUTRACK_PERFORMANCE_AUTH_ENABLED = "true";
    process.env.EDUTRACK_PERFORMANCE_AUTH_SECRET = "expected-secret";
    process.env.EDUTRACK_PERFORMANCE_SESSION_TTL_MINUTES = "15";
    prismaMock.user.findFirst.mockResolvedValue({
      id: "user-perf-1",
      email: "perf@example.com",
      googleId: "kc-perf-1",
      isActive: true,
      isApproved: true,
      lockUntil: null,
      orgRole: { code: "STAFF", active: true },
    });

    const res = await request(app())
      .post("/auth/performance/session")
      .set("x-edutrack-performance-secret", "expected-secret")
      .send({ identifier: "perf@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.sid).toBe("perf-sid-1");
    expect(saveSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      sid: "perf-sid-1",
      userId: "user-perf-1",
      kcId: "kc-perf-1",
      email: "perf@example.com",
      role: "STAFF",
      accessToken: "performance-baseline",
    }));
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
      orgRole: { code: "STAFF", label: "Personal" },
    });
    const res = await request(app()).get("/auth/me").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("STAFF");
    expect(res.body.roleLabel).toBe("Personal");
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
    expect(res.body.message).toMatch(/Correo/i);
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
      email: "user-1@example.com",
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

  it("PUT /auth/profile actualiza correo desde datos personales", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        id: "user-1",
        email: "viejo@example.com",
        nationalId: "12345678",
        firstName: "Viejo",
        lastName: "Nombre",
        isApproved: false,
      })
      .mockResolvedValueOnce(null);
    prismaMock.user.update.mockResolvedValue({ id: "user-1" });
    const res = await request(app())
      .put("/auth/profile")
      .set(authHeader())
      .send({ email: "Nuevo@Example.com" });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { email: "nuevo@example.com", emailVerifiedAt: null },
    });
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

  // --- Registro: manejo de errores inesperados ---
  function registerBody(extra: Record<string, unknown> = {}) {
    return {
      email: "err@example.com",
      password: "Segura123!",
      firstName: "Err",
      lastName: "Handler",
      ...extra,
    };
  }

  it("POST /auth/register mapea P2003 a 400 (rol inválido)", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const e = new Error("fk") as Error & { code?: string };
    e.code = "P2003";
    prismaMock.user.create.mockRejectedValueOnce(e);
    const res = await request(app()).post("/auth/register").send(registerBody());
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Rol/i);
  });

  it("POST /auth/register mapea ROLE_NOT_FOUND a 400", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockRejectedValueOnce(new Error("ROLE_NOT_FOUND: STAFF"));
    const res = await request(app()).post("/auth/register").send(registerBody());
    expect(res.status).toBe(400);
  });

  it("POST /auth/register mapea P2025 a 400 (sesión no disponible)", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const e = new Error("missing") as Error & { code?: string };
    e.code = "P2025";
    prismaMock.user.create.mockRejectedValueOnce(e);
    const res = await request(app()).post("/auth/register").send(registerBody());
    expect(res.status).toBe(400);
  });

  it("POST /auth/register devuelve 500 ante error inesperado", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockRejectedValueOnce(new Error("boom"));
    const res = await request(app()).post("/auth/register").send(registerBody());
    expect(res.status).toBe(500);
  });

  // --- Registro SSO: token vencido y email que no coincide ---
  it("POST /auth/register con ssoToken vencido devuelve 400", async () => {
    getSsoRegistrationMock.mockResolvedValue(null);
    const res = await request(app())
      .post("/auth/register")
      .send(registerBody({ ssoRegistrationToken: "x".repeat(30), password: undefined }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Google/i);
  });

  it("POST /auth/register exige contraseña cuando no hay SSO", async () => {
    const res = await request(app())
      .post("/auth/register")
      .send(registerBody({ password: undefined }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/contraseña/i);
  });

  it("POST /auth/register rechaza email que no coincide con Google", async () => {
    getSsoRegistrationMock.mockResolvedValue({
      kcId: "kc-1",
      email: "otro@example.com",
      emailVerified: true,
    });
    const res = await request(app())
      .post("/auth/register")
      .send(registerBody({ ssoRegistrationToken: "x".repeat(30), password: undefined }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no coincide/i);
  });

  // --- Registro con prueba de vida (Didit) ---
  const validUuid = "11111111-1111-4111-8111-111111111111";
  function livenessOn() {
    livenessRequiredMock.mockReturnValue(true);
    diditConfiguredMock.mockReturnValue(true);
    prismaMock.user.findUnique.mockResolvedValue(null);
  }

  it("POST /auth/register devuelve 503 si liveness requerido pero Didit sin configurar", async () => {
    livenessRequiredMock.mockReturnValue(true);
    diditConfiguredMock.mockReturnValue(false);
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app()).post("/auth/register").send(registerBody());
    expect(res.status).toBe(503);
  });

  it("POST /auth/register exige livenessToken cuando hay prueba de vida", async () => {
    livenessOn();
    const res = await request(app()).post("/auth/register").send(registerBody());
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/prueba de vida/i);
  });

  it("POST /auth/register rechaza sesión de liveness no aprobada", async () => {
    livenessOn();
    prismaMock.livenessSession.findFirst.mockResolvedValue({
      id: "ls1",
      status: "PENDING",
      consumedAt: null,
      diditSessionId: null,
      expiresAt: new Date(Date.now() + 100000),
    });
    const res = await request(app())
      .post("/auth/register")
      .send(registerBody({ livenessToken: validUuid }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no válida|aprobada/i);
  });

  it("POST /auth/register rechaza liveness vencido", async () => {
    livenessOn();
    prismaMock.livenessSession.findFirst.mockResolvedValue({
      id: "ls1",
      status: "APPROVED",
      consumedAt: null,
      diditSessionId: "d1",
      expiresAt: new Date(Date.now() - 100000),
    });
    const res = await request(app())
      .post("/auth/register")
      .send(registerBody({ livenessToken: validUuid }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/venció/i);
  });

  it("POST /auth/register rechaza liveness sin documento validado por Didit", async () => {
    livenessOn();
    prismaMock.livenessSession.findFirst.mockResolvedValue({
      id: "ls1",
      status: "APPROVED",
      consumedAt: null,
      diditSessionId: "d1",
      expiresAt: new Date(Date.now() + 100000),
    });
    fetchDecisionMock.mockResolvedValue(null);
    const res = await request(app())
      .post("/auth/register")
      .send(registerBody({ livenessToken: validUuid }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/documento/i);
  });

  it("POST /auth/register rechaza documento vencido según Didit", async () => {
    livenessOn();
    prismaMock.livenessSession.findFirst.mockResolvedValue({
      id: "ls1",
      status: "APPROVED",
      consumedAt: null,
      diditSessionId: "d1",
      expiresAt: new Date(Date.now() + 100000),
    });
    fetchDecisionMock.mockResolvedValue({ decision: {} });
    expiryErrorMock.mockReturnValue("El documento está vencido");
    const res = await request(app())
      .post("/auth/register")
      .send(registerBody({ livenessToken: validUuid, birthdate: "1990-01-01T00:00:00.000Z" }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/vencido/i);
  });

  it("POST /auth/register completa con liveness aprobado (sincroniza desde Didit)", async () => {
    livenessOn();
    prismaMock.livenessSession.findFirst.mockResolvedValue({
      id: "ls1",
      status: "PENDING",
      consumedAt: null,
      diditSessionId: "d1",
      expiresAt: new Date(Date.now() + 100000),
    });
    prismaMock.livenessSession.findUnique.mockResolvedValue({
      id: "ls1",
      status: "APPROVED",
      consumedAt: null,
      diditSessionId: "d1",
      expiresAt: new Date(Date.now() + 100000),
    });
    fetchDecisionMock.mockResolvedValue({ decision: {} });
    expiryErrorMock.mockReturnValue(null);
    prismaMock.user.create.mockResolvedValue({ id: "u-lv", email: "err@example.com", username: "err.handler" });
    const res = await request(app())
      .post("/auth/register")
      .send(registerBody({ livenessToken: validUuid }));
    expect(res.status).toBe(200);
    expect(syncLivenessMock).toHaveBeenCalledWith("ls1");
  });

  // --- Perfil: cédula y rol ---
  const validCi = "12345672";

  it("PUT /auth/profile rechaza cédula con formato inválido", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "u@example.com",
      nationalId: null,
      firstName: "U",
      lastName: "T",
    });
    const res = await request(app())
      .put("/auth/profile")
      .set(authHeader())
      .send({ nationalId: "123456" });
    expect(res.status).not.toBe(200);
  });

  it("PUT /auth/profile devuelve conflicto si la cédula ya existe", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: "user-1", email: "u@example.com", nationalId: null })
      .mockResolvedValueOnce({ id: "otro", nationalId: validCi });
    const res = await request(app())
      .put("/auth/profile")
      .set(authHeader())
      .send({ nationalId: validCi });
    expect(res.status).not.toBe(200);
  });

  it("PUT /auth/profile prohíbe a no-admin cambiar una cédula ya establecida", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: "user-1", email: "u@example.com", nationalId: "87654321" })
      .mockResolvedValueOnce(null);
    const res = await request(app())
      .put("/auth/profile")
      .set(authHeader())
      .send({ nationalId: validCi });
    expect(res.status).not.toBe(200);
  });

  it("PUT /auth/profile devuelve 400 si el rol no se puede resolver", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "admin-1",
      nationalId: "12345678",
      firstName: "Admin",
      lastName: "User",
      isApproved: true,
    });
    getOrgRoleIdMock.mockRejectedValueOnce(new Error("ROLE_NOT_FOUND"));
    const res = await request(app())
      .put("/auth/profile")
      .set(authHeader("ADMIN", "admin-1"))
      .send({ role: "TEACHER" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Rol/i);
  });

  // --- Perfil: sincronización de correo con Keycloak (requiere bffSession) ---
  function appWithSession(session: Record<string, unknown>) {
    const a = express();
    a.use(express.json());
    a.use(cookieParser());
    a.use((req, _res, next) => {
      (req as any).bffSession = session;
      next();
    });
    a.use("/auth", authRoutes);
    return a;
  }

  it("PUT /auth/profile sincroniza correo en Keycloak y actualiza la sesión", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: "user-1", email: "viejo@example.com", nationalId: "12345678" })
      .mockResolvedValueOnce(null);
    prismaMock.user.update.mockResolvedValue({ id: "user-1" });
    const session: Record<string, unknown> = { kcId: "kc-1", email: "viejo@example.com" };
    const res = await request(appWithSession(session))
      .put("/auth/profile")
      .set(authHeader())
      .send({ email: "nuevo@example.com" });
    expect(res.status).toBe(200);
    expect(syncKeycloakUserIdentityMock).toHaveBeenCalledWith(
      expect.objectContaining({ kcId: "kc-1", email: "nuevo@example.com" }),
    );
    expect(saveSessionMock).toHaveBeenCalled();
  });

  it("PUT /auth/profile devuelve 502 si falla la sincronización de correo en Keycloak", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: "user-1", email: "viejo@example.com", nationalId: "12345678" })
      .mockResolvedValueOnce(null);
    syncKeycloakUserIdentityMock.mockRejectedValueOnce(new Error("kc down"));
    const res = await request(appWithSession({ kcId: "kc-1" }))
      .put("/auth/profile")
      .set(authHeader())
      .send({ email: "nuevo@example.com" });
    expect(res.status).toBe(502);
  });

  // --- verify/resend: casos sin envío ---
  it("POST /auth/verify/resend responde ok aunque el usuario no exista", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app()).post("/auth/verify/resend").set(authHeader());
    expect(res.status).toBe(200);
    expect(prismaMock.emailVerification.create).not.toHaveBeenCalled();
  });

  it("POST /auth/verify/resend no reenvía si el correo ya está verificado", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      emailVerifiedAt: new Date(),
    });
    const res = await request(app()).post("/auth/verify/resend").set(authHeader());
    expect(res.status).toBe(200);
    expect(prismaMock.emailVerification.create).not.toHaveBeenCalled();
  });

  it("GET /auth/register/sso devuelve 404 si el token no existe", async () => {
    getSsoRegistrationMock.mockResolvedValue(null);
    const res = await request(app()).get("/auth/register/sso").query({ token: "no-existe" });
    expect(res.status).toBe(404);
  });

  // --- /me: permisos por rol ---
  function meRow(extra: Record<string, unknown> = {}) {
    return {
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
      ...extra,
    };
  }

  it("GET /auth/me mapea permisos con scope ALL y own", async () => {
    prismaMock.user.findUnique.mockResolvedValue(meRow());
    prismaMock.rolePermission.findMany.mockResolvedValueOnce([
      { permission: { code: "events.read" }, scope: "ALL" },
      { permission: { code: "events.write" }, scope: "OWN" },
    ]);
    const res = await request(app()).get("/auth/me").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.permissions).toEqual([
      { id: "events.read", scope: "all" },
      { id: "events.write", scope: "own" },
    ]);
    expect(res.body.permissionIds).toEqual(["events.read", "events.write"]);
  });

  it("GET /auth/me tolera fallo al consultar permisos", async () => {
    prismaMock.user.findUnique.mockResolvedValue(meRow());
    prismaMock.rolePermission.findMany.mockRejectedValueOnce(new Error("db down"));
    const res = await request(app()).get("/auth/me").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.permissions).toEqual([]);
  });

  it("GET /auth/me devuelve 401 si el usuario no existe", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app()).get("/auth/me").set(authHeader());
    expect(res.status).toBe(401);
  });

  // --- Registro: rol inválido, placeholder SSO, diditId faltante, username con 2do apellido ---
  it("POST /auth/register devuelve 400 si el rol no se resuelve", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    getOrgRoleIdMock.mockRejectedValueOnce(new Error("ROLE_NOT_FOUND"));
    const res = await request(app()).post("/auth/register").send(registerBody());
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Rol/i);
  });

  it("POST /auth/register completa cuenta placeholder de Google", async () => {
    getSsoRegistrationMock.mockResolvedValue({
      kcId: "kc-ph",
      email: "ph@example.com",
      emailVerified: true,
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u-ph",
      email: "ph@example.com",
      username: "ph.user",
      isActive: true,
      isApproved: false,
    });
    prismaMock.user.update.mockResolvedValue({ id: "u-ph", email: "ph@example.com", username: "ph.user" });
    const res = await request(app())
      .post("/auth/register")
      .send(registerBody({ email: "ph@example.com", password: undefined, ssoRegistrationToken: "x".repeat(30) }));
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("POST /auth/register rechaza sesión Didit sin diditSessionId", async () => {
    livenessOn();
    prismaMock.livenessSession.findFirst.mockResolvedValue({
      id: "ls1",
      status: "APPROVED",
      consumedAt: null,
      diditSessionId: null,
      expiresAt: new Date(Date.now() + 100000),
    });
    const res = await request(app())
      .post("/auth/register")
      .send(registerBody({ livenessToken: validUuid }));
    expect(res.status).toBe(400);
  });

  it("POST /auth/register genera username con inicial del segundo apellido", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: "u-2", email: "dl@example.com", username: "dario.de" });
    const res = await request(app())
      .post("/auth/register")
      .send(registerBody({ email: "dl@example.com", firstName: "Dario", lastName: "De Leon" }));
    expect(res.status).toBe(200);
  });

  // --- Perfil: cédula válida seteada por admin, body inválido ---
  it("PUT /auth/profile permite a un ADMIN setear la cédula", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: "admin-1", email: "a@example.com", nationalId: null, isApproved: true })
      .mockResolvedValueOnce(null);
    prismaMock.user.update.mockResolvedValue({ id: "admin-1" });
    const res = await request(app())
      .put("/auth/profile")
      .set(authHeader("ADMIN", "admin-1"))
      .send({ nationalId: validCi });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nationalId: validCi }) }),
    );
  });

  it("PUT /auth/profile rechaza username con caracteres inválidos", async () => {
    const res = await request(app())
      .put("/auth/profile")
      .set(authHeader())
      .send({ username: "no validos!" });
    expect(res.status).toBe(400);
  });

  it("POST /auth/verify rechaza body inválido", async () => {
    const res = await request(app()).post("/auth/verify").send({ token: "corto" });
    expect(res.status).toBe(400);
  });
});
