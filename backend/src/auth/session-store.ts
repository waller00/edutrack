import crypto from "node:crypto";
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
  /** Navegador e IP del ingreso, para que la persona reconozca sus sesiones en Mi perfil. */
  userAgent?: string;
  ip?: string;
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

/** Sesiones vivas del usuario. Las que ya vencieron se sacan del índice. */
export async function listSessionsForUser(userId: string): Promise<BffSession[]> {
  const redis = getRedis();
  if (!redis || !userId) return [];
  const indexKey = userIndexKey(userId);
  const sids = await redis.smembers(indexKey);
  if (!sids.length) return [];
  const raws = await redis.mget(...sids.map((sid) => PREFIX + sid));
  const sessions: BffSession[] = [];
  const expired: string[] = [];
  raws.forEach((raw, index) => {
    if (!raw) {
      expired.push(sids[index]);
      return;
    }
    try {
      sessions.push(JSON.parse(raw) as BffSession);
    } catch {
      expired.push(sids[index]);
    }
  });
  if (expired.length) await redis.srem(indexKey, ...expired).catch(() => {});
  return sessions;
}

/**
 * Cierra las demás sesiones BFF del usuario y conserva `keepSid` (la de quien lo pide). Devuelve
 * cuántas cerró.
 */
export async function deleteOtherSessionsForUser(userId: string, keepSid: string): Promise<number> {
  const redis = getRedis();
  if (!redis || !userId) return 0;
  const indexKey = userIndexKey(userId);
  const others = (await redis.smembers(indexKey)).filter((sid) => sid !== keepSid);
  if (!others.length) return 0;
  const deleted = await redis.del(...others.map((sid) => PREFIX + sid));
  await redis.srem(indexKey, ...others);
  return deleted;
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
