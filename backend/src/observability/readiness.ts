import { prisma } from "../db/prisma.js";
import { getRedis, isRedisEnabled } from "../db/redis.js";

export type ReadinessResult = {
  ok: boolean;
  dependencies: {
    database: "up" | "down";
    redis: "up" | "down" | "disabled";
  };
};

export async function checkReadiness(): Promise<ReadinessResult> {
  const dependencies: ReadinessResult["dependencies"] = {
    database: "down",
    redis: isRedisEnabled() ? "down" : "disabled",
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    dependencies.database = "up";
  } catch {}

  if (isRedisEnabled()) {
    try {
      const redis = getRedis();
      dependencies.redis = redis && (await redis.ping()) === "PONG" ? "up" : "down";
    } catch {}
  }

  return {
    ok: dependencies.database === "up" && dependencies.redis !== "down",
    dependencies,
  };
}
