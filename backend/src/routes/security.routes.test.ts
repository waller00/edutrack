import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("../middlewares/rate-limit.js", () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import securityRoutes, { parseCspReports, sanitizeReportUri } from "./security.js";

function app() {
  const a = express();
  a.use("/security", securityRoutes);
  return a;
}

describe("POST /security/csp-report", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registra un reporte report-uri sin la query de las URLs", async () => {
    const res = await request(app())
      .post("/security/csp-report")
      .set("Content-Type", "application/csp-report")
      .send(
        JSON.stringify({
          "csp-report": {
            "document-uri": "https://edutrack-uy.com/libreta/1?alumno=51234561",
            "effective-directive": "script-src-elem",
            "blocked-uri": "https://evil.example/x.js?token=abc",
            disposition: "report",
          },
        }),
      );

    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(String(warn.mock.calls[0][0]));
    expect(logged).toEqual({
      msg: "csp-violation",
      directive: "script-src-elem",
      blocked: "https://evil.example/x.js",
      document: "https://edutrack-uy.com/libreta/1",
      disposition: "report",
    });
    expect(String(warn.mock.calls[0][0])).not.toContain("51234561");
    expect(String(warn.mock.calls[0][0])).not.toContain("token");
  });

  it("acepta el formato de la Reporting API", async () => {
    const res = await request(app())
      .post("/security/csp-report")
      .set("Content-Type", "application/reports+json")
      .send(
        JSON.stringify([
          { type: "csp-violation", body: { documentURL: "https://edutrack-uy.com/", effectiveDirective: "connect-src", blockedURL: "https://x.example/api" } },
          { type: "deprecation", body: {} },
        ]),
      );

    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0][0])).directive).toBe("connect-src");
  });

  it("rechaza cuerpos grandes", async () => {
    const res = await request(app())
      .post("/security/csp-report")
      .set("Content-Type", "application/csp-report")
      .send(JSON.stringify({ "csp-report": { "blocked-uri": "x".repeat(20_000) } }));

    expect(res.status).toBe(413);
  });

  it("ignora lo que no es un reporte", async () => {
    const res = await request(app()).post("/security/csp-report").send({ hola: 1 });
    expect(res.status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("helpers de CSP", () => {
  it("deja igual los valores especiales", () => {
    expect(sanitizeReportUri("inline")).toBe("inline");
    expect(sanitizeReportUri("eval")).toBe("eval");
    expect(sanitizeReportUri(null)).toBeNull();
  });

  it("acota la cantidad de reportes por pedido", () => {
    const many = Array.from({ length: 50 }, () => ({ type: "csp-violation", body: { effectiveDirective: "img-src" } }));
    expect(parseCspReports(many)).toHaveLength(20);
  });
});
