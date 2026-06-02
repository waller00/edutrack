import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { redisMock, buildLoginUrlMock, getSessionMock } = vi.hoisted(() => ({
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
}));

vi.mock("../db/redis.js", () => ({
  getRedis: () => redisMock,
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
  exchangeCode: vi.fn(),
  redirectUri: vi.fn(() => "http://localhost:4000/auth/callback"),
  refreshTokens: vi.fn(),
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
  a.use(cookieParser());
  a.use("/auth", keycloakAuthRoutes);
  return a;
}

describe("auth-keycloak account routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FRONTEND_URL = "http://localhost:3000";
  });

  it("GET /auth/account/2fa inicia required action CONFIGURE_TOTP con sesión válida", async () => {
    const res = await request(app()).get("/auth/account/2fa").set("Cookie", "sid=sid-1");

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("CONFIGURE_TOTP");
    expect(buildLoginUrlMock).toHaveBeenCalledWith({ requiredAction: "CONFIGURE_TOTP" });
    expect(redisMock.set).toHaveBeenCalledWith(
      "bff:oauth:state-1",
      expect.stringContaining('"returnTo":"/profile"'),
      "EX",
      600,
    );
  });
});
