import crypto from "node:crypto";
import { getRedis } from "../db/redis.js";

const PREFIX = "bff:sso-register:";
const TTL_SECONDS = 15 * 60;

export type SsoRegistrationProfile = {
  kcId: string;
  email: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  emailVerified?: boolean;
};

export async function createSsoRegistration(profile: SsoRegistrationProfile): Promise<string> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis no disponible: requerido para registro SSO");
  const token = crypto.randomBytes(32).toString("hex");
  await redis.set(PREFIX + token, JSON.stringify(profile), "EX", TTL_SECONDS);
  return token;
}

export async function getSsoRegistration(token: string): Promise<SsoRegistrationProfile | null> {
  const redis = getRedis();
  if (!redis || !token) return null;
  const raw = await redis.get(PREFIX + token);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SsoRegistrationProfile;
    return parsed?.email && parsed?.kcId ? parsed : null;
  } catch {
    return null;
  }
}

export async function consumeSsoRegistration(token: string): Promise<SsoRegistrationProfile | null> {
  const redis = getRedis();
  if (!redis || !token) return null;
  const profile = await getSsoRegistration(token);
  await redis.del(PREFIX + token);
  return profile;
}
