import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../test-utils/bearer-token.js";

const { prismaMock, sendMailMock, createKeycloakUserMock } = vi.hoisted(() => ({
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
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../notifications/email.js", () => ({ sendMail: sendMailMock }));
vi.mock("../auth/keycloak.js", () => ({
  createKeycloakUser: createKeycloakUserMock,
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
  ensureDefaultProfilePermissionsIfNeeded: vi.fn().mockResolvedValue(undefined),
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
    expect(createKeycloakUserMock).toHaveBeenCalled();
    expect(res.body.email).toBe("nuevo@example.com");
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
});
