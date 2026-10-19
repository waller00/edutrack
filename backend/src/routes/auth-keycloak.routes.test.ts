import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { redisMock, buildLoginUrlMock, getSessionMock, prismaMock, sendMailMock } = vi.hoisted(() => ({
  redisMock: {
    set: vi.fn().mockResolvedValue("OK"),
    get: vi.fn(),
    del: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(300),
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

const {
  getKeycloakUserIdByEmailMock,
  verifyKeycloakUserOtpCodeMock,
  deleteKeycloakUserOtpCredentialsMock,
  exchangeCodeMock,
  provisionUserFromClaimsMock,
  keycloakUserHasPasswordMock,
  setInitialKeycloakPasswordMock,
  recordAuditEventMock,
} = vi.hoisted(() => ({
  getKeycloakUserIdByEmailMock: vi.fn().mockResolvedValue("kc-1"),
  verifyKeycloakUserOtpCodeMock: vi.fn().mockResolvedValue(true),
  deleteKeycloakUserOtpCredentialsMock: vi.fn().mockResolvedValue(1),
  exchangeCodeMock: vi.fn(),
  provisionUserFromClaimsMock: vi.fn(),
  keycloakUserHasPasswordMock: vi.fn().mockResolvedValue(false),
  setInitialKeycloakPasswordMock: vi.fn().mockResolvedValue(undefined),
  recordAuditEventMock: vi.fn(),
}));

const { requestPasswordResetMock, completePasswordResetMock, MockPasswordResetTokenError } = vi.hoisted(() => {
  class MockPasswordResetTokenError extends Error {
    readonly code = "RESET_TOKEN_INVALID";
    constructor() {
      super("El enlace para restablecer la contraseña venció o ya se usó.");
    }
  }
  return {
    requestPasswordResetMock: vi.fn().mockResolvedValue(true),
    completePasswordResetMock: vi.fn().mockResolvedValue("user-1"),
    MockPasswordResetTokenError,
  };
});

vi.mock("../auth/password-reset.js", () => ({
  requestPasswordReset: requestPasswordResetMock,
  completePasswordReset: completePasswordResetMock,
  PasswordResetTokenError: MockPasswordResetTokenError,
}));

vi.mock("../services/audit-log.js", () => ({
  recordAuditEvent: recordAuditEventMock,
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
  exchangeCode: exchangeCodeMock,
  getKeycloakUserIdByEmail: getKeycloakUserIdByEmailMock,
  getKeycloakUserOtpStatus: vi.fn().mockResolvedValue({ enabled: true, count: 1 }),
  redirectUri: vi.fn(() => "http://localhost:4000/auth/callback"),
  refreshTokens: vi.fn(),
  verifyKeycloakUserOtpCode: verifyKeycloakUserOtpCodeMock,
  keycloakUserHasPassword: keycloakUserHasPasswordMock,
  setInitialKeycloakPassword: setInitialKeycloakPasswordMock,
}));

vi.mock("../auth/keycloak-provisioning.js", () => ({
  SsoRegistrationRequiredError: class SsoRegistrationRequiredError extends Error {},
  KeycloakAccountConflictError: class KeycloakAccountConflictError extends Error {},
  provisionUserFromClaims: provisionUserFromClaimsMock,
}));

vi.mock("../auth/sso-registration.js", () => ({
  createSsoRegistration: vi.fn(),
}));

import keycloakAuthRoutes from "./auth-keycloak.js";
import { KeycloakAccountConflictError } from "../auth/keycloak-provisioning.js";

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
    redisMock.incr.mockResolvedValue(1);
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

describe("auth-keycloak crear contraseña (cuenta de Google)", () => {
  const session = (createdAt: number) => ({
    sid: "sid-1",
    userId: "user-1",
    kcId: "kc-1",
    email: "u@example.com",
    role: "TEACHER",
    accessToken: "access-1",
    accessTokenExpiresAt: Date.now() + 60_000,
    createdAt,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FRONTEND_URL = "http://localhost:3000";
    redisMock.set.mockResolvedValue("OK");
    redisMock.incr.mockResolvedValue(1);
    getSessionMock.mockResolvedValue(session(Date.now()));
    keycloakUserHasPasswordMock.mockResolvedValue(false);
    setInitialKeycloakPasswordMock.mockResolvedValue(undefined);
  });

  const post = (password: unknown) =>
    request(app()).post("/auth/account/password").set("Cookie", "sid=sid-1").send({ password });

  it("GET /auth/account/password-status dice si la cuenta tiene contraseña", async () => {
    const res = await request(app()).get("/auth/account/password-status").set("Cookie", "sid=sid-1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasPassword: false });
    expect(keycloakUserHasPasswordMock).toHaveBeenCalledWith("kc-1");
  });

  it("crea la primera contraseña con un ingreso reciente y lo audita", async () => {
    const res = await post("Segura123!");

    expect(res.status).toBe(200);
    expect(setInitialKeycloakPasswordMock).toHaveBeenCalledWith("kc-1", "Segura123!");
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "AUTH_PASSWORD_CREATED", actorUserId: "user-1", entityId: "user-1" }),
    );
  });

  it("rechaza una contraseña débil sin tocar Keycloak", async () => {
    const res = await post("corta");

    expect(res.status).toBe(400);
    expect(setInitialKeycloakPasswordMock).not.toHaveBeenCalled();
  });

  it("con una sesión de hace más de 10 minutos pide volver a ingresar", async () => {
    getSessionMock.mockResolvedValue(session(Date.now() - 11 * 60 * 1000));

    const res = await post("Segura123!");

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("REAUTH_REQUIRED");
    expect(setInitialKeycloakPasswordMock).not.toHaveBeenCalled();
  });

  it("si la cuenta ya tiene contraseña no la pisa: eso es «Cambiar contraseña»", async () => {
    keycloakUserHasPasswordMock.mockResolvedValue(true);

    const res = await post("Segura123!");

    expect(res.status).toBe(409);
    expect(setInitialKeycloakPasswordMock).not.toHaveBeenCalled();
  });

  it("devuelve 400 si la política de Keycloak rechaza la contraseña", async () => {
    setInitialKeycloakPasswordMock.mockRejectedValue(Object.assign(new Error("Keycloak reset password error 400"), { status: 400 }));

    const res = await post("Segura123!");

    expect(res.status).toBe(400);
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it("GET /auth/account/reauth pide el ingreso de nuevo y vuelve al perfil con el formulario", async () => {
    const res = await request(app()).get("/auth/account/reauth").set("Cookie", "sid=sid-1");

    expect(res.status).toBe(302);
    expect(buildLoginUrlMock).toHaveBeenCalledWith(expect.objectContaining({ prompt: "login" }));
    expect(redisMock.set).toHaveBeenCalledWith(
      "bff:oauth:state-1",
      expect.stringContaining('"returnTo":"/profile?crear-contrasena=1"'),
      "EX",
      600,
    );
  });
});

describe("auth-keycloak login OIDC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FRONTEND_URL = "http://localhost:3000";
    redisMock.set.mockResolvedValue("OK");
    redisMock.get.mockResolvedValue(JSON.stringify({ codeVerifier: "verifier-1", returnTo: "/libreta" }));
    exchangeCodeMock.mockResolvedValue({
      accessToken: "access-1",
      expiresAt: Date.now() + 60_000,
      claims: { sub: "kc-1", email: "u@example.com" },
    });
    provisionUserFromClaimsMock.mockResolvedValue({ id: "user-1", email: "u@example.com", role: "STAFF" });
  });

  const setCookies = (res: request.Response) => ([] as string[]).concat(res.headers["set-cookie"] ?? []);

  it("GET /auth/login ata el state al navegador con una cookie", async () => {
    const res = await request(app()).get("/auth/login?returnTo=/libreta");

    expect(res.status).toBe(302);
    const cookie = setCookies(res).find((c) => c.startsWith("oauth_state="));
    expect(cookie).toContain("oauth_state=state-1");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/auth");
  });

  it("GET /auth/callback rechaza un state que no inició este navegador", async () => {
    const sinCookie = await request(app()).get("/auth/callback?state=state-1&code=abc");
    const otraCookie = await request(app())
      .get("/auth/callback?state=state-1&code=abc")
      .set("Cookie", "oauth_state=state-del-atacante");

    for (const res of [sinCookie, otraCookie]) {
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("http://localhost:3000/login?error=state");
    }
    expect(redisMock.get).not.toHaveBeenCalled();
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });

  it("GET /auth/callback con el state de este navegador abre la sesión y borra la cookie", async () => {
    const res = await request(app())
      .get("/auth/callback?state=state-1&code=abc")
      .set("Cookie", "oauth_state=state-1");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/libreta");
    expect(exchangeCodeMock).toHaveBeenCalled();
    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith("sid=sid-new"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("oauth_state=;"))).toBe(true);
  });

  it("GET /auth/callback manda a revisión una cuenta de Keycloak sin vínculo válido", async () => {
    provisionUserFromClaimsMock.mockRejectedValueOnce(new KeycloakAccountConflictError());

    const res = await request(app())
      .get("/auth/callback?state=state-1&code=abc")
      .set("Cookie", "oauth_state=state-1");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/login?error=account_link");
  });
});

describe("auth-keycloak 2FA por correo (público)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FRONTEND_URL = "http://localhost:3000";
    process.env.TWO_FACTOR_DISABLE_EMAIL_SECRET = "test-2fa-disable-secret";
    delete process.env.PUBLIC_API_URL;
    delete process.env.API_PUBLIC_URL;
    redisMock.set.mockResolvedValue("OK");
    redisMock.incr.mockResolvedValue(1);
    prismaMock.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  const pedir = () =>
    request(app())
      .post("/auth/account/2fa/disable-email-public")
      .set("Host", "atacante.example")
      .type("form")
      .send({ identifier: "u@example.com" });

  it("el enlace del correo usa la URL pública de la API, nunca el Host del pedido", async () => {
    const res = await pedir();

    expect(res.status).toBe(200);
    const mail = sendMailMock.mock.calls.at(-1)![0] as { text: string; html: string };
    expect(mail.text).toContain("http://localhost:4000/auth/account/2fa/disable-email?token=");
    expect(mail.text).not.toContain("atacante.example");
    expect(mail.html).not.toContain("atacante.example");
  });

  it("encuentra la cuenta sin distinguir mayúsculas en usuario ni correo", async () => {
    await request(app())
      .post("/auth/account/2fa/disable-email-public")
      .type("form")
      .send({ identifier: "Lucia.Fernandez" });

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { email: { equals: "Lucia.Fernandez", mode: "insensitive" } },
            { username: { equals: "Lucia.Fernandez", mode: "insensitive" } },
          ],
        },
      }),
    );
  });

  it("manda un solo correo por cuenta dentro de la espera, con la misma respuesta", async () => {
    redisMock.set.mockResolvedValueOnce(null);

    const res = await pedir();

    expect(res.status).toBe(200);
    expect(res.text).toContain("Revisá tu correo");
    expect(redisMock.set).toHaveBeenCalledWith("bff:2fa-disable-mail:user-1", "1", "EX", expect.any(Number), "NX");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("limita los pedidos por IP y contesta HTML", async () => {
    redisMock.incr.mockResolvedValueOnce(6);

    const res = await pedir();

    expect(res.status).toBe(429);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Demasiados intentos");
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe("auth-keycloak recuperar contraseña (correo de EduTrack)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.incr.mockResolvedValue(1);
    requestPasswordResetMock.mockResolvedValue(true);
    completePasswordResetMock.mockResolvedValue("user-1");
  });

  it("POST /auth/forgot-password pide el enlace por EduTrack y responde ok", async () => {
    const res = await request(app()).post("/auth/forgot-password").send({ email: " Ana@Example.com " });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(requestPasswordResetMock).toHaveBeenCalledWith("ana@example.com");
  });

  it("POST /auth/forgot-password no revela si el envío falló", async () => {
    requestPasswordResetMock.mockRejectedValueOnce(new Error("brevo down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app()).post("/auth/forgot-password").send({ email: "ana@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("POST /auth/forgot-password rechaza un correo inválido", async () => {
    const res = await request(app()).post("/auth/forgot-password").send({ email: "no-es-correo" });

    expect(res.status).toBe(400);
    expect(requestPasswordResetMock).not.toHaveBeenCalled();
  });

  it("POST /auth/reset-password cambia la contraseña y lo audita", async () => {
    const res = await request(app()).post("/auth/reset-password").send({ token: "tok-1", password: "Segura123!" });

    expect(res.status).toBe(200);
    expect(completePasswordResetMock).toHaveBeenCalledWith("tok-1", "Segura123!");
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "AUTH_PASSWORD_RESET", actorUserId: "user-1", entityId: "user-1" }),
    );
  });

  it("POST /auth/reset-password rechaza una contraseña débil sin gastar el enlace", async () => {
    const res = await request(app()).post("/auth/reset-password").send({ token: "tok-1", password: "corta" });

    expect(res.status).toBe(400);
    expect(completePasswordResetMock).not.toHaveBeenCalled();
  });

  it("POST /auth/reset-password sin token o con un enlace vencido responde RESET_TOKEN_INVALID", async () => {
    const sinToken = await request(app()).post("/auth/reset-password").send({ password: "Segura123!" });
    completePasswordResetMock.mockRejectedValueOnce(new MockPasswordResetTokenError());
    const vencido = await request(app()).post("/auth/reset-password").send({ token: "viejo", password: "Segura123!" });

    for (const res of [sinToken, vencido]) {
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("RESET_TOKEN_INVALID");
    }
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it("POST /auth/reset-password: 400 si la política de Keycloak la rechaza, 503 si Keycloak falla", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    completePasswordResetMock.mockRejectedValueOnce(Object.assign(new Error("policy"), { status: 400 }));
    const politica = await request(app()).post("/auth/reset-password").send({ token: "tok-1", password: "Segura123!" });
    completePasswordResetMock.mockRejectedValueOnce(new Error("kc down"));
    const caido = await request(app()).post("/auth/reset-password").send({ token: "tok-1", password: "Segura123!" });

    expect(politica.status).toBe(400);
    expect(politica.body.message).toMatch(/Keycloak rechazó/);
    expect(caido.status).toBe(503);
  });
});
