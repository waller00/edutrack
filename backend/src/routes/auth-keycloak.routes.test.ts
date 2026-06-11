import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { redisMock, buildLoginUrlMock, getSessionMock, prismaMock, sendMailMock } = vi.hoisted(() => ({
  redisMock: {
    set: vi.fn().mockResolvedValue("OK"),
  },
  buildLoginUrlMock: vi.fn().mockResolvedValue({
    codeVerifier: "verifier-1",
    state: "state-1",
    authUrl: "https://auth.local/realms/edutrack/login-actions/authenticate?kc_action=CONFIGURE_TOTP",
  }),
  getSessionMock: vi.fn().mockResolvedValue({
    sid: "sid-1",
    userId: "user-1",
    kcId: "kc-1",
    email: "u@example.com",
    role: "STAFF",
    accessToken: "access-1",
    accessTokenExpiresAt: Date.now() + 60_000,
    createdAt: Date.now(),
  }),
  prismaMock: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "u@example.com",
        emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      findFirst: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "u@example.com",
        emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    },
  },
  sendMailMock: vi.fn().mockResolvedValue(undefined),
}));

const { getKeycloakUserIdByEmailMock, verifyKeycloakUserOtpCodeMock, deleteKeycloakUserOtpCredentialsMock } = vi.hoisted(() => ({
  getKeycloakUserIdByEmailMock: vi.fn().mockResolvedValue("kc-1"),
  verifyKeycloakUserOtpCodeMock: vi.fn().mockResolvedValue(true),
  deleteKeycloakUserOtpCredentialsMock: vi.fn().mockResolvedValue(1),
}));

vi.mock("../db/redis.js", () => ({
  getRedis: () => redisMock,
}));

vi.mock("../db/prisma.js", () => ({
  prisma: prismaMock,
}));

vi.mock("../notifications/email.js", () => ({
  sendMail: sendMailMock,
}));

vi.mock("../auth/session-store.js", () => ({
  getSession: getSessionMock,
  deleteSession: vi.fn(),
  newSessionId: vi.fn(() => "sid-new"),
  saveSession: vi.fn(),
}));

vi.mock("../auth/keycloak.js", () => ({
  buildLoginUrl: buildLoginUrlMock,
  buildLogoutUrl: vi.fn().mockResolvedValue(null),
  buildAccountConsoleUrl: vi.fn((path = "") => `https://auth.local/account/${path}`),
  deleteKeycloakUserOtpCredentials: deleteKeycloakUserOtpCredentialsMock,
  exchangeCode: vi.fn(),
  getKeycloakUserIdByEmail: getKeycloakUserIdByEmailMock,
  getKeycloakUserOtpStatus: vi.fn().mockResolvedValue({ enabled: true, count: 1 }),
  redirectUri: vi.fn(() => "http://localhost:4000/auth/callback"),
  refreshTokens: vi.fn(),
  triggerKeycloakPasswordReset: vi.fn(),
  verifyKeycloakUserOtpCode: verifyKeycloakUserOtpCodeMock,
}));

vi.mock("../auth/keycloak-provisioning.js", () => ({
  SsoRegistrationRequiredError: class SsoRegistrationRequiredError extends Error {},
  provisionUserFromClaims: vi.fn(),
}));

vi.mock("../auth/sso-registration.js", () => ({
  createSsoRegistration: vi.fn(),
}));

import keycloakAuthRoutes from "./auth-keycloak.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(express.urlencoded({ extended: true }));
  a.use(cookieParser());
  a.use("/auth", keycloakAuthRoutes);
  return a;
}

describe("auth-keycloak account routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FRONTEND_URL = "http://localhost:3000";
    process.env.TWO_FACTOR_DISABLE_EMAIL_SECRET = "test-2fa-disable-secret";
    redisMock.set.mockResolvedValue("OK");
    prismaMock.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  it("GET /auth/account/2fa inicia required action CONFIGURE_TOTP con sesión válida", async () => {
    const res = await request(app()).get("/auth/account/2fa").set("Cookie", "sid=sid-1");

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("CONFIGURE_TOTP");
    expect(buildLoginUrlMock).toHaveBeenCalledWith(expect.objectContaining({ requiredAction: "CONFIGURE_TOTP", prompt: "login" }));
    expect(redisMock.set).toHaveBeenCalledWith(
      "bff:oauth:state-1",
      expect.stringContaining('"returnTo":"/profile"'),
      "EX",
      600,
    );
  });

  it("POST /auth/account/2fa/disable valida el código OTP antes de borrar 2FA", async () => {
    const res = await request(app())
      .post("/auth/account/2fa/disable")
      .set("Cookie", "sid=sid-1")
      .send({ code: "123456" });

    expect(res.status).toBe(200);
    expect(verifyKeycloakUserOtpCodeMock).toHaveBeenCalledWith("kc-1", "123456");
    expect(deleteKeycloakUserOtpCredentialsMock).toHaveBeenCalledWith("kc-1");
  });

  it("POST /auth/account/2fa/disable no borra 2FA con código OTP inválido", async () => {
    verifyKeycloakUserOtpCodeMock.mockResolvedValueOnce(false);
    const res = await request(app())
      .post("/auth/account/2fa/disable")
      .set("Cookie", "sid=sid-1")
      .send({ code: "000000" });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Código de 2FA incorrecto.");
    expect(deleteKeycloakUserOtpCredentialsMock).not.toHaveBeenCalled();
  });

  it("POST /auth/account/2fa/disable-email envía correo de confirmación", async () => {
    const res = await request(app()).post("/auth/account/2fa/disable-email").set("Cookie", "sid=sid-1").send({});

    expect(res.status).toBe(200);
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { id: true, email: true, emailVerifiedAt: true },
    });
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: "u@example.com",
      subject: "Confirmar desactivación de 2FA",
    }));
  });

  it("POST /auth/account/2fa/disable-email falla si no hay secreto configurado", async () => {
    delete process.env.TWO_FACTOR_DISABLE_EMAIL_SECRET;
    delete process.env.JWT_SECRET;
    delete process.env.SESSION_SECRET;
    const res = await request(app()).post("/auth/account/2fa/disable-email").set("Cookie", "sid=sid-1").send({});

    expect(res.status).toBe(502);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("POST /auth/account/2fa/disable-email-public envía correo sin sesión y responde genérico", async () => {
    const res = await request(app())
      .post("/auth/account/2fa/disable-email-public")
      .type("form")
      .send({ identifier: "u@example.com" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("Revisá tu correo");
    expect(getKeycloakUserIdByEmailMock).toHaveBeenCalledWith("u@example.com");
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: "u@example.com",
      subject: "Confirmar desactivación de 2FA",
    }));
  });

  it("POST /auth/account/2fa/disable-email-public no revela cuentas inexistentes", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce(null);
    const res = await request(app())
      .post("/auth/account/2fa/disable-email-public")
      .type("form")
      .send({ identifier: "nadie@example.com" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("Revisá tu correo");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  // Helper: obtiene un token válido del correo que envía el endpoint POST.
  async function issueDisableEmailToken(): Promise<string> {
    await request(app()).post("/auth/account/2fa/disable-email").set("Cookie", "sid=sid-1").send({});
    const mail = sendMailMock.mock.calls.at(-1)![0] as { text: string };
    const match = mail.text.match(/token=([^\s]+)/);
    return decodeURIComponent(match![1]);
  }

  it("GET /auth/account/2fa/disable-email muestra confirmación sin borrar credenciales", async () => {
    const token = await issueDisableEmailToken();
    const res = await request(app()).get(`/auth/account/2fa/disable-email?token=${encodeURIComponent(token)}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("<form method=\"post\"");
    // Un pre-fetch (GET) NO debe disparar la acción destructiva.
    expect(deleteKeycloakUserOtpCredentialsMock).not.toHaveBeenCalled();
  });

  it("GET /auth/account/2fa/disable-email redirige a error si el token es inválido", async () => {
    const res = await request(app()).get("/auth/account/2fa/disable-email?token=basura.invalida");

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("twoFactorDisableError=token");
    expect(deleteKeycloakUserOtpCredentialsMock).not.toHaveBeenCalled();
  });

  it("POST /auth/account/2fa/disable-email/confirm borra 2FA una sola vez", async () => {
    const token = await issueDisableEmailToken();
    const ok = await request(app()).post("/auth/account/2fa/disable-email/confirm").send({ token });

    expect(ok.status).toBe(200);
    expect(ok.text).toContain("2FA desactivado correctamente");
    expect(deleteKeycloakUserOtpCredentialsMock).toHaveBeenCalledWith("kc-1");
    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringContaining("bff:2fa-disable-used:"),
      "1",
      "EX",
      expect.any(Number),
      "NX",
    );

    // Replay: el nonce ya está reservado → la segunda vez no vuelve a borrar.
    deleteKeycloakUserOtpCredentialsMock.mockClear();
    redisMock.set.mockResolvedValueOnce(null);
    const replay = await request(app()).post("/auth/account/2fa/disable-email/confirm").send({ token });

    expect(replay.headers.location).toContain("twoFactorDisableError=token");
    expect(deleteKeycloakUserOtpCredentialsMock).not.toHaveBeenCalled();
  });
});
