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

  it("registra metricas HTTP con rutas normalizadas", async () => {
    const { metricsRegistry } = await import("../observability/metrics.js");

    await request(app).get("/health");
    await request(app).get("/ruta-inexistente/123456");

    const metrics = await metricsRegistry.metrics();
    expect(metrics).toContain(
      'edutrack_backend_http_requests_total{method="GET",route="/health",status_code="200"}',
    );
    expect(metrics).toContain(
      'edutrack_backend_http_requests_total{method="GET",route="/unmatched",status_code="404"}',
    );
    expect(metrics).toContain("edutrack_backend_http_request_duration_seconds_bucket");
  });

  it("GET /auth/login inicia flujo OIDC (redirect o error si falta Redis)", async () => {
    const res = await request(app).get("/auth/login");
    expect([302, 303, 503]).toContain(res.status);
  });

  it("OPTIONS /auth/register permite el origen público del frontend", async () => {
    process.env.FRONTEND_URL = "https://api.edutrack-uy.com";
    process.env.CORS_ORIGINS = "https://edutrack-uy.com,https://www.edutrack-uy.com";

    const res = await request(app)
      .options("/auth/register")
      .set("Origin", "https://edutrack-uy.com")
      .set("Access-Control-Request-Method", "POST");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://edutrack-uy.com");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("OPTIONS /auth/register permite edutrack-uy.com en producción aunque CORS_ORIGINS esté viejo", async () => {
    process.env.NODE_ENV = "production";
    process.env.FRONTEND_URL = "http://localhost:3000";
    process.env.CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000";

    const res = await request(app)
      .options("/auth/register")
      .set("Origin", "https://edutrack-uy.com")
      .set("Access-Control-Request-Method", "POST");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://edutrack-uy.com");
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
