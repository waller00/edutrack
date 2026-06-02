import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../app.js";

describe("App HTTP (integración ligera)", () => {
  // `frontendUrl()` se lee en runtime; fijamos el valor esperado para no depender
  // de otros archivos de test que muten FRONTEND_URL (vitest corre en un fork).
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.FRONTEND_URL = "http://localhost:3000";
    delete process.env.CORS_ORIGINS;
  });

  it("GET /health responde ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("GET /metrics expone metricas Prometheus", async () => {
    await request(app).get("/health");

    const res = await request(app).get("/metrics");

    expect(res.status).toBe(200);
    expect(res.text).toContain("# HELP edutrack_http_requests_total");
    expect(res.text).toContain("edutrack_http_request_duration_seconds_bucket");
    expect(res.text).toContain("edutrack_process_uptime_seconds");
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
