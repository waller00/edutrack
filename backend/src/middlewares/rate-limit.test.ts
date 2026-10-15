import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { redisMock, counters } = vi.hoisted(() => {
  const counters = new Map<string, number>();
  return {
    counters,
    redisMock: {
      incr: vi.fn(async (key: string) => {
        const next = (counters.get(key) ?? 0) + 1;
        counters.set(key, next);
        return next;
      }),
      expire: vi.fn().mockResolvedValue(1),
      ttl: vi.fn().mockResolvedValue(42),
    },
  };
});

let redisAvailable = true;
vi.mock("../db/redis.js", () => ({ getRedis: () => (redisAvailable ? redisMock : null) }));

import { hitRateLimit, rateLimit } from "./rate-limit.js";
import { trustImmediatePrivateProxy } from "../lib/client-ip.js";

const LIMIT = { bucket: "test", max: 2, windowSeconds: 60 } as const;

function app() {
  const a = express();
  a.set("trust proxy", trustImmediatePrivateProxy);
  a.get("/limited", rateLimit(LIMIT), (_req, res) => res.json({ ok: true }));
  return a;
}

describe("rateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    counters.clear();
    redisAvailable = true;
  });

  it("corta con 429 y Retry-After al pasar el máximo", async () => {
    await request(app()).get("/limited").expect(200);
    await request(app()).get("/limited").expect(200);
    const res = await request(app()).get("/limited");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("42");
  });

  it("no se evade cambiando el primer valor de X-Forwarded-For", async () => {
    // El proxy agrega la IP real al final; lo que el cliente pone adelante no cuenta.
    for (const spoofed of ["1.1.1.1", "2.2.2.2"]) {
      await request(app()).get("/limited").set("X-Forwarded-For", `${spoofed}, 190.64.10.20`).expect(200);
    }
    const res = await request(app()).get("/limited").set("X-Forwarded-For", "3.3.3.3, 190.64.10.20");
    expect(res.status).toBe(429);
    expect(redisMock.incr).toHaveBeenCalledWith("bff:rl:test:190.64.10.20");
  });

  it("sin Redis deja pasar", async () => {
    redisAvailable = false;
    for (let i = 0; i < 5; i++) await request(app()).get("/limited").expect(200);
  });
});

describe("hitRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    counters.clear();
    redisAvailable = true;
  });

  it("fija la ventana sólo en el primer pedido", async () => {
    await hitRateLimit(LIMIT, "k");
    await hitRateLimit(LIMIT, "k");
    expect(redisMock.expire).toHaveBeenCalledTimes(1);
    expect(redisMock.expire).toHaveBeenCalledWith("bff:rl:test:k", 60);
  });

  it("ante un fallo de Redis no limita", async () => {
    redisMock.incr.mockRejectedValueOnce(new Error("redis caído"));
    expect(await hitRateLimit(LIMIT, "k")).toEqual({ limited: false });
  });
});
