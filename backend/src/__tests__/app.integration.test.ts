import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app.js";

describe("App HTTP (integración ligera)", () => {
  it("GET /health responde ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("GET /auth/login inicia flujo OIDC (redirect o error si falta Redis)", async () => {
    const res = await request(app).get("/auth/login");
    expect([302, 303, 503]).toContain(res.status);
  });

  it("GET /auth/account/security sin sesión redirige al login de la app", async () => {
    const res = await request(app).get("/auth/account/security");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/login");
  });

  it("GET /auth/account/2fa sin sesión redirige al login de la app", async () => {
    const res = await request(app).get("/auth/account/2fa");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/login");
  });
});
