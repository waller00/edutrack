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
    },
  },
  sendMailMock: vi.fn().mockResolvedValue(undefined),
}));

const { getKeycloakUserLoginNameMock, verifyKeycloakPasswordMock, deleteKeycloakUserOtpCredentialsMock } = vi.hoisted(() => ({
  getKeycloakUserLoginNameMock: vi.fn().mockResolvedValue("jorge.marrero"),
  verifyKeycloakPasswordMock: vi.fn().mockResolvedValue(true),
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
  getKeycloakUserLoginName: getKeycloakUserLoginNameMock,
  getKeycloakUserOtpStatus: vi.fn().mockResolvedValue({ enabled: true, count: 1 }),
  redirectUri: vi.fn(() => "http://localhost:4000/auth/callback"),
  refreshTokens: vi.fn(),
  triggerKeycloakPasswordReset: vi.fn(),
  verifyKeycloakPassword: verifyKeycloakPasswordMock,
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

  it("DELETE /auth/account/2fa valida contraseña con username real de Keycloak", async () => {
    const res = await request(app())
      .delete("/auth/account/2fa")
      .set("Cookie", "sid=sid-1")
      .send({ password: "Secret123!" });

    expect(res.status).toBe(200);
    expect(getKeycloakUserLoginNameMock).toHaveBeenCalledWith("kc-1");
    expect(verifyKeycloakPasswordMock).toHaveBeenCalledWith("jorge.marrero", "Secret123!");
    expect(deleteKeycloakUserOtpCredentialsMock).toHaveBeenCalledWith("kc-1");
  });

  it("POST /auth/account/2fa/disable inicia reautenticación con binding a la sesión origen", async () => {
    const res = await request(app()).post("/auth/account/2fa/disable").set("Cookie", "sid=sid-1");

    expect(res.status).toBe(302);
    expect(buildLoginUrlMock).toHaveBeenCalledWith(expect.objectContaining({ prompt: "login" }));
    const [, stored] = redisMock.set.mock.calls.find(([key]) => key === "bff:oauth:state-1")!;
    expect(stored).toContain('"postLoginAction":"DISABLE_TOTP"');
    // Bindeado al kcId de la sesión que origina el flujo (anti account-confusion).
    expect(stored).toContain('"originKcId":"kc-1"');
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

    expect(res.status).toBe(500);
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

    expect(ok.status).toBe(302);
    expect(ok.headers.location).toContain("twoFactorDisabled=email");
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
