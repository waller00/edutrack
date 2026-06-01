import crypto from "crypto";
import { getRedis } from "../db/redis.js";

/**
 * Sesion server-side del patron BFF (Backend-For-Frontend).
 *
 * El navegador solo recibe una cookie opaca con el `sid`; los tokens OIDC de
 * Keycloak viven en Redis y nunca llegan al cliente.
 */
export type BffSession = {
  sid: string;
  userId: string;
  kcId: string;
  email: string;
  role: string;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** epoch ms en el que expira el access token de Keycloak */
  accessTokenExpiresAt: number;
  createdAt: number;
};

const PREFIX = "bff:sess:";
/** Índice inverso userId -> set de sids activos, para invalidar sesiones desde admin. */
const USER_INDEX_PREFIX = "bff:user-sess:";

function sessionTtlSeconds(): number {
  const days = Number(process.env.SESSION_TTL_DAYS || "7");
  return Math.max(1, days) * 24 * 60 * 60;
}

function userIndexKey(userId: string): string {
  return USER_INDEX_PREFIX + userId;
}

export function newSessionId(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function saveSession(session: BffSession): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis no disponible: requerido para sesiones BFF");
  const ttl = sessionTtlSeconds();
  await redis.set(PREFIX + session.sid, JSON.stringify(session), "EX", ttl);
  if (session.userId) {
    const indexKey = userIndexKey(session.userId);
    await redis.sadd(indexKey, session.sid);
    // El índice debe sobrevivir al menos lo que dura la sesión más larga.
    await redis.expire(indexKey, ttl);
  }
}

export async function getSession(sid: string): Promise<BffSession | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(PREFIX + sid);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BffSession;
  } catch {
    return null;
  }
}

export async function deleteSession(sid: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  // Leemos la sesión para limpiar también el índice inverso del usuario.
  const session = await getSession(sid);
  await redis.del(PREFIX + sid);
  if (session?.userId) {
    await redis.srem(userIndexKey(session.userId), sid).catch(() => {});
  }
}

/**
 * Invalida todas las sesiones BFF de un usuario (bloqueo, baja o cambio de rol
 * desde admin). Devuelve cuántas sesiones se borraron.
 */
export async function deleteSessionsForUser(userId: string): Promise<number> {
  const redis = getRedis();
  if (!redis || !userId) return 0;
  // Se invoca con `void` desde admin: nunca debe propagar un rechazo
  // (p. ej. si Redis está caído) ni tumbar el request en curso.
  try {
    const indexKey = userIndexKey(userId);
    const sids = await redis.smembers(indexKey);
    if (sids.length) {
      await redis.del(...sids.map((sid) => PREFIX + sid));
    }
    await redis.del(indexKey);
    return sids.length;
  } catch (error) {
    console.warn("[bff] no se pudieron invalidar sesiones del usuario:", error);
    return 0;
  }
}
