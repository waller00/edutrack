import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../test-utils/bearer-token.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("@prisma/client", () => ({
  Prisma: { sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }) },
}));

import nonWorkingDaysRoutes from "./non-working-days.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use("/non-working-days", nonWorkingDaysRoutes);
  return a;
}

const adminHdr = () => ({
  Authorization: `Bearer ${signAccessToken({ sub: "adm", email: "a@a.com", role: "ADMIN" })}`,
});

describe("non-working-days routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET lista días (rango por defecto)", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: "d1", date: new Date("2026-06-12T00:00:00.000Z"), type: "HOLIDAY", reason: "Feriado" }]);
    const res = await request(app()).get("/non-working-days").set(adminHdr());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].date).toBe("2026-06-12");
  });

  it("GET respeta from/to de la query", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    const res = await request(app()).get("/non-working-days?from=2026-01-01&to=2026-12-31").set(adminHdr());
    expect(res.status).toBe(200);
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
  });

  it("GET 500 ante error de BD", async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error("db"));
    const res = await request(app()).get("/non-working-days").set(adminHdr());
    expect(res.status).toBe(500);
  });

  it("POST 400 body inválido", async () => {
    const res = await request(app()).post("/non-working-days").set(adminHdr()).send({ date: "no-fecha", reason: "x" });
    expect(res.status).toBe(400);
  });

  it("POST 201 crea/actualiza", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: "nwd-1" }]);
    const res = await request(app())
      .post("/non-working-days")
      .set(adminHdr())
      .send({ date: "2026-05-01", type: "HOLIDAY", reason: "Día del trabajador", notes: "  feriado  " });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("nwd-1");
  });

  it("POST 500 ante error de BD", async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error("db"));
    const res = await request(app())
      .post("/non-working-days")
      .set(adminHdr())
      .send({ date: "2026-05-01", reason: "x" });
    expect(res.status).toBe(500);
  });

  it("DELETE elimina por id", async () => {
    prismaMock.$executeRaw.mockResolvedValueOnce(1);
    const res = await request(app()).delete("/non-working-days/nwd-1").set(adminHdr());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("DELETE 500 ante error de BD", async () => {
    prismaMock.$executeRaw.mockRejectedValueOnce(new Error("db"));
    const res = await request(app()).delete("/non-working-days/nwd-1").set(adminHdr());
    expect(res.status).toBe(500);
  });
});
