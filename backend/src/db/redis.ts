import Redis from "ioredis";

/**
 * Cliente Redis compartido.
 *
 * Si REDIS_URL no esta definido, exporta `null` y los consumidores deben degradar
 * con elegancia (sin romper en local/CI donde no hay Redis).
 */
let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) return null;

  client = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
  });

  client.on("error", (err) => {
    // Evitar spamear: Redis es complementario; no debe tumbar el proceso.
    console.error("[redis] error:", err?.message ?? err);
  });

  return client;
}

export const isRedisEnabled = (): boolean => Boolean(process.env.REDIS_URL);
