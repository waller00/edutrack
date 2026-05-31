import { Router } from "express";
import { getRedis } from "../db/redis.js";
import {
  buildLoginUrl,
  buildLogoutUrl,
  exchangeCode,
  pickRealmRole,
  redirectUri,
  refreshTokens,
} from "../auth/keycloak.js";
import {
  BffSession,
  deleteSession,
  getSession,
  newSessionId,
  saveSession,
} from "../auth/session-store.js";
import { provisionUserFromClaims } from "../auth/keycloak-provisioning.js";

/**
 * Rutas de autenticacion del patron BFF (Keycloak como IdP).
 *
 * Flujo OIDC Authorization Code + PKCE. El login se hace en la pantalla de
 * Keycloak (tematizada con el tema `edutrack` para que luzca como la app), lo
 * que habilita de forma nativa Google, 2FA (TOTP/WebAuthn) y reset de password.
 *   GET  /auth/login    -> redirige a Keycloak (pantalla themed)
 *   GET  /auth/callback -> intercambia code, crea sesion en Redis, setea cookie `sid`
 *   /auth/logout        -> borra sesion + logout en Keycloak
 *   /auth/refresh       -> refresca tokens OIDC de la sesion
 */
const r = Router();

const OAUTH_PREFIX = "bff:oauth:";
const OAUTH_TTL_SECONDS = 600;

function frontendUrl(): string {
  return (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
}

function resolveCookieConfig() {
  const envSecure = (process.env.COOKIE_SECURE || "").toLowerCase();
  const secure = envSecure ? envSecure === "true" : process.env.NODE_ENV === "production";
  const rawSameSite = (process.env.COOKIE_SAMESITE || "lax").toLowerCase();
  let sameSite: "none" | "strict" | "lax" = "lax";
  if (rawSameSite === "none") sameSite = "none";
  else if (rawSameSite === "strict") sameSite = "strict";
  const domain = process.env.COOKIE_DOMAIN || undefined;
  return { secure, sameSite, domain } as const;
}

function setSessionCookie(res: any, sid: string) {
  const cfg = resolveCookieConfig();
  const days = Number(process.env.SESSION_TTL_DAYS || "7");
  res.cookie("sid", sid, {
    httpOnly: true,
    secure: cfg.secure,
    sameSite: cfg.sameSite,
    domain: cfg.domain,
    path: "/",
    maxAge: Math.max(1, days) * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res: any) {
  const cfg = resolveCookieConfig();
  res.clearCookie("sid", {
    httpOnly: true,
    secure: cfg.secure,
    sameSite: cfg.sameSite,
    ...(cfg.domain ? { domain: cfg.domain } : {}),
    path: "/",
  });
}

async function startSessionFromTokens(
  res: any,
  tokens: { accessToken: string; refreshToken?: string; idToken?: string; expiresAt: number; claims: Record<string, any> },
): Promise<void> {
  const user = await provisionUserFromClaims(tokens.claims);
  const sid = newSessionId();
  const session: BffSession = {
    sid,
    userId: user.id,
    kcId: String(tokens.claims.sub || ""),
    email: user.email,
    role: pickRealmRole(tokens.claims) || user.role,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    accessTokenExpiresAt: tokens.expiresAt,
    createdAt: Date.now(),
  };
  await saveSession(session);
  setSessionCookie(res, sid);
}

r.get("/login", async (req, res) => {
  try {
    const provider = typeof req.query.provider === "string" ? req.query.provider : "";
    const identityProvider = provider === "google" ? "google" : undefined;
    const { codeVerifier, state, authUrl } = await buildLoginUrl({ identityProvider });
    const redis = getRedis();
    if (!redis) return res.status(503).json({ message: "Redis no disponible" });
    const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/";
    await redis.set(
      OAUTH_PREFIX + state,
      JSON.stringify({ codeVerifier, returnTo }),
      "EX",
      OAUTH_TTL_SECONDS,
    );
    res.redirect(authUrl);
  } catch (error) {
    console.error("[auth/login] keycloak:", error);
    res.redirect(`${frontendUrl()}/login?error=oidc`);
  }
});

r.get("/callback", async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const redis = getRedis();
  if (!redis) return res.status(503).json({ message: "Redis no disponible" });

  try {
    const stored = await redis.get(OAUTH_PREFIX + state);
    if (!stored) return res.redirect(`${frontendUrl()}/login?error=state`);
    await redis.del(OAUTH_PREFIX + state);
    const { codeVerifier, returnTo } = JSON.parse(stored) as { codeVerifier: string; returnTo: string };

    const currentUrl = new URL(redirectUri());
    // Trasladar los parametros reales (code, state, etc.) recibidos en el callback.
    for (const [k, v] of Object.entries(req.query)) {
      if (typeof v === "string") currentUrl.searchParams.set(k, v);
    }

    const tokens = await exchangeCode(currentUrl, codeVerifier, state);
    await startSessionFromTokens(res, tokens);

    const safeReturn = returnTo && returnTo.startsWith("/") ? returnTo : "/";
    res.redirect(`${frontendUrl()}${safeReturn}`);
  } catch (error) {
    console.error("[auth/callback] keycloak:", error);
    res.redirect(`${frontendUrl()}/login?error=oidc`);
  }
});

r.post("/refresh", async (req, res) => {
  const sid = (req as any).cookies?.sid as string | undefined;
  if (!sid) return res.status(401).json({ message: "No autorizado" });
  const session = await getSession(sid);
  if (!session) return res.status(401).json({ message: "Sesión expirada" });

  if (!session.refreshToken) {
    // Sin refresh token: la sesion sigue valida por su TTL en Redis.
    return res.json({ ok: true });
  }
  try {
    const tokens = await refreshTokens(session.refreshToken);
    session.accessToken = tokens.accessToken;
    session.refreshToken = tokens.refreshToken ?? session.refreshToken;
    session.idToken = tokens.idToken ?? session.idToken;
    session.accessTokenExpiresAt = tokens.expiresAt;
    await saveSession(session);
    res.json({ ok: true });
  } catch (error) {
    console.error("[auth/refresh] keycloak:", error);
    await deleteSession(sid);
    clearSessionCookie(res);
    res.status(401).json({ message: "No se pudo refrescar la sesión" });
  }
});

async function handleLogout(req: any, res: any) {
  const sid = req.cookies?.sid as string | undefined;
  let idToken: string | undefined;
  if (sid) {
    const session = await getSession(sid);
    idToken = session?.idToken;
    await deleteSession(sid);
  }
  clearSessionCookie(res);

  const postLogout = `${frontendUrl()}/login`;
  const logoutUrl = await buildLogoutUrl(idToken, postLogout);
  if (req.method === "GET" && logoutUrl) {
    return res.redirect(logoutUrl);
  }
  res.json({ ok: true, logoutUrl });
}

r.post("/logout", handleLogout);
r.get("/logout", handleLogout);

export default r;
