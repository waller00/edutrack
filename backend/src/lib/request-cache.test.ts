import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { memoizeInRequest, requestCacheMiddleware } from "./request-cache.js";

describe("memoizeInRequest", () => {
  it("dentro de un pedido resuelve una vez, aunque haya awaits en el medio", async () => {
    const load = vi.fn(async () => ({ value: Math.random() }));
    const app = express();
    app.use(express.json());
    app.use(requestCacheMiddleware);
    app.post("/", async (_req, res) => {
      const first = await memoizeInRequest("k", load);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await memoizeInRequest("k", load);
      res.json({ same: first === second });
    });

    const res = await request(app).post("/").send({ a: 1 });
    expect(res.body).toEqual({ same: true });
    expect(load).toHaveBeenCalledTimes(1);

    // Cada pedido tiene su propia memoria.
    await request(app).post("/").send({});
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("fuera de un pedido no memoriza", async () => {
    const load = vi.fn(async () => 1);
    await memoizeInRequest("k", load);
    await memoizeInRequest("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("un fallo no queda guardado", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("caída")).mockResolvedValueOnce("ok");
    const result = await new Promise((resolve) => {
      requestCacheMiddleware({} as never, {} as never, async () => {
        await expect(memoizeInRequest("k", load)).rejects.toThrow("caída");
        resolve(await memoizeInRequest("k", load));
      });
    });
    expect(result).toBe("ok");
  });
});
