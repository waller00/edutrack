import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../app.js";

describe("App HTTP (integración ligera)", () => {
  // `frontendUrl()` se lee en runtime; fijamos el valor esperado para no depender
  // de otros archivos de test que muten FRONTEND_URL (vitest corre en un fork).
  beforeEach(() => {
    process.env.FRONTEND_URL = "http://localhost:3000";
  });

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
