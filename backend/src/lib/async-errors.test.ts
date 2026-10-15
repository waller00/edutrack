import { describe, expect, it, vi } from "vitest";
import express, { Router } from "express";
import request from "supertest";
import "./async-errors.js";
import { jsonErrorHandler } from "./error-handler.js";

function app(router: Router) {
  const a = express();
  a.use(express.json());
  a.use(router);
  a.use(jsonErrorHandler);
  return a;
}

describe("reenvío de errores async (Express 4)", () => {
  it("un handler async que rechaza responde 500 JSON en vez de colgar el pedido", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = Router();
    r.get("/boom", async () => {
      throw new Error("la base se cayó");
    });

    const res = await request(app(r)).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Error interno del servidor" });
    expect(JSON.stringify(res.body)).not.toContain("la base se cayó");
    spy.mockRestore();
  });

  it("también en middlewares de ruta y con varios handlers", async () => {
    const r = Router();
    const guard = async (_req: unknown, _res: unknown, next: () => void) => next();
    r.post("/ok", guard, async (_req, res) => {
      res.json({ ok: true });
    });

    const res = await request(app(r)).post("/ok").send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("los errores del cliente (JSON mal formado) responden JSON sin el detalle del parser", async () => {
    const r = Router();
    r.post("/json", (_req, res) => res.json({ ok: true }));

    const res = await request(app(r)).post("/json").set("Content-Type", "application/json").send("{mal");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Solicitud inválida" });
  });
});
