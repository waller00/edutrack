import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { originCheck } from "./origin-check.js";

function app() {
  const a = express();
  a.use(originCheck());
  a.all("*", (_req, res) => res.status(200).json({ ok: true }));
  return a;
}

describe("originCheck (CSRF)", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.FRONTEND_URL = "https://edutrack-uy.com";
    delete process.env.CORS_ORIGINS;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it("deja pasar una escritura desde el front (y su variante www)", async () => {
    expect((await request(app()).post("/messages").set("Origin", "https://edutrack-uy.com")).status).toBe(200);
    expect((await request(app()).put("/events/1").set("Origin", "https://www.edutrack-uy.com")).status).toBe(200);
  });

  it("corta una escritura desde otro origen, aunque sea un subdominio (Moodle)", async () => {
    for (const origin of ["https://evil.example", "https://moodle.edutrack-uy.com"]) {
      const res = await request(app()).delete("/admin/students/1").set("Origin", origin);
      expect(res.status, origin).toBe(403);
      expect(res.body.code).toBe("ORIGIN_NOT_ALLOWED");
    }
  });

  it("corta Origin: null (iframes con sandbox, redirecciones cruzadas)", async () => {
    const res = await request(app()).post("/messages").set("Origin", "null");
    expect(res.status).toBe(403);
  });

  it("sin Origin pasa: no es un navegador (lectores, scripts, SSR) y no lleva la cookie de nadie", async () => {
    expect((await request(app()).post("/messages")).status).toBe(200);
  });

  it("no mira las lecturas", async () => {
    expect((await request(app()).get("/admin/students").set("Origin", "https://evil.example")).status).toBe(200);
  });

  it("deja afuera el login, los lectores biométricos y los reportes de CSP", async () => {
    for (const path of ["/auth/login", "/auth/register", "/iclock/cdata", "/biometric/adms-ingest", "/security/csp-report"]) {
      const res = await request(app()).post(path).set("Origin", "https://evil.example");
      expect(res.status, path).toBe(200);
    }
  });

  it("un prefijo parecido no se cuela por la excepción", async () => {
    const res = await request(app()).post("/authority/x").set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
  });

  it("acepta los orígenes extra de CORS_ORIGINS, la misma lista que CORS", async () => {
    process.env.CORS_ORIGINS = "https://testing.example.org";
    expect((await request(app()).patch("/x").set("Origin", "https://testing.example.org/")).status).toBe(200);
  });
});
