import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import cookieParser from "cookie-parser";
import { authGuard, requireRole, requireAnyRole } from "./auth.js";
import { signAccessToken } from "../auth/jwt.js";

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.get("/bearer", authGuard, (req, res) => {
    const u = (req as express.Request & { user?: { sub: string } }).user;
    res.json({ sub: u?.sub });
  });
  app.get("/admin", authGuard, requireRole("ADMIN"), (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/staff-or-teacher", authGuard, requireAnyRole(["STAFF", "TEACHER"]), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("authGuard + requireRole + requireAnyRole", () => {
  let app: express.Express;

  beforeAll(() => {
    app = makeApp();
  });

  it("401 sin token", async () => {
    const res = await request(app).get("/bearer");
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/autorizado|No autorizado|Token/i);
  });

  it("401 token basura", async () => {
    const res = await request(app).get("/bearer").set("Authorization", "Bearer xxx");
    expect(res.status).toBe(401);
  });

  it("200 con Bearer válido", async () => {
    const token = signAccessToken({
      sub: "u1",
      email: "e@e.com",
      role: "TEACHER",
    });
    const res = await request(app).get("/bearer").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.sub).toBe("u1");
  });

  it("200 con cookie access_token", async () => {
    const token = signAccessToken({
      sub: "u2",
      email: "e2@e.com",
      role: "STAFF",
    });
    const res = await request(app).get("/bearer").set("Cookie", `access_token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.sub).toBe("u2");
  });

  it("403 rol incorrecto en requireRole", async () => {
    const token = signAccessToken({
      sub: "u3",
      email: "e@e.com",
      role: "TEACHER",
    });
    const res = await request(app).get("/admin").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("200 ADMIN en ruta admin", async () => {
    const token = signAccessToken({
      sub: "adm",
      email: "a@a.com",
      role: "ADMIN",
    });
    const res = await request(app).get("/admin").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("requireAnyRole acepta STAFF", async () => {
    const token = signAccessToken({
      sub: "s",
      email: "s@s.com",
      role: "STAFF",
    });
    const res = await request(app).get("/staff-or-teacher").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("requireAnyRole rechaza ADMIN", async () => {
    const token = signAccessToken({
      sub: "a",
      email: "a@a.com",
      role: "ADMIN",
    });
    const res = await request(app).get("/staff-or-teacher").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
