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

function sessionTtlSeconds(): number {
  const days = Number(process.env.SESSION_TTL_DAYS || "7");
  return Math.max(1, days) * 24 * 60 * 60;
}

export function newSessionId(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function saveSession(session: BffSession): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis no disponible: requerido para sesiones BFF");
  await redis.set(
    PREFIX + session.sid,
    JSON.stringify(session),
    "EX",
    sessionTtlSeconds(),
  );
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
  await redis.del(PREFIX + sid);
}
