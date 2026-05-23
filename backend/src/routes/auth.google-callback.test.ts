import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";

const { prismaMock, passportState } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      update: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
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
  },
  passportState: {
    user: null as any,
    fail: false,
  },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../notifications/email.js", () => ({ sendMail: vi.fn() }));
vi.mock("@prisma/client", () => ({
  AuditAction: {
    AUTH_GOOGLE_LOGIN_SUCCESS: "AUTH_GOOGLE_LOGIN_SUCCESS",
    AUTH_LOGOUT: "AUTH_LOGOUT",
    AUTH_LOGIN_SUCCESS: "AUTH_LOGIN_SUCCESS",
    AUTH_LOGIN_FAILURE: "AUTH_LOGIN_FAILURE",
  },
}));
vi.mock("argon2", () => ({
  default: {
    hash: vi.fn(),
    verify: vi.fn(),
    argon2id: "argon2id",
  },
}));
vi.mock("../auth/passportGoogle.js", () => ({
  default: {
    authenticate: vi.fn((_strategy: string, options: any) => {
      if (options?.scope) {
        return (_req: any, res: any) => res.status(302).end();
      }

      return (req: any, res: any, next: any) => {
        if (passportState.fail) {
          return res.redirect(options?.failureRedirect || "/auth/google/failure");
        }
        req.user = passportState.user;
        next();
      };
    }),
  },
}));

import authRoutes from "./auth.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use("/auth", authRoutes);
  return a;
}

describe("auth google callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    passportState.user = null;
    passportState.fail = false;
    process.env.FRONTEND_URL = "http://frontend.local";
    process.env.ACCESS_TOKEN_TTL = "2h";
    process.env.REFRESH_TOKEN_TTL = "7d";
  });

  it("redirige a login con error si la cuenta está inactiva", async () => {
    passportState.user = {
      id: "u1",
      email: "u@example.com",
      role: "STAFF",
      isActive: false,
      emailVerifiedAt: new Date(),
      firstName: "Ada",
      lastName: "Lovelace",
      nationalId: "30458651",
      birthdate: new Date("2000-05-20T00:00:00.000Z"),
      username: "adal",
    };

    const res = await request(app()).get("/auth/google/callback");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://frontend.local/login?error=inactive");
    expect(res.headers["set-cookie"]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("access_token=;"),
        expect.stringContaining("refresh_token=;"),
      ]),
    );
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
  });

  it("verifica email faltante, crea refresh token y redirige a onboarding si falta completar perfil", async () => {
    passportState.user = {
      id: "u2",
      email: "u2@example.com",
      role: "STAFF",
      isActive: true,
      emailVerifiedAt: null,
      firstName: "Ada",
      lastName: null,
      nationalId: null,
      birthdate: null,
      username: null,
    };
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.refreshToken.create.mockResolvedValue({});

    const res = await request(app()).get("/auth/google/callback");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://frontend.local/onboarding");
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u2" },
        data: expect.objectContaining({ emailVerifiedAt: expect.any(Date) }),
      }),
    );
    expect(prismaMock.refreshToken.create).toHaveBeenCalled();
    expect(res.headers["set-cookie"]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("access_token="),
        expect.stringContaining("refresh_token="),
      ]),
    );
  });

  it("redirige al home si el perfil ya está completo", async () => {
    passportState.user = {
      id: "u3",
      email: "u3@example.com",
      role: "ADMIN",
      isActive: true,
      emailVerifiedAt: new Date(),
      firstName: "Ada",
      lastName: "Lovelace",
      nationalId: "30458651",
      birthdate: new Date("2000-05-20T00:00:00.000Z"),
      username: "adal",
    };
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u3",
      email: "u3@example.com",
      isActive: true,
      emailVerifiedAt: new Date(),
      firstName: "Ada",
      lastName: "Lovelace",
      nationalId: "30458651",
      birthdate: new Date("2000-05-20T00:00:00.000Z"),
      username: "adal",
      orgRole: { code: "ADMIN" },
    });
    prismaMock.refreshToken.create.mockResolvedValue({});

    const res = await request(app()).get("/auth/google/callback");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://frontend.local/");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.refreshToken.create).toHaveBeenCalled();
  });
});
