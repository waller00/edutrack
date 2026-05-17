import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app.js";

describe("App HTTP (integración ligera)", () => {
  it("GET /health responde ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("POST /auth/login sin body devuelve error de validación o 400", async () => {
    const res = await request(app).post("/auth/login").send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
