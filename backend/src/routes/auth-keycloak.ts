import { Router } from "express";
import crypto from "node:crypto";
import { getRedis } from "../db/redis.js";
import { prisma } from "../db/prisma.js";
import {
  buildAccountConsoleUrl,
  buildLoginUrl,
  buildLogoutUrl,
  deleteKeycloakUserOtpCredentials,
  exchangeCode,
  getKeycloakUserLoginName,
  getKeycloakUserOtpStatus,
  redirectUri,
  refreshTokens,
  triggerKeycloakPasswordReset,
  verifyKeycloakPassword,
} from "../auth/keycloak.js";
import { sendMail } from "../notifications/email.js";
import {
  BffSession,
  deleteSession,
  getSession,
  newSessionId,
  saveSession,
} from "../auth/session-store.js";
import { provisionUserFromClaims, SsoRegistrationRequiredError } from "../auth/keycloak-provisioning.js";
import { createSsoRegistration } from "../auth/sso-registration.js";

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
 *   /auth/account/*     -> envia al portal de cuenta con sesion BFF valida
 */
const r = Router();

const OAUTH_PREFIX = "bff:oauth:";
const OAUTH_TTL_SECONDS = 600;

type PostLoginAction = "DISABLE_TOTP";

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
): Promise<BffSession> {
  const user = await provisionUserFromClaims(tokens.claims);
  const sid = newSessionId();
  const session: BffSession = {
    sid,
    userId: user.id,
    kcId: String(tokens.claims.sub || ""),
    email: user.email,
    // `user.role` ya es el rol efectivo en Postgres (fuente de verdad de autz).
    role: user.role,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    accessTokenExpiresAt: tokens.expiresAt,
    createdAt: Date.now(),
  };
  await saveSession(session);
  setSessionCookie(res, sid);
  return session;
}

async function requireSession(req: any, res: any): Promise<BffSession | null> {
  const sid = req.cookies?.sid as string | undefined;
  if (!sid) {
    res.redirect(`${frontendUrl()}/login`);
    return null;
  }
  const session = await getSession(sid);
  if (!session) {
    clearSessionCookie(res);
    res.redirect(`${frontendUrl()}/login`);
    return null;
  }
  return session;
}

async function beginLoginFlow(
  res: any,
  options: {
    identityProvider?: "google";
    requiredAction?: "UPDATE_PASSWORD" | "CONFIGURE_TOTP" | "CONFIGURE_RECOVERY_AUTHN_CODES";
    prompt?: "login";
    returnTo?: string;
    postLoginAction?: PostLoginAction;
    // Identidad (kcId) de la sesion que origina el flujo. Para acciones
    // sensibles (DISABLE_TOTP) el callback exige que el sujeto reautenticado
    // coincida con este valor, de modo que el flujo nunca opere sobre otra cuenta.
    originKcId?: string;
  } = {},
) {
  const { codeVerifier, state, authUrl } = await buildLoginUrl({
    identityProvider: options.identityProvider,
    requiredAction: options.requiredAction,
    prompt: options.prompt,
  });
  const redis = getRedis();
  if (!redis) {
    res.status(503).json({ message: "Redis no disponible" });
    return;
  }
  const returnTo = options.returnTo && options.returnTo.startsWith("/") ? options.returnTo : "/";
  await redis.set(
    OAUTH_PREFIX + state,
    JSON.stringify({ codeVerifier, returnTo, postLoginAction: options.postLoginAction, originKcId: options.originKcId }),
    "EX",
    OAUTH_TTL_SECONDS,
  );
  res.redirect(authUrl);
}

r.get("/login", async (req, res) => {
  try {
    const provider = typeof req.query.provider === "string" ? req.query.provider : "";
    const identityProvider = provider === "google" ? "google" : undefined;
    const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/";
    await beginLoginFlow(res, { identityProvider, returnTo });
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
    const { codeVerifier, returnTo, postLoginAction, originKcId } = JSON.parse(stored) as {
      codeVerifier: string;
      returnTo: string;
      postLoginAction?: PostLoginAction;
      originKcId?: string;
    };

    const currentUrl = new URL(redirectUri());
    // Trasladar los parametros reales (code, state, etc.) recibidos en el callback.
    for (const [k, v] of Object.entries(req.query)) {
      if (typeof v === "string") currentUrl.searchParams.set(k, v);
    }

    const tokens = await exchangeCode(currentUrl, codeVerifier, state);
    try {
      await startSessionFromTokens(res, tokens);
    } catch (error) {
      if (error instanceof SsoRegistrationRequiredError) {
        const token = await createSsoRegistration(error.profile);
        clearSessionCookie(res);
        return res.redirect(`${frontendUrl()}/register?sso=${encodeURIComponent(token)}`);
      }
      throw error;
    }

    if (postLoginAction === "DISABLE_TOTP") {
      const kcId = String(tokens.claims.sub || "");
      // El sujeto que reautentico en Keycloak debe ser el mismo que origino el
      // pedido. Sin este binding, un dispositivo compartido o un inicio cruzado
      // podria borrar el 2FA de otra cuenta.
      if (!originKcId || kcId !== originKcId) {
        console.warn("[auth/callback] disable 2FA: identidad no coincide con la que origino el flujo");
        return res.redirect(`${frontendUrl()}/profile?twoFactorDisableError=identity`);
      }
      try {
        await deleteKeycloakUserOtpCredentials(kcId);
        return res.redirect(`${frontendUrl()}/profile?twoFactorDisabled=1`);
      } catch (error) {
        console.error("[auth/callback] disable 2FA:", error);
        return res.redirect(`${frontendUrl()}/profile?twoFactorDisableError=1`);
      }
    }

    if (req.query.kc_action === "CONFIGURE_TOTP" && req.query.kc_action_status === "success") {
      await beginLoginFlow(res, { requiredAction: "CONFIGURE_RECOVERY_AUTHN_CODES", returnTo: "/profile" });
      return;
    }

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

r.get("/account", async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;
  res.redirect(buildAccountConsoleUrl());
});

r.get("/account/password", async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;
  await beginLoginFlow(res, { requiredAction: "UPDATE_PASSWORD", prompt: "login", returnTo: "/profile" });
});

r.get("/account/2fa", async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;
  await beginLoginFlow(res, { requiredAction: "CONFIGURE_TOTP", prompt: "login", returnTo: "/profile" });
});

// POST (no GET): al ser un metodo no seguro, una cookie `SameSite=lax` no viaja
// en envios cross-site, de modo que el propio atributo de la cookie actua como
// defensa CSRF contra un disparo drive-by desde otro sitio.
r.post("/account/2fa/disable", async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;
  await beginLoginFlow(res, {
    prompt: "login",
    returnTo: "/profile",
    postLoginAction: "DISABLE_TOTP",
    originKcId: session.kcId,
  });
});

function publicApiUrl(req: any): string {
  const configured = (process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

function twoFactorEmailSecret(): string {
  const secret =
    process.env.TWO_FACTOR_DISABLE_EMAIL_SECRET ||
    process.env.JWT_SECRET ||
    process.env.SESSION_SECRET;
  // Esta clave HMAC es la unica barrera del endpoint no autenticado de
  // desactivacion por correo. No hay fallback hardcodeado: sin secreto real
  // preferimos fallar (firmar/verificar lanza) antes que emitir tokens
  // forjables por cualquiera con acceso al repositorio.
  if (!secret) {
    throw new Error(
      "Falta el secreto de desactivacion de 2FA por correo (TWO_FACTOR_DISABLE_EMAIL_SECRET, JWT_SECRET o SESSION_SECRET).",
    );
  }
  return secret;
}

function signDisable2faPayload(payload: string): string {
  return crypto.createHmac("sha256", twoFactorEmailSecret()).update(payload).digest("base64url");
}

function createDisable2faEmailToken(input: { kcId: string; userId: string; email: string }): string {
  const payload = Buffer.from(
    JSON.stringify({
      kcId: input.kcId,
      userId: input.userId,
      email: input.email,
      exp: Date.now() + 15 * 60 * 1000,
      nonce: crypto.randomBytes(12).toString("base64url"),
    }),
  ).toString("base64url");
  return `${payload}.${signDisable2faPayload(payload)}`;
}

function verifyDisable2faEmailToken(
  token: string,
): { kcId: string; userId: string; email: string; nonce: string; exp: number } | null {
  try {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = signDisable2faPayload(payload);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      kcId?: unknown;
      userId?: unknown;
      email?: unknown;
      exp?: unknown;
      nonce?: unknown;
    };
    if (typeof data.kcId !== "string" || typeof data.userId !== "string" || typeof data.email !== "string") return null;
    if (typeof data.nonce !== "string" || !data.nonce) return null;
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { kcId: data.kcId, userId: data.userId, email: data.email, nonce: data.nonce, exp: data.exp };
  } catch {
    // Token mal formado o secreto no configurado: fail-closed.
    return null;
  }
}

r.post("/account/2fa/disable-email", async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, emailVerifiedAt: true },
  });
  if (!user?.email) return res.status(400).json({ message: "No hay un correo asociado a la cuenta." });
  if (!user.emailVerifiedAt) {
    return res.status(400).json({ message: "Tenés que verificar tu correo antes de usar esta recuperación." });
  }

  let token: string;
  try {
    token = createDisable2faEmailToken({ kcId: session.kcId, userId: user.id, email: user.email });
  } catch (error) {
    console.error("[auth/account/2fa/disable-email] secret:", error);
    return res.status(500).json({ message: "La recuperación por correo no está disponible en este momento." });
  }
  const url = `${publicApiUrl(req)}/auth/account/2fa/disable-email?token=${encodeURIComponent(token)}`;
  try {
    await sendMail({
      to: user.email,
      subject: "Confirmar desactivación de 2FA",
      html: `<p>Recibimos una solicitud para desactivar la verificación en dos pasos de tu cuenta EduTrack.</p><p>Si fuiste vos, confirmalo desde este enlace válido por 15 minutos:</p><p><a href="${url}">${url}</a></p><p>Si no fuiste vos, ignorá este correo.</p>`,
      text: `Confirmá la desactivación de 2FA desde este enlace válido por 15 minutos: ${url}`,
    });
    res.json({ ok: true });
  } catch (error) {
    console.error("[auth/account/2fa/disable-email] mail:", error);
    res.status(502).json({ message: "No se pudo enviar el correo de confirmación." });
  }
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderDisable2faConfirmPage(confirmUrl: string, token: string): string {
  const action = escapeHtml(confirmUrl);
  const value = escapeHtml(token);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Confirmar desactivación de 2FA</title>
<style>body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}main{max-width:28rem;background:#fff;border:1px solid #e2e8f0;border-radius:1rem;padding:2rem;box-shadow:0 10px 25px rgba(15,23,42,.06)}h1{font-size:1.25rem;margin:0 0 .75rem}p{color:#475569;line-height:1.5}button{margin-top:1.25rem;width:100%;padding:.75rem 1rem;border:0;border-radius:.5rem;background:#dc2626;color:#fff;font-size:1rem;font-weight:600;cursor:pointer}</style>
</head>
<body>
<main>
<h1>Desactivar verificación en dos pasos</h1>
<p>Vas a desactivar la verificación en dos pasos (2FA) de tu cuenta EduTrack. Confirmá solo si fuiste vos quien lo solicitó.</p>
<form method="post" action="${action}">
<input type="hidden" name="token" value="${value}" />
<button type="submit">Confirmar desactivación de 2FA</button>
</form>
</main>
</body>
</html>`;
}

// GET no muta: solo renderiza una pantalla de confirmacion. Asi los escaneres de
// enlaces de correo (Safe Links, Mimecast, Proofpoint...) que pre-cargan las URLs
// con GET no pueden borrar el 2FA antes de que el usuario confirme.
r.get("/account/2fa/disable-email", (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  // Allowlist estricto antes de reflejar: el token es <base64url>.<base64url>,
  // sin metacaracteres HTML. Restringir el alfabeto corta cualquier XSS reflejado.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    return res.redirect(`${frontendUrl()}/profile?twoFactorDisableError=token`);
  }
  const data = verifyDisable2faEmailToken(token);
  if (!data) return res.redirect(`${frontendUrl()}/profile?twoFactorDisableError=token`);
  const confirmUrl = `${publicApiUrl(req)}/auth/account/2fa/disable-email/confirm`;
  res.set("Content-Type", "text/html; charset=utf-8");
  return res.send(renderDisable2faConfirmPage(confirmUrl, token));
});

// La accion destructiva vive en POST (los pre-fetchers no envian POST) y el nonce
// del token se marca como usado en Redis para que el enlace sea de un solo uso
// (no se puede repetir dentro de la ventana de validez ni revertir una re-alta).
r.post("/account/2fa/disable-email/confirm", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const data = verifyDisable2faEmailToken(token);
  if (!data) return res.redirect(`${frontendUrl()}/profile?twoFactorDisableError=token`);
  const redis = getRedis();
  if (!redis) return res.redirect(`${frontendUrl()}/profile?twoFactorDisableError=1`);
  try {
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { email: true },
    });
    if (!user || user.email.toLowerCase() !== data.email.toLowerCase()) {
      return res.redirect(`${frontendUrl()}/profile?twoFactorDisableError=token`);
    }
    const ttlSeconds = Math.max(1, Math.ceil((data.exp - Date.now()) / 1000));
    const reserved = await redis.set(`bff:2fa-disable-used:${data.nonce}`, "1", "EX", ttlSeconds, "NX");
    if (reserved !== "OK") {
      // Nonce ya consumido: enlace reutilizado.
      return res.redirect(`${frontendUrl()}/profile?twoFactorDisableError=token`);
    }
    await deleteKeycloakUserOtpCredentials(data.kcId);
    return res.redirect(`${frontendUrl()}/profile?twoFactorDisabled=email`);
  } catch (error) {
    console.error("[auth/account/2fa/disable-email/confirm] disable:", error);
    return res.redirect(`${frontendUrl()}/profile?twoFactorDisableError=1`);
  }
});

r.get("/account/recovery-codes", async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;
  await beginLoginFlow(res, { requiredAction: "CONFIGURE_RECOVERY_AUTHN_CODES", prompt: "login", returnTo: "/profile" });
});

r.get("/account/2fa/status", async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;
  try {
    const status = await getKeycloakUserOtpStatus(session.kcId);
    res.json(status);
  } catch (error) {
    console.error("[auth/account/2fa/status] keycloak:", error);
    res.status(502).json({ message: "No se pudo consultar el estado de 2FA." });
  }
});

r.delete("/account/2fa", async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!password) return res.status(400).json({ message: "Ingresá tu contraseña actual." });
  try {
    const loginName = (await getKeycloakUserLoginName(session.kcId)) || session.email;
    const ok = await verifyKeycloakPassword(loginName, password);
    if (!ok) return res.status(401).json({ message: "Contraseña incorrecta." });
    const removed = await deleteKeycloakUserOtpCredentials(session.kcId);
    res.json({ ok: true, removed });
  } catch (error) {
    console.error("[auth/account/2fa] disable:", error);
    res.status(502).json({ message: "No se pudo desactivar 2FA." });
  }
});

r.get("/account/security", async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;
  res.redirect(buildAccountConsoleUrl("account-security/signing-in"));
});

r.post("/forgot-password", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email || !/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,255}$/.test(email)) {
    return res.status(400).json({ message: "Ingresá un correo válido." });
  }
  try {
    await triggerKeycloakPasswordReset(email);
  } catch (error) {
    // No revelamos si el correo existe, pero sí dejamos log para diagnosticar SMTP/Keycloak.
    console.error("[auth/forgot-password] keycloak:", error);
  }
  res.json({ ok: true });
});

/**
 * Construye una URL de retorno dentro del frontend a partir de `returnTo`.
 * Resuelve el path contra el origen del frontend y verifica que el origen final
 * coincida, de modo que un valor controlado por el usuario nunca pueda redirigir
 * a un host externo (open redirect).
 */
function safeFrontendReturnUrl(returnTo: unknown): string {
  const base = frontendUrl();
  const fallback = `${base}/login?loggedOut=1`;
  if (typeof returnTo !== "string" || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return fallback;
  }
  try {
    const resolved = new URL(returnTo, base);
    if (resolved.origin !== new URL(base).origin) return fallback;
    return `${base}${resolved.pathname}${resolved.search}`;
  } catch {
    return fallback;
  }
}

async function handleLogout(req: any, res: any) {
  const sid = req.cookies?.sid as string | undefined;
  let idToken: string | undefined;
  if (sid) {
    const session = await getSession(sid);
    idToken = session?.idToken;
    await deleteSession(sid);
  }
  clearSessionCookie(res);

  const postLogout = safeFrontendReturnUrl(req.query.returnTo);
  const logoutUrl = await buildLogoutUrl(idToken, postLogout);
  if (req.method === "GET" && logoutUrl) {
    return res.redirect(logoutUrl);
  }
  if (req.method === "GET") {
    return res.redirect(postLogout);
  }
  res.json({ ok: true, logoutUrl });
}

r.post("/logout", handleLogout);
r.get("/logout", handleLogout);

export default r;
