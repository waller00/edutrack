import { Request, Response, NextFunction } from "express";
import { getRedis } from "../db/redis.js";
import { clientIp } from "../lib/client-ip.js";

type RateLimitOptions = {
  /** Identificador del limite (ej. "login"). */
  bucket: string;
  /** Cantidad maxima de solicitudes dentro de la ventana. */
  max: number;
  /** Ventana en segundos. */
  windowSeconds: number;
};

export type RateLimitHit = { limited: false } | { limited: true; retryAfterSeconds: number };

/**
 * Cuenta un pedido de `key` en el bucket y dice si se pasó del máximo.
 *
 * Sin Redis, o ante un fallo de Redis, no limita: no se corta el tráfico por un problema de
 * infraestructura. Lo usa el middleware y también las rutas que responden HTML y no JSON.
 */
export async function hitRateLimit(opts: RateLimitOptions, key: string): Promise<RateLimitHit> {
  const redis = getRedis();
  if (!redis) return { limited: false };
  const redisKey = `bff:rl:${opts.bucket}:${key}`;
  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, opts.windowSeconds);
    }
    if (count <= opts.max) return { limited: false };
    const ttl = await redis.ttl(redisKey);
    return { limited: true, retryAfterSeconds: Math.max(1, ttl) };
  } catch {
    return { limited: false };
  }
}

/**
 * Rate limiting basado en Redis por IP + bucket.
 *
 * La IP es la real del cliente (`clientIp`), no el primer valor de `X-Forwarded-For`: ese lo
 * escribe el cliente y alcanzaba con cambiarlo en cada pedido para no toparse nunca con el límite.
 */
export function rateLimit(opts: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const hit = await hitRateLimit(opts, clientIp(req) ?? "unknown");
    if (hit.limited) {
      res.setHeader("Retry-After", String(hit.retryAfterSeconds));
      return res.status(429).json({ message: "Demasiadas solicitudes. Intenta mas tarde." });
    }
    next();
  };
}
