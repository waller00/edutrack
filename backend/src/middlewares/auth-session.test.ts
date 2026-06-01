import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import cookieParser from "cookie-parser";

const { getSessionMock, prismaMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  prismaMock: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("../auth/session-store.js", () => ({
  getSession: getSessionMock,
}));
vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));

import { authGuard } from "./auth.js";

function app() {
  const a = express();
  a.use(cookieParser());
  a.get("/protegido", authGuard, (req, res) => {
    const u = (req as express.Request & { user?: { sub: string } }).user;
    res.json({ sub: u?.sub });
  });
  return a;
}

const SESSION = {
  sid: "sid-1",
  userId: "user-1",
  kcId: "kc-1",
  email: "u@e.com",
  role: "TEACHER",
  accessToken: "at",
  accessTokenExpiresAt: Date.now() + 60_000,
  createdAt: Date.now(),
};

describe("authGuard (sesión BFF + estado de cuenta)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue(SESSION);
  });

  it("200 con sesión válida y cuenta activa/aprobada", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isActive: true, isApproved: true, lockUntil: null });
    const res = await request(app()).get("/protegido").set("Cookie", "sid=sid-1");
    expect(res.status).toBe(200);
    expect(res.body.sub).toBe("user-1");
  });

  it("401 si la sesión ya no existe en Redis", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await request(app()).get("/protegido").set("Cookie", "sid=sid-1");
    expect(res.status).toBe(401);
  });

  it("401 si el usuario fue borrado", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app()).get("/protegido").set("Cookie", "sid=sid-1");
    expect(res.status).toBe(401);
  });

  it("403 si la cuenta fue desactivada después de iniciar sesión", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isActive: false, isApproved: true, lockUntil: null });
    const res = await request(app()).get("/protegido").set("Cookie", "sid=sid-1");
    expect(res.status).toBe(403);
  });

  it("403 si la cuenta quedó pendiente de aprobación", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isActive: true, isApproved: false, lockUntil: null });
    const res = await request(app()).get("/protegido").set("Cookie", "sid=sid-1");
    expect(res.status).toBe(403);
  });

  it("403 si la cuenta está bloqueada (lockUntil futuro)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isActive: true,
      isApproved: true,
      lockUntil: new Date(Date.now() + 10 * 60 * 1000),
    });
    const res = await request(app()).get("/protegido").set("Cookie", "sid=sid-1");
    expect(res.status).toBe(403);
  });

  it("200 si el bloqueo ya expiró (lockUntil pasado)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isActive: true,
      isApproved: true,
      lockUntil: new Date(Date.now() - 1000),
    });
    const res = await request(app()).get("/protegido").set("Cookie", "sid=sid-1");
    expect(res.status).toBe(200);
  });
});
