import { Request, Response, NextFunction } from "express";
import { getRedis } from "../db/redis.js";

type RateLimitOptions = {
  /** Identificador del limite (ej. "login"). */
  bucket: string;
  /** Cantidad maxima de solicitudes dentro de la ventana. */
  max: number;
  /** Ventana en segundos. */
  windowSeconds: number;
};

/**
 * Rate limiting basado en Redis por IP + bucket.
 *
 * Si Redis no esta configurado, el middleware deja pasar (no-op) para no
 * romper entornos locales/CI sin Redis.
 */
export function rateLimit(opts: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const redis = getRedis();
    if (!redis) return next();

    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      "unknown";
    const key = `bff:rl:${opts.bucket}:${ip}`;

    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, opts.windowSeconds);
      }
      if (count > opts.max) {
        const ttl = await redis.ttl(key);
        res.setHeader("Retry-After", String(Math.max(1, ttl)));
        return res.status(429).json({ message: "Demasiadas solicitudes. Intenta mas tarde." });
      }
    } catch {
      // Ante fallo de Redis, no bloquear el trafico.
      return next();
    }
    next();
  };
}
