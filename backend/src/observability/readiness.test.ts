import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw, ping, getRedis, isRedisEnabled } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  ping: vi.fn(),
  getRedis: vi.fn(),
  isRedisEnabled: vi.fn(),
}));

vi.mock("../db/prisma.js", () => ({
  prisma: { $queryRaw: queryRaw },
}));

vi.mock("../db/redis.js", () => ({
  getRedis,
  isRedisEnabled,
}));

describe("checkReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    ping.mockResolvedValue("PONG");
    getRedis.mockReturnValue({ ping });
    isRedisEnabled.mockReturnValue(true);
  });

  it("responde ready cuando PostgreSQL y Redis funcionan", async () => {
    const { checkReadiness } = await import("./readiness.js");
    await expect(checkReadiness()).resolves.toEqual({
      ok: true,
      dependencies: { database: "up", redis: "up" },
    });
  });

  it("responde not ready cuando PostgreSQL falla", async () => {
    queryRaw.mockRejectedValue(new Error("database unavailable"));
    const { checkReadiness } = await import("./readiness.js");
    await expect(checkReadiness()).resolves.toEqual({
      ok: false,
      dependencies: { database: "down", redis: "up" },
    });
  });

  it("permite Redis deshabilitado", async () => {
    isRedisEnabled.mockReturnValue(false);
    const { checkReadiness } = await import("./readiness.js");
    await expect(checkReadiness()).resolves.toEqual({
      ok: true,
      dependencies: { database: "up", redis: "disabled" },
    });
  });
});
