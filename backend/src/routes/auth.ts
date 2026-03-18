import { Router } from "express";
import { z } from "zod";
import argon2 from "argon2";
import { prisma } from "../prisma.js";
import { signAccessToken } from "../jwt.js";
import { authGuard } from "../middlewares/auth.js";
import passport from "../passportGoogle.js";
import crypto from "crypto";
import { sendMail } from "../email.js";

const r = Router();

/** Enlaces de cabecera: solo lo que el rol puede usar (fuente única, no en el bundle del front) */
const NAV_LINKS_BY_ROLE: Record<string, { href: string; label: string }[]> = {
  ADMIN: [
    { href: "/admin/users", label: "Usuarios" },
    { href: "/admin/attendance", label: "Asistencias" },
    { href: "/admin/events", label: "Eventos" },
    { href: "/admin/licenses", label: "Licencias" },
  ],
  TEACHER: [
    { href: "/teacher/attendance", label: "Mis asistencias" },
    { href: "/teacher/events", label: "Mis eventos" },
  ],
  STAFF: [
    { href: "/staff/attendance", label: "Mis asistencias" },
    { href: "/staff/events", label: "Mis eventos" },
  ],
};

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(64),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_.-]+$/).optional(),
  nationalId: z.string().min(6).max(20).optional(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  phone: z.string().min(7).max(20).optional(),
  birthdate: z.string().datetime().optional(),
  role: z.enum(["ADMIN","STAFF","TEACHER"]).optional(),
});

const loginSchema = z.object({ identifier: z.string().min(3).max(100), password: z.string().min(8).max(64) });

// Configuración de cookies endurecida y configurable
function resolveCookieConfig() {
  const envSecure = (process.env.COOKIE_SECURE || "").toLowerCase();
  const secure = envSecure ? envSecure === "true" : process.env.NODE_ENV === "production";
  const rawSameSite = (process.env.COOKIE_SAMESITE || (secure ? "none" : "lax")).toLowerCase();
  let sameSite: "none" | "strict" | "lax" = "lax";
  if (rawSameSite === "none") sameSite = "none";
  else if (rawSameSite === "strict") sameSite = "strict";
  let domain: string | undefined = process.env.COOKIE_DOMAIN || undefined;
  if (!domain && process.env.COOKIE_AUTO_DOMAIN === "true" && process.env.FRONTEND_URL) {
    try {
      const host = new URL(process.env.FRONTEND_URL).hostname;
      if (host && host !== "localhost" && host !== "127.0.0.1") domain = host;
    } catch {}
  }
  return { secure, sameSite, domain } as const;
}

function setAuthCookie(res: any, token: string) {
  const ttlMs = parseDurationMs(process.env.ACCESS_TOKEN_TTL || "2h");
  const cfg = resolveCookieConfig();
  res.cookie("access_token", token, {
    httpOnly: true,
    sameSite: cfg.sameSite,
    secure: cfg.secure,
    domain: cfg.domain,
    maxAge: ttlMs,
  });
}
function setRefreshCookie(res: any, token: string) {
  const ttlMs = parseDurationMs(process.env.REFRESH_TOKEN_TTL || "7d");
  const cfg = resolveCookieConfig();
  res.cookie("refresh_token", token, {
    httpOnly: true,
    sameSite: cfg.sameSite,
    secure: cfg.secure,
    domain: cfg.domain,
    maxAge: ttlMs,
    path: "/auth",
  });
}
function parseDurationMs(input: string) {
  const m = input.match(/^(\d+)([smhd])$/);
  if (!m) return 2 * 60 * 60 * 1000; // 2h
  const n = Number(m[1]);
  const unit = m[2];
  const map: any = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return n * map[unit];
}
function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// helpers comunes
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function onlyDigits(v: string) { return v.replace(/\D/g, ""); }
function computeCICheckDigit(base7: string) {
  const weights = [2, 9, 8, 7, 6, 3, 4];
  const padded = base7.padStart(7, "0");
  const sum = padded.split("").map((d, i) => parseInt(d) * weights[i]).reduce((a, b) => a + b, 0);
  const check = (10 - (sum % 10)) % 10;
  return check;
}
function isValidUruguayanCI(ci: string) {
  const digits = onlyDigits(ci);
  if (digits.length < 7 || digits.length > 8) return false;
  const base = digits.slice(0, -1);
  const check = parseInt(digits.slice(-1));
  return computeCICheckDigit(base) === check;
}
function normalizePhoneUY(input: string | undefined) {
  if (!input) return undefined;
  const d = onlyDigits(input);
  if (!d) return undefined;
  if (d.startsWith("598")) {
    const rest = d.slice(3).replace(/^0/, "");
    return "+598" + rest;
  }
  const noZero = d.startsWith("0") ? d.slice(1) : d;
  if (noZero.length >= 8) return "+598" + noZero.slice(0, 8);
  return undefined;
}

function buildProfileName(firstName?: string, lastName?: string) {
  return `${firstName ?? ""} ${lastName ?? ""}`.trim();
}

function parseBirthdateInput(birthdate: string) {
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(birthdate)) {
    const [dd, mm, yyyy] = birthdate.split('/').map(Number);
    return new Date(yyyy, mm - 1, dd);
  }
  return new Date(birthdate);
}

async function validateUniqueUsername(userId: string, username?: string) {
  if (!username) return null;
  const exist = await prisma.user.findUnique({ where: { username } });
  if (exist && exist.id !== userId) throw new Error('USERNAME_CONFLICT');
  return username;
}

async function validateNationalIdUpdate(userId: string, nationalId: string | undefined, isAdmin: boolean, isSettingInitialNationalId: boolean) {
  if (!nationalId) return undefined;
  if (!isValidUruguayanCI(nationalId)) throw new Error('INVALID_CI');
  const normCi = onlyDigits(nationalId);
  const existCi = await prisma.user.findUnique({ where: { nationalId: normCi } });
  if (existCi && existCi.id !== userId) throw new Error('CI_CONFLICT');
  if (!isAdmin && !isSettingInitialNationalId) throw new Error('FORBIDDEN');
  return normCi;
}

function validateRoleUpdate(role: "ADMIN" | "STAFF" | "TEACHER" | undefined, isAdmin: boolean, me: any) {
  if (!role) return undefined;
  if (!isAdmin && me?.isApproved) throw new Error('FORBIDDEN');
  if (!isAdmin && role === "ADMIN") throw new Error('FORBIDDEN');
  return role;
}

function validatePhoneUpdate(phone?: string) {
  if (!phone) return undefined;
  const normPhone = normalizePhoneUY(phone);
  if (!normPhone) throw new Error('INVALID_PHONE');
  return normPhone;
}

function validateBirthdateUpdate(birthdate?: string) {
  if (!birthdate) return undefined;
  const parsedBirthdate = parseBirthdateInput(birthdate);
  if (isNaN(parsedBirthdate.getTime()) || parsedBirthdate > new Date()) throw new Error('INVALID_BIRTHDATE');
  return parsedBirthdate;
}

function mapProfileUpdateError(error: Error, res: any) {
  if (error.message === 'USERNAME_CONFLICT') return res.status(409).json({ message: "Usuario ya en uso" });
  if (error.message === 'CI_CONFLICT') return res.status(409).json({ message: "Cédula ya registrada" });
  if (error.message === 'INVALID_CI') return res.status(400).json({ message: "Cédula inválida" });
  if (error.message === 'INVALID_PHONE') return res.status(400).json({ message: "Teléfono inválido" });
  if (error.message === 'INVALID_BIRTHDATE') return res.status(400).json({ message: "Fecha inválida" });
  if (error.message === 'FORBIDDEN') return res.status(403).json({ message: "Prohibido" });
  throw error;
}

async function validateAndBuildProfileUpdate(data: {
  userId: string
  userRole: string
  username?: string
  nationalId?: string
  firstName?: string
  lastName?: string
  phone?: string
  birthdate?: string
  role?: "ADMIN" | "STAFF" | "TEACHER"
}) {
  const update: any = {};
  const me = await prisma.user.findUnique({ where: { id: data.userId } });
  const isAdmin = data.userRole === 'ADMIN';
  const isSettingInitialNationalId = !me?.nationalId;

  update.username = await validateUniqueUsername(data.userId, data.username);
  update.nationalId = await validateNationalIdUpdate(data.userId, data.nationalId, isAdmin, isSettingInitialNationalId);
  update.role = validateRoleUpdate(data.role, isAdmin, me);

  if (data.firstName) update.firstName = data.firstName;
  if (data.lastName) update.lastName = data.lastName;
  if (data.firstName || data.lastName) update.name = buildProfileName(data.firstName, data.lastName);

  update.phone = validatePhoneUpdate(data.phone);
  update.birthdate = validateBirthdateUpdate(data.birthdate);

  return update;
}

async function registerFailedLogin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { failedLoginAttempts: true } });
  const attempts = (user?.failedLoginAttempts || 0) + 1;
  const data: any = { failedLoginAttempts: attempts };
  if (attempts >= MAX_ATTEMPTS) {
    data.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
    data.failedLoginAttempts = 0;
  }
  await prisma.user.update({ where: { id: userId }, data });
}

async function registerSuccessfulLogin(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { failedLoginAttempts: 0, lockUntil: null } });
}

// Rate limiting básico en memoria por IP
type RateEntry = { windowStart: number; count: number };
const rateMap = new Map<string, RateEntry>();
function createIpRateLimit(windowMs: number, max: number) {
  return (req: any, res: any, next: any) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || req.connection?.remoteAddress || "unknown";
    const key = `${req.method}:${req.baseUrl || ""}${req.path || ""}:${ip}`;
    const now = Date.now();
    const current = rateMap.get(key);
    if (!current || now - current.windowStart >= windowMs) {
      rateMap.set(key, { windowStart: now, count: 1 });
      return next();
    }
    if (current.count >= max) return res.status(429).json({ message: "Demasiadas solicitudes. Intenta más tarde" });
    current.count += 1;
    return next();
  };
}

// Check username availability
r.get('/check-username', async (req, res) => {
  const u = String(req.query.u || '').trim()
  const valid = /^[a-zA-Z0-9_.-]{3,30}$/.test(u)
  if (!valid) return res.json({ available: false, valid: false })
  const exist = await prisma.user.findUnique({ where: { username: u } })
  return res.json({ available: !exist, valid: true })
})

// Registro
r.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Datos inválidos" });

  const { email, password, username, nationalId, firstName, lastName, phone, birthdate, role } = parsed.data;

  const [byEmail, byUsername, byNational] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    username ? prisma.user.findUnique({ where: { username } }) : Promise.resolve(null),
    nationalId ? prisma.user.findUnique({ where: { nationalId: onlyDigits(nationalId) } }) : Promise.resolve(null),
  ]);
  if (byEmail) return res.status(409).json({ message: "Email ya registrado" });
  if (byUsername) return res.status(409).json({ message: "Nombre de usuario ya en uso" });
  if (byNational) return res.status(409).json({ message: "Cédula/Documento ya registrado" });
  if (nationalId && !isValidUruguayanCI(nationalId)) return res.status(400).json({ message: "Cédula inválida" });

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      username,
      nationalId: nationalId ? onlyDigits(nationalId) : null,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`,
      phone: normalizePhoneUY(phone),
      birthdate: birthdate ? new Date(birthdate) : null,
      role: role || "STAFF",
      isApproved: false,
      approvedAt: null,
      isActive: true,
    },
  });

  // email verification
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h
  await prisma.emailVerification.create({ data: { token, userId: user.id, expiresAt } });
  const verifyUrl = `${process.env.FRONTEND_URL}/verify?token=${token}`;
  try {
    await sendMail({
      to: email,
      subject: "Verifica tu email",
      html: `<p>Bienvenido/a. Verifica tu correo haciendo clic aquí:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
    });
  } catch (e) {
    console.error("SMTP send error (verify):", e);
  }

  const at = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  setAuthCookie(res, at);
  const rt = crypto.randomBytes(40).toString("hex");
  await prisma.refreshToken.create({ data: { tokenHash: hashToken(rt), userId: user.id, expiresAt: new Date(Date.now() + parseDurationMs(process.env.REFRESH_TOKEN_TTL || "7d")) } });
  setRefreshCookie(res, rt);
  return res.json({ id: user.id, email: user.email, username: user.username, role: user.role });
});

// Verificar email
r.post("/verify", async (req, res) => {
  const parsed = z.object({ token: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Datos inválidos" });
  const { token } = parsed.data;
  const ev = await prisma.emailVerification.findUnique({ where: { token } });
  if (!ev || ev.usedAt || ev.expiresAt < new Date()) return res.status(400).json({ message: "Token inválido" });
  await prisma.$transaction([
    prisma.user.update({ where: { id: ev.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailVerification.update({ where: { token }, data: { usedAt: new Date() } }),
  ]);
  return res.json({ ok: true });
});

// Reenviar verificación
r.post("/verify/resend", authGuard, async (req, res) => {
  const u = (req as any).user;
  const user = await prisma.user.findUnique({ where: { id: u.sub } });
  if (!user) return res.json({ ok: true });
  if (user.emailVerifiedAt) return res.json({ ok: true });

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);
  await prisma.emailVerification.create({ data: { token, userId: user.id, expiresAt } });
  const verifyUrl = `${process.env.FRONTEND_URL}/verify?token=${token}`;
  try {
    await sendMail({ to: user.email, subject: "Verifica tu email", html: `<p>Verifica tu correo:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>` });
  } catch (e) {
    console.error("SMTP send error (resend verify):", e);
  }
  return res.json({ ok: true });
});

// Completar/actualizar perfil (onboarding)
r.put("/profile", authGuard, async (req, res) => {
  const u = (req as any).user;
  const bodySchema = z.object({
    username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_.-]+$/).optional(),
    nationalId: z.string().min(6).max(20).optional(),
    firstName: z.string().min(1).max(80).optional(),
    lastName: z.string().min(1).max(80).optional(),
    phone: z.string().min(7).max(20).optional(),
    birthdate: z.string().min(8).max(32).optional(),
    role: z.enum(["ADMIN","STAFF","TEACHER"]).optional(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Datos inválidos" });
  const { username, nationalId, firstName, lastName, phone, birthdate, role } = parsed.data;
  let data: any;
  try {
    data = await validateAndBuildProfileUpdate({
      userId: u.sub,
      userRole: u.role,
      username,
      nationalId,
      firstName,
      lastName,
      phone,
      birthdate,
      role,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return mapProfileUpdateError(error, res);
  }

  const updated = await prisma.user.update({ where: { id: u.sub }, data });
  return res.json({ ok: true, id: updated.id });
});

// Establecer contraseña si aún no tiene
r.put("/password", authGuard, async (req, res) => {
  const u = (req as any).user;
  const parsed = z.object({ password: z.string().min(8).max(64) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Datos inválidos" });
  const me = await prisma.user.findUnique({ where: { id: u.sub }, select: { passwordHash: true } });
  if (!me) return res.status(401).json({ message: "No autorizado" });
  if (me.passwordHash) return res.status(409).json({ message: "La cuenta ya tiene contraseña" });
  const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });
  await prisma.user.update({ where: { id: u.sub }, data: { passwordHash } });
  return res.json({ ok: true });
});

// Cambiar contraseña con contraseña actual
r.put("/password/change", authGuard, async (req, res) => {
  const u = (req as any).user;
  const parsed = z.object({ currentPassword: z.string().min(8).max(64), newPassword: z.string().min(8).max(64) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Datos inválidos" });
  const me = await prisma.user.findUnique({ where: { id: u.sub }, select: { passwordHash: true } });
  if (!me || !me.passwordHash) return res.status(409).json({ message: "No hay contraseña definida" });
  const ok = await argon2.verify(me.passwordHash, parsed.data.currentPassword);
  if (!ok) return res.status(401).json({ message: "Contraseña actual incorrecta" });
  const passwordHash = await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id });
  await prisma.user.update({ where: { id: u.sub }, data: { passwordHash } });
  return res.json({ ok: true });
});

// Login
r.post("/login", createIpRateLimit(60 * 1000, 10), async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Datos inválidos" });

  const { identifier, password } = parsed.data as any;
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: identifier, mode: 'insensitive' as any } },
        { username: { equals: identifier, mode: 'insensitive' as any } },
      ],
    },
  });
  if (!user || !user.passwordHash) return res.status(401).json({ message: "Credenciales" });
  if (!user.isActive) return res.status(403).json({ message: "Cuenta desactivada" });

  if (user.lockUntil && user.lockUntil > new Date()) {
    return res.status(429).json({ message: "Cuenta bloqueada temporalmente. Intenta más tarde" });
  }

  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) {
    await registerFailedLogin(user.id);
    return res.status(401).json({ message: "Credenciales" });
  }

  await registerSuccessfulLogin(user.id);

  const token = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  setAuthCookie(res, token);
  const rt = crypto.randomBytes(40).toString("hex");
  await prisma.refreshToken.create({ data: { tokenHash: hashToken(rt), userId: user.id, expiresAt: new Date(Date.now() + parseDurationMs(process.env.REFRESH_TOKEN_TTL || "7d")), userAgent: req.headers["user-agent"], ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip } });
  setRefreshCookie(res, rt);
  return res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

// Forgot password
r.post("/forgot", createIpRateLimit(15 * 60 * 1000, 5), async (req, res) => {
  const parsed = z.object({ email: z.string().email(), captchaToken: z.string().min(10).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Datos inválidos" });
  const { email, captchaToken } = parsed.data as any;

  // Verificación de captcha (Cloudflare Turnstile)
  if (process.env.TURNSTILE_SECRET) {
    if (!captchaToken) {
      console.warn("[TURNSTILE] missing captchaToken", { host: req.headers.host, origin: req.headers.origin });
      return res.status(400).json({ message: "captcha" });
    }
    try {
      console.log("[TURNSTILE] verifying", { host: req.headers.host, origin: req.headers.origin });
      const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: captchaToken }),
      });
      const data = await resp.json();
      console.log("[TURNSTILE] verify response", { status: resp.status, success: data?.success, "error-codes": data?.["error-codes"], hostname: data?.hostname });
      if (!data.success) return res.status(400).json({ message: "captcha" });
    } catch (e) {
      console.error("[TURNSTILE] verify error", e);
      return res.status(400).json({ message: "captcha" });
    }
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.json({ ok: true });

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 15);

  await prisma.passwordReset.create({ data: { token, userId: user.id, expiresAt } });

  const resetUrl = `${process.env.FRONTEND_URL}/reset?token=${token}`;

  try {
    await sendMail({
      to: email,
      subject: "Restablecer tu contraseña",
      html: `
        <p>Hola,</p>
        <p>Has solicitado restablecer tu contraseña. Haz clic en el siguiente enlace para continuar:</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>Este enlace vence en 15 minutos. Si no fuiste tú, ignora este mensaje.</p>
      `,
      text: `Restablece tu contraseña: ${resetUrl}`,
    });
  } catch (e) {
    console.error("SMTP send error:", e);
    await prisma.passwordReset.delete({ where: { token } });
    return res.status(500).json({ message: "No se pudo enviar el email" });
  }

  return res.json({ ok: true });
});

// Reset password
r.post("/reset", async (req, res) => {
  const parsed = z.object({ token: z.string().min(10), password: z.string().min(8).max(64) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Datos inválidos" });
  const { token, password } = parsed.data;

  const pr = await prisma.passwordReset.findUnique({ where: { token } });
  if (!pr || pr.usedAt || pr.expiresAt < new Date()) return res.status(400).json({ message: "Token inválido" });

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.$transaction([
    prisma.user.update({ where: { id: pr.userId }, data: { passwordHash } }),
    prisma.passwordReset.update({ where: { token }, data: { usedAt: new Date() } }),
  ]);

  return res.json({ ok: true });
});

// Perfil con needsProfileCompletion
r.get("/me", authGuard, async (req, res) => {
  const u = (req as any).user;
  const db = await prisma.user.findUnique({ where: { id: u.sub }, select: { id:true, email:true, name:true, role:true, emailVerifiedAt:true, username:true, nationalId:true, firstName:true, lastName:true, phone:true, birthdate:true, passwordHash:true, isApproved:true, approvedAt:true, isActive:true }});
  if (!db) return res.status(401).json({ message: "No autorizado" });
  const needsProfileCompletion = !db.firstName || !db.lastName || !db.nationalId || !db.birthdate || !db.username;
  const hasPassword = !!db.passwordHash;
  const canShowNav =
    Boolean(db.isApproved && db.isActive && !needsProfileCompletion);
  const navLinks = canShowNav
    ? NAV_LINKS_BY_ROLE[db.role] || []
    : [];
  const { passwordHash, ...safe } = db as any;
  res.json({ ...safe, needsProfileCompletion, hasPassword, navLinks });
});

r.post("/logout", async (req, res) => {
  const rt = (req as any).cookies?.refresh_token as string | undefined;
  if (rt) {
    try {
      const hashed = hashToken(rt);
      await prisma.refreshToken.updateMany({ where: { tokenHash: hashed, revokedAt: null }, data: { revokedAt: new Date() } });
    } catch {}
  }
  res.clearCookie("access_token");
  res.clearCookie("refresh_token", { path: "/auth" });
  res.json({ ok: true });
});

// Google OAuth
r.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));
r.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/auth/google/failure" }),
  async (req, res) => {
    const user = (req as any).user;
    if (!user.isActive) {
      res.clearCookie("access_token");
      res.clearCookie("refresh_token", { path: "/auth" });
      return res.redirect(process.env.FRONTEND_URL! + "/login?error=inactive");
    }
    if (!user.emailVerifiedAt) {
      try { await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }); } catch {}
    }
    const token = signAccessToken({ sub: user.id, email: user.email, role: user.role });
    setAuthCookie(res, token);
    // Emitir refresh token también en OAuth
    const rt = crypto.randomBytes(40).toString("hex");
    await prisma.refreshToken.create({ data: { tokenHash: hashToken(rt), userId: user.id, expiresAt: new Date(Date.now() + parseDurationMs(process.env.REFRESH_TOKEN_TTL || "7d")), userAgent: req.headers["user-agent"], ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || (req as any).ip } });
    setRefreshCookie(res, rt);
    const needsProfileCompletion = !user.firstName || !user.lastName || !user.nationalId || !user.birthdate || !user.username;
    res.redirect(process.env.FRONTEND_URL! + (needsProfileCompletion ? "/onboarding" : "/"));
  }
);

// Ruta de fallo de Google OAuth
r.get("/google/failure", (_req, res) => {
  res.status(401).send("No se pudo iniciar sesión con Google");
});

// Refresh token
r.post("/refresh", async (req, res) => {
  const rt = (req as any).cookies?.refresh_token as string | undefined;
  if (!rt) return res.status(401).json({ message: "No autorizado" });
  const hashed = hashToken(rt);
  const record = await prisma.refreshToken.findFirst({ where: { tokenHash: hashed, revokedAt: null, expiresAt: { gt: new Date() } } });
  if (!record) return res.status(401).json({ message: "Refresh inválido" });

  const newRt = crypto.randomBytes(40).toString("hex");
  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date(), replacedById: undefined } }),
    prisma.refreshToken.create({ data: { tokenHash: hashToken(newRt), userId: record.userId, expiresAt: new Date(Date.now() + parseDurationMs(process.env.REFRESH_TOKEN_TTL || "7d")), userAgent: req.headers["user-agent"], ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip } }),
  ]);

  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (!user) return res.status(401).json({ message: "No autorizado" });
  if (!user.isActive) return res.status(403).json({ message: "Cuenta desactivada" });

  const at = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  setAuthCookie(res, at);
  setRefreshCookie(res, newRt);
  return res.json({ ok: true });
});

export default r;
