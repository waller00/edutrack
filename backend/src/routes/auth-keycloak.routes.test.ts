import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { redisMock, buildLoginUrlMock, getSessionMock, prismaMock, sendMailMock } = vi.hoisted(() => ({
  redisMock: {
    set: vi.fn().mockResolvedValue("OK"),
    eval: vi.fn(),
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
  SsoRegistrationRequiredError: class SsoRegistrationRequiredError extends Error {
    constructor(public profile: unknown) { super("SSO_REGISTRATION_REQUIRED"); }
  },
  provisionUserFromClaims: vi.fn(),
}));

vi.mock("../auth/sso-registration.js", () => ({
  createSsoRegistration: vi.fn(),
}));

import keycloakAuthRoutes from "./auth-keycloak.js";
import { exchangeCode } from "../auth/keycloak.js";
import { provisionUserFromClaims, SsoRegistrationRequiredError } from "../auth/keycloak-provisioning.js";
import { saveSession } from "../auth/session-store.js";
import { createSsoRegistration } from "../auth/sso-registration.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(express.urlencoded({ extended: true }));
  a.use(cookieParser());
  a.use("/auth", keycloakAuthRoutes);
  return a;
}

describe("OIDC browser binding (AUD-01)", () => {
  const transactions = new Map<string, string>();
  const cookies = (res: any): string[] => res.headers["set-cookie"] || [];
  const transactionCookie = (res: any) => cookies(res).find((value) => value.startsWith("oidc-"))!.split(";")[0];
  let counter = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("FRONTEND_URL", "http://localhost:3000");
    vi.stubEnv("COOKIE_SECURE", "false");
    transactions.clear();
    counter = 0;
    buildLoginUrlMock.mockImplementation(async () => {
      const state = `state-${++counter}`;
      return { codeVerifier: `verifier-${counter}`, state, authUrl: `https://auth.local/login?state=${state}` };
    });
    redisMock.set.mockImplementation(async (key, value) => {
      transactions.set(key, value);
      return "OK";
    });
    // Models the atomic Lua compare-and-delete; no await between read/delete.
    redisMock.eval.mockImplementation(async (_script, _count, key, binding) => {
      const value = transactions.get(key);
      if (!value || JSON.parse(value).browserBinding !== binding) return null;
      transactions.delete(key);
      return value;
    });
    vi.mocked(exchangeCode).mockResolvedValue({
      accessToken: "access", expiresAt: Date.now() + 60_000,
      claims: { sub: "kc-1", email: "u@example.com" },
    });
    vi.mocked(provisionUserFromClaims).mockResolvedValue({ id: "user-1", email: "u@example.com", role: "STAFF" });
  });

  afterEach(() => { vi.unstubAllEnvs(); });

  it("sets a short-lived host-only HttpOnly cookie, regardless of session domain", async () => {
    vi.stubEnv("COOKIE_SECURE", "true");
    vi.stubEnv("COOKIE_DOMAIN", ".example.com");
    vi.stubEnv("COOKIE_SAMESITE", "strict");
    const res = await request(app()).get("/auth/login");
    const cookie = cookies(res)[0];
    expect(cookie).toMatch(/^__Host-oidc-[a-f0-9]{64}=[a-f0-9]{64};/);
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=600"]) {
      expect(cookie).toContain(attribute);
    }
    expect(cookie).not.toContain("Domain=");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("rejects another browser without consuming the legitimate transaction", async () => {
    const login = await request(app()).get("/auth/login?returnTo=/profile");
    const stolen = await request(app()).get("/auth/callback?code=code&state=state-1");
    expect(stolen.headers.location).toContain("error=state");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(redisMock.eval).not.toHaveBeenCalled();
    expect(saveSession).not.toHaveBeenCalled();
    const legitimate = await request(app()).get("/auth/callback?code=code&state=state-1")
      .set("Cookie", transactionCookie(login));
    expect(legitimate.headers.location).toBe("http://localhost:3000/profile");
    expect(exchangeCode).toHaveBeenCalledWith(expect.any(URL), "verifier-1", "state-1");
    expect(saveSession).toHaveBeenCalledTimes(1);
    expect(cookies(legitimate).some((cookie) => cookie.startsWith("sid="))).toBe(true);
    expect(cookies(legitimate).some((cookie) => cookie.startsWith("oidc-") && cookie.includes("Expires=Thu, 01 Jan 1970"))).toBe(true);
  });

  it("rejects a wrong browser secret without consuming state", async () => {
    const login = await request(app()).get("/auth/login");
    const [name] = transactionCookie(login).split("=");
    const res = await request(app()).get("/auth/callback?code=code&state=state-1")
      .set("Cookie", `${name}=${"a".repeat(64)}`);
    expect(res.headers.location).toContain("error=state");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(transactions.has("bff:oauth:state-1")).toBe(true);
  });

  it("allows independent tabs and rejects a cookie belonging to another flow", async () => {
    const first = await request(app()).get("/auth/login");
    const second = await request(app()).get("/auth/login?provider=google");
    expect(buildLoginUrlMock).toHaveBeenLastCalledWith(expect.objectContaining({ identityProvider: "google" }));
    const wrong = await request(app()).get("/auth/callback?code=code&state=state-2")
      .set("Cookie", transactionCookie(first));
    expect(wrong.headers.location).toContain("error=state");
    for (const state of ["state-2", "state-1"]) {
      const res = await request(app()).get(`/auth/callback?code=code&state=${state}`)
        .set("Cookie", [transactionCookie(first), transactionCookie(second)].join("; "));
      expect(res.headers.location).toBe("http://localhost:3000/");
    }
    expect(saveSession).toHaveBeenCalledTimes(2);
  });

  it("consumes a transaction only once under concurrent and repeated callbacks", async () => {
    const login = await request(app()).get("/auth/login");
    const callback = () => request(app()).get("/auth/callback?code=code&state=state-1")
      .set("Cookie", transactionCookie(login));
    const responses = await Promise.all([callback(), callback()]);
    expect(responses.map((res) => res.headers.location).sort()).toEqual([
      "http://localhost:3000/", "http://localhost:3000/login?error=state",
    ]);
    expect((await callback()).headers.location).toContain("error=state");
    expect(exchangeCode).toHaveBeenCalledTimes(1);
    expect(saveSession).toHaveBeenCalledTimes(1);
  });

  it.each(["expired", "legacy"])("rejects %s transactions", async (kind) => {
    const login = await request(app()).get("/auth/login");
    if (kind === "expired") transactions.clear();
    else transactions.set("bff:oauth:state-1", JSON.stringify({ codeVerifier: "old", returnTo: "/" }));
    const res = await request(app()).get("/auth/callback?code=code&state=state-1")
      .set("Cookie", transactionCookie(login));
    expect(res.headers.location).toContain("error=state");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it.each(["", "a".repeat(257)])("rejects invalid state before reading Redis", async (state) => {
    const res = await request(app()).get(`/auth/callback?code=code&state=${state}`);
    expect(res.headers.location).toContain("error=state");
    expect(redisMock.eval).not.toHaveBeenCalled();
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("does not exchange tokens when Redis fails", async () => {
    const login = await request(app()).get("/auth/login");
    redisMock.eval.mockRejectedValueOnce(new Error("Redis unavailable"));
    const res = await request(app()).get("/auth/callback?code=code&state=state-1")
      .set("Cookie", transactionCookie(login));
    expect(res.headers.location).toContain("error=oidc");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("clears the cookie and consumes state even when the IdP rejects the code", async () => {
    const login = await request(app()).get("/auth/login");
    vi.mocked(exchangeCode).mockRejectedValueOnce(new Error("invalid_grant"));
    const res = await request(app()).get("/auth/callback?code=bad&state=state-1")
      .set("Cookie", transactionCookie(login));
    expect(res.headers.location).toContain("error=oidc");
    expect(transactions.size).toBe(0);
    expect(saveSession).not.toHaveBeenCalled();
    expect(cookies(res)[0]).toContain("Expires=Thu, 01 Jan 1970");
  });

  it("preserves Google registration after validating the browser", async () => {
    const login = await request(app()).get("/auth/login?provider=google");
    const error = new SsoRegistrationRequiredError({ kcId: "new", email: "new@example.com" });
    vi.mocked(provisionUserFromClaims).mockRejectedValueOnce(error);
    vi.mocked(createSsoRegistration).mockResolvedValueOnce("registration-token");
    const res = await request(app()).get("/auth/callback?code=code&state=state-1")
      .set("Cookie", transactionCookie(login));
    expect(res.headers.location).toBe("http://localhost:3000/register?sso=registration-token");
    expect(createSsoRegistration).toHaveBeenCalledWith({ kcId: "new", email: "new@example.com" });
    expect(saveSession).not.toHaveBeenCalled();
  });

  it("creates a fresh browser transaction for recovery codes after TOTP setup", async () => {
    const login = await request(app()).get("/auth/login");
    const res = await request(app()).get("/auth/callback?code=code&state=state-1&kc_action=CONFIGURE_TOTP&kc_action_status=success")
      .set("Cookie", transactionCookie(login));
    expect(buildLoginUrlMock).toHaveBeenLastCalledWith(expect.objectContaining({ requiredAction: "CONFIGURE_RECOVERY_AUTHN_CODES" }));
    expect(res.headers.location).toBe("https://auth.local/login?state=state-2");
    expect(transactions.has("bff:oauth:state-1")).toBe(false);
    expect(transactions.has("bff:oauth:state-2")).toBe(true);
    expect(cookies(res).filter((cookie) => cookie.startsWith("oidc-"))).toHaveLength(2);
  });
});

describe("auth-keycloak account routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildLoginUrlMock.mockResolvedValue({ codeVerifier: "verifier-1", state: "state-1", authUrl: "https://auth.local/realms/edutrack/login-actions/authenticate?kc_action=CONFIGURE_TOTP" });
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
