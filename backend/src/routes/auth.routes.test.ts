import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../jwt.js";

const { prismaMock, sendMailMock, totpVerifyMock } = vi.hoisted(() => ({
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
    },
    $transaction: vi.fn(),
    emailVerification: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    passwordReset: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: "a1" }),
    },
  },
  sendMailMock: vi.fn().mockResolvedValue(undefined),
  totpVerifyMock: vi.fn().mockReturnValue({ valid: true }),
}));

vi.mock("../prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../email.js", () => ({
  sendMail: sendMailMock,
}));

vi.mock("@prisma/client", () => ({
  AuditAction: {
    AUTH_LOGIN_SUCCESS: "AUTH_LOGIN_SUCCESS",
    AUTH_LOGIN_FAILURE: "AUTH_LOGIN_FAILURE",
    AUTH_LOGOUT: "AUTH_LOGOUT",
    AUTH_GOOGLE_LOGIN_SUCCESS: "AUTH_GOOGLE_LOGIN_SUCCESS",
  },
}));

vi.mock("../org-role-service.js", () => ({
  normalizeOrgRoleCode: (raw: string) => raw.trim().toUpperCase(),
  getOrgRoleIdByCodeOrThrow: vi.fn().mockResolvedValue("mock-org-role-id"),
}));

vi.mock("argon2", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$argon2id$hashed"),
    verify: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,qr"),
  },
}));

vi.mock("otplib", () => ({
  generateSecret: vi.fn(() => "TESTTOTPSECRET"),
  generateURI: vi.fn(() => "otpauth://totp/EduTrack:u@example.com?secret=TESTTOTPSECRET"),
  verifySync: totpVerifyMock,
}));

import authRoutes from "./auth.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use("/auth", authRoutes);
  return a;
}

describe("auth routes (mocks)", () => {
  const authHeader = (role = "STAFF", sub = "user-1") => ({
    Authorization: `Bearer ${signAccessToken({ sub, email: `${sub}@example.com`, role: role as "STAFF" })}`,
  });
  let forgotIpSequence = 0;
  const forgotRequest = () =>
    request(app())
      .post("/auth/forgot")
      .set("x-forwarded-for", `10.0.0.${++forgotIpSequence}`);

  beforeEach(async () => {
    vi.clearAllMocks();
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue(undefined);
    prismaMock.user.findFirst.mockReset();
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.update.mockReset();
    prismaMock.systemSettings.upsert.mockResolvedValue({
      livenessCheckEnabled: false,
      attendanceNoShowGraceMinutes: 15,
      attendanceLateToleranceMinutes: 5,
      attendanceMonitorEnabled: true,
      attendanceMonitorIntervalMs: 120000,
      biometricLateHour: 8,
      biometricLateMinute: 30,
    });
    prismaMock.livenessSession.findUnique.mockReset();
    prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === "function") {
        return (arg as (tx: { user: typeof prismaMock.user; livenessSession: { update: ReturnType<typeof vi.fn> } }) => Promise<unknown>)(
          {
            user: prismaMock.user,
            livenessSession: { update: vi.fn().mockResolvedValue({}) },
          },
        );
      }
      return Promise.all(arg as Promise<unknown>[]);
    });
    process.env.FRONTEND_URL = "http://frontend.local";
    delete process.env.TURNSTILE_SECRET;
    vi.unstubAllGlobals();
    const argon2 = await import("argon2");
    vi.mocked(argon2.default.verify).mockResolvedValue(true);
    totpVerifyMock.mockReturnValue({ valid: true });
  });

  it("GET /auth/check-username nombre corto", async () => {
    const res = await request(app()).get("/auth/check-username").query({ u: "ab" });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.available).toBe(false);
  });

  it("GET /auth/check-username disponible", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app()).get("/auth/check-username").query({ u: "usuario_ok" });
    expect(res.body.valid).toBe(true);
    expect(res.body.available).toBe(true);
  });

  it("POST /auth/register datos inválidos", async () => {
    const res = await request(app()).post("/auth/register").send({ email: "x" });
    expect(res.status).toBe(400);
  });

  it("POST /auth/verify body inválido", async () => {
    const res = await request(app()).post("/auth/verify").send({});
    expect(res.status).toBe(400);
  });

  it("POST /auth/verify token inexistente", async () => {
    prismaMock.emailVerification.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .post("/auth/verify")
      .send({ token: "12345678901234567890123456789012" });
    expect(res.status).toBe(400);
  });

  it("POST /auth/verify token vencido", async () => {
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

  it("POST /auth/verify flujo feliz usa transacción", async () => {
    prismaMock.emailVerification.findUnique.mockResolvedValue({
      token: "12345678901234567890123456789012",
      userId: "u1",
      usedAt: null,
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
    });
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.emailVerification.update.mockResolvedValue({});

    const res = await request(app())
      .post("/auth/verify")
      .send({ token: "12345678901234567890123456789012" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
  });

  it("GET /auth/me sin sesión 401", async () => {
    const res = await request(app()).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("POST /auth/register flujo feliz crea usuario", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "uid-new",
      email: "n@n.com",
      username: "nuser",
      roleId: "mock-org-role-id",
    });
    prismaMock.emailVerification.create.mockResolvedValue({});
    prismaMock.refreshToken.create.mockResolvedValue({});
    const res = await request(app())
      .post("/auth/register")
      .send({
        email: "n@n.com",
        password: "Abcd1234!",
        firstName: "N",
        lastName: "N",
      });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("uid-new");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("POST /auth/register tolera fallo SMTP al enviar verificación", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("smtp down"));
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "uid-smtp",
      email: "smtp@n.com",
      username: "smtpuser",
      roleId: "mock-org-role-id",
    });
    prismaMock.emailVerification.create.mockResolvedValue({});
    prismaMock.refreshToken.create.mockResolvedValue({});
    const res = await request(app())
      .post("/auth/register")
      .send({
        email: "smtp@n.com",
        password: "Abcd1234!",
        firstName: "S",
        lastName: "M",
      });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("uid-smtp");
  });

  it("POST /auth/login bloquea tras 5 intentos fallidos", async () => {
    const argon2 = await import("argon2");
    vi.mocked(argon2.default.verify).mockResolvedValue(false);
    let lockUntil: Date | null = null;
    let failedAttempts = 0;
    prismaMock.user.findFirst.mockImplementation(() =>
      Promise.resolve({
        id: "u1",
        email: "u@example.com",
        orgRole: { code: "STAFF" },
        passwordHash: "$argon2id$existing",
        isActive: true,
        lockUntil,
      }),
    );
    prismaMock.user.findUnique.mockImplementation(() =>
      Promise.resolve({ failedLoginAttempts: failedAttempts }),
    );
    prismaMock.user.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      if (data.lockUntil) {
        lockUntil = data.lockUntil as Date;
        failedAttempts = 0;
      } else if (typeof data.failedLoginAttempts === "number") {
        failedAttempts = data.failedLoginAttempts as number;
      }
      return {};
    });
    for (let i = 0; i < 5; i++) {
      const res = await request(app())
        .post("/auth/login")
        .send({ identifier: "u@example.com", password: "WrongPass1!" });
      expect(res.status).toBe(401);
    }
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lockUntil: expect.any(Date), failedLoginAttempts: 0 }),
      }),
    );
    const locked = await request(app())
      .post("/auth/login")
      .send({ identifier: "u@example.com", password: "WrongPass1!" });
    expect(locked.status).toBe(429);
    vi.mocked(argon2.default.verify).mockResolvedValue(true);
  });

  it("POST /auth/register 409 email duplicado", async () => {
    prismaMock.user.findUnique.mockImplementation(({ where }: any) => {
      if (where.email) return Promise.resolve({ id: "x" });
      return Promise.resolve(null);
    });
    const res = await request(app())
      .post("/auth/register")
      .send({
        email: "dup@d.com",
        password: "Abcd1234!",
        firstName: "A",
        lastName: "B",
    });
    expect(res.status).toBe(409);
  });

  it("POST /auth/register 409 username duplicado", async () => {
    prismaMock.user.findUnique.mockImplementation(({ where }: any) => {
      if (where.username) return Promise.resolve({ id: "x" });
      return Promise.resolve(null);
    });
    const res = await request(app())
      .post("/auth/register")
      .send({
        email: "free@d.com",
        username: "dupUser",
        password: "Abcd1234!",
        firstName: "A",
        lastName: "B",
      });
    expect(res.status).toBe(409);
  });

  it("POST /auth/register 400 cédula inválida", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .post("/auth/register")
      .send({
        email: "free@d.com",
        password: "Abcd1234!",
        nationalId: "123",
        firstName: "A",
        lastName: "B",
      });
    expect(res.status).toBe(400);
  });

  it("POST /auth/register 400 teléfono con cédula válida", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .post("/auth/register")
      .send({
        email: "free2@d.com",
        password: "Abcd1234!",
        firstName: "A",
        lastName: "B",
        phone: "+59841234563",
      });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/Teléfono|cédula/i);
  });

  it("POST /auth/verify/resend devuelve ok si el usuario no existe", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app()).post("/auth/verify/resend").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(prismaMock.emailVerification.create).not.toHaveBeenCalled();
  });

  it("POST /auth/verify/resend devuelve ok si ya estaba verificado", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      emailVerifiedAt: new Date(),
    });
    const res = await request(app()).post("/auth/verify/resend").set(authHeader());
    expect(res.status).toBe(200);
    expect(prismaMock.emailVerification.create).not.toHaveBeenCalled();
  });

  it("POST /auth/verify/resend crea token y tolera fallo SMTP", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      emailVerifiedAt: null,
    });
    prismaMock.emailVerification.create.mockResolvedValue({});
    sendMailMock.mockRejectedValueOnce(new Error("smtp"));
    const res = await request(app()).post("/auth/verify/resend").set(authHeader());
    expect(res.status).toBe(200);
    expect(prismaMock.emailVerification.create).toHaveBeenCalledOnce();
  });

  it("PUT /auth/profile 400 body inválido", async () => {
    const res = await request(app()).put("/auth/profile").set(authHeader()).send({ username: "a" });
    expect(res.status).toBe(400);
  });

  it("PUT /auth/profile 409 username en conflicto", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: "user-1", nationalId: null })
      .mockResolvedValueOnce({ id: "other-user" });
    const res = await request(app())
      .put("/auth/profile")
      .set(authHeader())
      .send({ username: "takenName" });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Usuario/);
  });

  it("PUT /auth/profile 403 CI prohibida si no es inicial", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1", nationalId: "12345678" });
    const res = await request(app())
      .put("/auth/profile")
      .set(authHeader())
      .send({ nationalId: "30458651" });
    expect(res.status).toBe(403);
  });

  it("PUT /auth/profile actualiza datos válidos", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: "user-1", nationalId: null })
      .mockResolvedValueOnce(null);
    prismaMock.user.update.mockResolvedValue({ id: "user-1" });
    const res = await request(app())
      .put("/auth/profile")
      .set(authHeader())
      .send({
        username: "good_name",
        nationalId: "30458651",
        firstName: "Ada",
        lastName: "Lovelace",
        phone: "099123456",
        birthdate: "20/05/2000",
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("PUT /auth/profile no borra username ni cédula cuando llegan campos parciales", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      username: "teacher1",
      nationalId: "30458651",
      firstName: "Ada",
      lastName: "Lovelace",
    });
    prismaMock.user.update.mockResolvedValue({ id: "user-1" });

    const res = await request(app())
      .put("/auth/profile")
      .set(authHeader())
      .send({ firstName: "Alicia" });

    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        firstName: "Alicia",
        name: "Alicia Lovelace",
      },
    });
  });

  it("PUT /auth/profile 401 si el usuario autenticado ya no existe", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const res = await request(app())
      .put("/auth/profile")
      .set(authHeader())
      .send({ firstName: "Alicia" });

    expect(res.status).toBe(401);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("PUT /auth/password 400 si la contraseña no cumple política fuerte", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ passwordHash: null });
    const res = await request(app())
      .put("/auth/password")
      .set(authHeader())
      .send({ password: "noupper1" });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/mayúscula/i);
  });

  it("PUT /auth/password 409 si ya tiene contraseña", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ passwordHash: "$argon2id$existing" });
    const res = await request(app())
      .put("/auth/password")
      .set(authHeader())
      .send({ password: "Abcd1234!" });
    expect(res.status).toBe(409);
  });

  it("PUT /auth/password guarda contraseña inicial", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ passwordHash: null });
    prismaMock.user.update.mockResolvedValue({});
    const res = await request(app())
      .put("/auth/password")
      .set(authHeader())
      .send({ password: "Abcd1234!" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("PUT /auth/password/change 409 si no existe contraseña previa", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ passwordHash: null });
    const res = await request(app())
      .put("/auth/password/change")
      .set(authHeader())
      .send({ currentPassword: "Abcd1234!", newPassword: "Xyz98765!" });
    expect(res.status).toBe(409);
  });

  it("PUT /auth/password/change 400 si la nueva no cumple política fuerte", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ passwordHash: "$argon2id$existing" });
    const res = await request(app())
      .put("/auth/password/change")
      .set(authHeader())
      .send({ currentPassword: "Abcd1234!", newPassword: "solominus1" });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/mayúscula/i);
  });

  it("PUT /auth/password/change 401 si la actual no coincide", async () => {
    const argon2 = await import("argon2");
    vi.mocked(argon2.default.verify).mockResolvedValueOnce(false);
    prismaMock.user.findUnique.mockResolvedValue({ passwordHash: "$argon2id$existing" });
    const res = await request(app())
      .put("/auth/password/change")
      .set(authHeader())
      .send({ currentPassword: "Abcd1234!", newPassword: "Xyz98765!" });
    expect(res.status).toBe(401);
  });

  it("PUT /auth/password/change actualiza contraseña", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ passwordHash: "$argon2id$existing" });
    prismaMock.user.update.mockResolvedValue({});
    const res = await request(app())
      .put("/auth/password/change")
      .set(authHeader())
      .send({ currentPassword: "Abcd1234!", newPassword: "Xyz98765!" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("POST /auth/login 403 si la cuenta está desactivada", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: "u1",
      email: "u@example.com",
      orgRole: { code: "STAFF" },
      passwordHash: "$argon2id$existing",
      isActive: false,
    });
    const res = await request(app())
      .post("/auth/login")
      .set("x-forwarded-for", "10.2.0.1")
      .send({ identifier: "u@example.com", password: "Abcd1234!" });
    expect(res.status).toBe(403);
  });

  it("POST /auth/login 429 si la cuenta está bloqueada", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: "u1",
      email: "u@example.com",
      orgRole: { code: "STAFF" },
      passwordHash: "$argon2id$existing",
      isActive: true,
      lockUntil: new Date("2999-01-01T00:00:00.000Z"),
    });
    const res = await request(app())
      .post("/auth/login")
      .send({ identifier: "u@example.com", password: "Abcd1234!" });
    expect(res.status).toBe(429);
  });

  it("POST /auth/login 401 y registra intento fallido", async () => {
    const argon2 = await import("argon2");
    vi.mocked(argon2.default.verify).mockResolvedValueOnce(false);
    prismaMock.user.findFirst.mockResolvedValue({
      id: "u1",
      email: "u@example.com",
      orgRole: { code: "STAFF" },
      passwordHash: "$argon2id$existing",
      isActive: true,
      lockUntil: null,
    });
    prismaMock.user.findUnique.mockResolvedValue({ failedLoginAttempts: 2 });
    prismaMock.user.update.mockResolvedValue({});
    const res = await request(app())
      .post("/auth/login")
      .send({ identifier: "u@example.com", password: "Abcd1234!" });
    expect(res.status).toBe(401);
    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  it("POST /auth/login exitoso limpia bloqueos y emite cookies", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: "u1",
      email: "u@example.com",
      name: "User",
      orgRole: { code: "STAFF" },
      passwordHash: "$argon2id$existing",
      isActive: true,
      lockUntil: null,
    });
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.refreshToken.create.mockResolvedValue({});
    const res = await request(app())
      .post("/auth/login")
      .send({ identifier: "u@example.com", password: "Abcd1234!" });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("POST /auth/login con 2FA activo devuelve token temporal y limpia sesión previa", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: "u1",
      email: "u@example.com",
      name: "User",
      orgRole: { code: "STAFF" },
      passwordHash: "$argon2id$existing",
      isActive: true,
      lockUntil: null,
      twoFactorEnabled: true,
    });
    const res = await request(app())
      .post("/auth/login")
      .send({ identifier: "u@example.com", password: "Abcd1234!" });
    expect(res.status).toBe(200);
    expect(res.body.requiresTwoFactor).toBe(true);
    expect(res.body.twoFactorToken).toEqual(expect.any(String));
    expect(res.headers["set-cookie"]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("access_token=;"),
        expect.stringContaining("refresh_token=;"),
      ]),
    );
    expect(res.headers["set-cookie"]).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/access_token=[^;]/)]),
    );
  });

  it("POST /auth/login/2fa rechaza token temporal inválido", async () => {
    const res = await request(app())
      .post("/auth/login/2fa")
      .send({ twoFactorToken: "token-temporal-invalido", code: "123456" });
    expect(res.status).toBe(401);
  });

  it("POST /auth/2fa/setup y confirm activa 2FA y devuelve códigos de respaldo", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "u@example.com",
      twoFactorEnabled: false,
    });
    prismaMock.user.update.mockResolvedValue({});

    const setup = await request(app())
      .post("/auth/2fa/setup")
      .set(authHeader("STAFF", "user-1"))
      .send({});

    expect(setup.status).toBe(200);
    expect(setup.body.qrCodeDataUrl).toBe("data:image/png;base64,qr");
    const encryptedSecret = prismaMock.user.update.mock.calls[0][0].data.twoFactorSecret;
    expect(encryptedSecret).toEqual(expect.any(String));

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      twoFactorEnabled: false,
      twoFactorSecret: encryptedSecret,
    });

    const confirm = await request(app())
      .post("/auth/2fa/confirm")
      .set(authHeader("STAFF", "user-1"))
      .send({ code: "123456" });

    expect(confirm.status).toBe(200);
    expect(confirm.body.backupCodes).toHaveLength(10);
    expect(prismaMock.user.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          twoFactorEnabled: true,
          twoFactorBackupCodes: expect.any(String),
        }),
      }),
    );
  });

  it("POST /auth/login/2fa con código válido emite cookies", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "u@example.com",
      twoFactorEnabled: false,
    });
    prismaMock.user.update.mockResolvedValue({});
    await request(app())
      .post("/auth/2fa/setup")
      .set(authHeader("STAFF", "user-1"))
      .send({});
    const encryptedSecret = prismaMock.user.update.mock.calls[0][0].data.twoFactorSecret;

    prismaMock.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      name: "User",
      orgRole: { code: "STAFF" },
      passwordHash: "$argon2id$existing",
      isActive: true,
      lockUntil: null,
      twoFactorEnabled: true,
    });
    const loginWith2fa = await request(app())
      .post("/auth/login")
      .set("x-forwarded-for", "10.2.0.3")
      .send({ identifier: "u@example.com", password: "Abcd1234!" });

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "u@example.com",
      name: "User",
      isActive: true,
      twoFactorEnabled: true,
      twoFactorSecret: encryptedSecret,
      twoFactorBackupCodes: null,
      orgRole: { code: "STAFF" },
    });
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.refreshToken.create.mockResolvedValue({});

    const res = await request(app())
      .post("/auth/login/2fa")
      .set("x-forwarded-for", "10.2.0.4")
      .send({ twoFactorToken: loginWith2fa.body.twoFactorToken, code: "123456" });

    expect(loginWith2fa.status).toBe(200);
    expect(loginWith2fa.body.requiresTwoFactor).toBe(true);
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("POST /auth/forgot 400 si falta captcha cuando está habilitado", async () => {
    process.env.TURNSTILE_SECRET = "turnstile-secret";
    const res = await forgotRequest()
      .send({ email: "u@example.com" });
    expect(res.status).toBe(400);
  });

  it("POST /auth/forgot 400 si Turnstile responde fallo", async () => {
    process.env.TURNSTILE_SECRET = "turnstile-secret";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ success: false, "error-codes": ["invalid-input-response"] }),
    }));
    const res = await forgotRequest()
      .send({ email: "u@example.com", captchaToken: "1234567890token" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("captcha");
  });

  it("POST /auth/forgot 400 si Turnstile lanza error técnico", async () => {
    process.env.TURNSTILE_SECRET = "turnstile-secret";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const res = await forgotRequest()
      .send({ email: "u@example.com", captchaToken: "1234567890token" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("captcha");
  });

  it("POST /auth/forgot continúa si Turnstile valida correctamente", async () => {
    process.env.TURNSTILE_SECRET = "turnstile-secret";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ success: true, hostname: "localhost" }),
    }));
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await forgotRequest()
      .send({ email: "nobody@example.com", captchaToken: "1234567890token" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("POST /auth/forgot devuelve ok si el usuario no existe", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await forgotRequest()
      .send({ email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("POST /auth/forgot elimina reset si falla el envío", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1", email: "u@example.com" });
    prismaMock.passwordReset.create.mockResolvedValue({});
    prismaMock.passwordReset.delete.mockResolvedValue({});
    sendMailMock.mockRejectedValueOnce(new Error("smtp"));
    const res = await forgotRequest()
      .send({ email: "u@example.com" });
    expect(res.status).toBe(500);
    expect(prismaMock.passwordReset.delete).toHaveBeenCalled();
  });

  it("POST /auth/forgot devuelve ok cuando crea y envía el reset", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1", email: "u@example.com" });
    prismaMock.passwordReset.create.mockResolvedValue({});
    const res = await forgotRequest()
      .send({ email: "u@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(prismaMock.passwordReset.create).toHaveBeenCalled();
    expect(sendMailMock).toHaveBeenCalled();
  });

  it("POST /auth/reset 400 si la contraseña no cumple política fuerte", async () => {
    const res = await request(app())
      .post("/auth/reset")
      .send({ token: "12345678901234567890123456789012", password: "solominus1" });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/mayúscula|contraseña/i);
  });

  it("POST /auth/reset 400 si el token es inválido", async () => {
    prismaMock.passwordReset.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .post("/auth/reset")
      .send({ token: "1234567890", password: "Abcd1234!" });
    expect(res.status).toBe(400);
  });

  it("POST /auth/reset 400 si el token ya fue usado", async () => {
    prismaMock.passwordReset.findUnique.mockResolvedValue({
      token: "1234567890",
      userId: "u1",
      usedAt: new Date("2025-01-01T00:00:00.000Z"),
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
    });
    const res = await request(app())
      .post("/auth/reset")
      .send({ token: "1234567890", password: "Abcd1234!" });
    expect(res.status).toBe(400);
  });

  it("POST /auth/reset flujo feliz usa transacción y abre sesión como login", async () => {
    prismaMock.passwordReset.findUnique.mockResolvedValue({
      token: "1234567890",
      userId: "u1",
      usedAt: null,
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "u@example.com",
      name: "User",
      isActive: true,
      orgRole: { code: "STAFF" },
    });
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.passwordReset.update.mockResolvedValue({});
    prismaMock.refreshToken.create.mockResolvedValue({});
    const res = await request(app())
      .post("/auth/reset")
      .send({ token: "1234567890", password: "Abcd1234!" });
    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(res.body).toMatchObject({ id: "u1", email: "u@example.com", name: "User", role: "STAFF" });
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("POST /auth/reset 403 si la cuenta está desactivada", async () => {
    prismaMock.passwordReset.findUnique.mockResolvedValue({
      token: "1234567890",
      userId: "u1",
      usedAt: null,
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "u@example.com",
      name: "User",
      isActive: false,
      orgRole: { code: "STAFF" },
    });
    const res = await request(app())
      .post("/auth/reset")
      .send({ token: "1234567890", password: "Abcd1234!" });
    expect(res.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("GET /auth/me devuelve perfil seguro con flags calculados", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "User One",
      orgRole: { code: "STAFF" },
      emailVerifiedAt: null,
      username: null,
      nationalId: null,
      firstName: "User",
      lastName: null,
      phone: null,
      birthdate: null,
      passwordHash: "$argon2id$existing",
      isApproved: false,
      approvedAt: null,
      isActive: true,
    });
    const res = await request(app()).get("/auth/me").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.needsProfileCompletion).toBe(true);
    expect(res.body.hasPassword).toBe(true);
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.navLinks).toEqual([]);
  });

  it("GET /auth/me devuelve navLinks vacío cuando el perfil está completo (navegación por inicio)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "User One",
      orgRole: { code: "STAFF" },
      emailVerifiedAt: new Date(),
      username: "userone",
      nationalId: "30458651",
      firstName: "User",
      lastName: "One",
      phone: "59899123456",
      birthdate: new Date("2000-05-20T00:00:00.000Z"),
      passwordHash: "$argon2id$existing",
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
    });
    const res = await request(app()).get("/auth/me").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.needsProfileCompletion).toBe(false);
    expect(res.body.navLinks).toEqual([]);
  });

  it("GET /auth/me 401 si el usuario autenticado ya no existe", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app()).get("/auth/me").set(authHeader());
    expect(res.status).toBe(401);
  });

  it("POST /auth/logout revoca refresh token si existe", async () => {
    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    const res = await request(app())
      .post("/auth/logout")
      .set("Cookie", "refresh_token=raw-refresh-token");
    expect(res.status).toBe(200);
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalled();
  });

  it("POST /auth/refresh 401 sin cookie", async () => {
    const res = await request(app()).post("/auth/refresh");
    expect(res.status).toBe(401);
  });

  it("POST /auth/refresh 401 con refresh inválido", async () => {
    prismaMock.refreshToken.findFirst.mockResolvedValue(null);
    const res = await request(app())
      .post("/auth/refresh")
      .set("Cookie", "refresh_token=raw-refresh-token");
    expect(res.status).toBe(401);
  });

  it("POST /auth/refresh 403 si el usuario está desactivado", async () => {
    prismaMock.refreshToken.findFirst.mockResolvedValue({ id: "rt1", userId: "u1" });
    prismaMock.refreshToken.update.mockResolvedValue({});
    prismaMock.refreshToken.create.mockResolvedValue({});
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1", isActive: false });
    const res = await request(app())
      .post("/auth/refresh")
      .set("Cookie", "refresh_token=raw-refresh-token");
    expect(res.status).toBe(403);
  });

  it("POST /auth/refresh 401 si el usuario del refresh no existe", async () => {
    prismaMock.refreshToken.findFirst.mockResolvedValue({ id: "rt1", userId: "u1" });
    prismaMock.refreshToken.update.mockResolvedValue({});
    prismaMock.refreshToken.create.mockResolvedValue({});
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .post("/auth/refresh")
      .set("Cookie", "refresh_token=raw-refresh-token");
    expect(res.status).toBe(401);
  });

  it("POST /auth/refresh rota tokens y responde ok", async () => {
    prismaMock.refreshToken.findFirst.mockResolvedValue({ id: "rt1", userId: "u1" });
    prismaMock.refreshToken.update.mockResolvedValue({});
    prismaMock.refreshToken.create.mockResolvedValue({});
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "u@example.com",
      isActive: true,
      orgRole: { code: "STAFF" },
    });
    const res = await request(app())
      .post("/auth/refresh")
      .set("Cookie", "refresh_token=raw-refresh-token");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("GET /auth/google/failure devuelve 401", async () => {
    const res = await request(app()).get("/auth/google/failure");
    expect(res.status).toBe(401);
  });
});
