import { Router } from "express";
import { z } from "zod";
import argon2 from "argon2";
import { prisma } from "../db/prisma.js";
import { signAccessToken, signTwoFactorLoginToken, verifyToken, verifyTwoFactorLoginToken } from "../auth/jwt.js";
import { recordAuditEvent } from "../services/audit-log.js";
import { AuditAction } from "@prisma/client";
import { authGuard } from "../middlewares/auth.js";
import passport from "../auth/passportGoogle.js";
import crypto from "crypto";
import qrcode from "qrcode";
import { generateSecret, generateURI, verifySync } from "otplib";
import { sendMail } from "../notifications/email.js";
import { onlyDigits, isValidUruguayanCI } from "../identity/uruguay-ci.js";
import {
  normalizePhoneUY,
  buildProfileName,
  validateRoleUpdate,
  validatePhoneUpdate,
  validateBirthdateUpdate,
  validateNationalIdDocumentExpiresAtUpdate,
  mapProfileUpdateError,
} from "../auth/auth-profile-pure.js";
import { firstZodIssueMessage, strongPasswordSchema } from "../auth/password-policy.js";
import { isDiditConfigured, isLivenessRequiredForRegistration } from "../config/system-settings.js";
import { syncLivenessSessionFromDiditApi } from "../integrations/didit/sync-session.js";
import { getOrgRoleIdByCodeOrThrow, normalizeOrgRoleCode } from "../identity/org-role-service.js";
import { ensureDefaultProfilePermissionsIfNeeded } from "../identity/profile-permissions-repository.js";

const r = Router();

/**
 * Enlaces de cabecera: vacíos — la navegación va por el panel de inicio y la campana de avisos.
 * (Se mantiene la clave en /auth/me por compatibilidad con clientes viejos.)
 */
const NAV_LINKS_BY_ROLE: Record<string, { href: string; label: string }[]> = {
  ADMIN: [],
  TEACHER: [],
  STAFF: [],
};

const registerSchema = z.object({
  email: z.string().email(),
  password: strongPasswordSchema,
  nationalId: z.string().min(6).max(20).optional(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  phone: z.string().min(7).max(20).optional(),
  birthdate: z.string().datetime().optional(),
  nationalIdDocumentExpiresAt: z.string().min(8).max(40).optional(),
  role: z.enum(["ADMIN","STAFF","TEACHER"]).optional(),
  livenessToken: z.string().uuid().optional(),
});

const loginSchema = z.object({ identifier: z.string().min(3).max(100), password: z.string().min(8).max(64) });
const twoFactorCodeSchema = z.string().trim().regex(/^\d{6}$|^[A-Z0-9]{4}-[A-Z0-9]{4}$/i);

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

/** Mismas opciones que al setear; si no, el navegador puede dejar la cookie activa. */
function clearAuthCookies(res: any) {
  const cfg = resolveCookieConfig();
  const base = {
    httpOnly: true,
    secure: cfg.secure,
    sameSite: cfg.sameSite as "lax" | "strict" | "none",
    ...(cfg.domain ? { domain: cfg.domain } : {}),
  };
  res.clearCookie("access_token", { ...base, path: "/" });
  res.clearCookie("refresh_token", { ...base, path: "/auth" });
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

function twoFactorEncryptionKey() {
  return crypto
    .createHash("sha256")
    .update(process.env.TWO_FACTOR_ENCRYPTION_KEY || process.env.JWT_SECRET || "dev-only-two-factor-key")
    .digest();
}

function encryptTwoFactorSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", twoFactorEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  });
}

function decryptTwoFactorSecret(value: string) {
  const parsed = JSON.parse(value) as { iv: string; tag: string; data: string };
  const decipher = crypto.createDecipheriv("aes-256-gcm", twoFactorEncryptionKey(), Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(parsed.data, "base64")), decipher.final()]).toString("utf8");
}

function generateBackupCodes() {
  return Array.from({ length: 10 }, () => `${crypto.randomBytes(2).toString("hex").toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`);
}

function hashBackupCode(code: string) {
  return hashToken(code.trim().toUpperCase());
}

async function replaceBackupCodesForUser(userId: string, client: any = prisma) {
  const backupCodes = generateBackupCodes();
  await client.twoFactorBackupCode.deleteMany({ where: { userId } });
  await client.twoFactorBackupCode.createMany({
    data: backupCodes.map((code) => ({ userId, codeHash: hashBackupCode(code) })),
  });
  return backupCodes;
}

async function consumeBackupCodeForUser(userId: string, code: string, client: any = prisma) {
  const existing = await client.twoFactorBackupCode.findFirst({
    where: { userId, codeHash: hashBackupCode(code), usedAt: null },
    select: { id: true },
  });
  if (!existing) return false;
  const consumed = await client.twoFactorBackupCode.updateMany({
    where: { id: existing.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  return consumed.count === 1;
}

function issueSessionCookies(res: any, req: any, user: { id: string; email: string; role: string }) {
  const token = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  setAuthCookie(res, token);
  const rt = crypto.randomBytes(40).toString("hex");
  setRefreshCookie(res, rt);
  return prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(rt),
      userId: user.id,
      expiresAt: new Date(Date.now() + parseDurationMs(process.env.REFRESH_TOKEN_TTL || "7d")),
      userAgent: req.headers["user-agent"],
      ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip,
    },
  });
}

async function enabledPermissionsForRole(roleCode: string) {
  if (!roleCode) return []
  try {
    const rows = await prisma.rolePermission.findMany({
      where: {
        enabled: true,
        orgRole: { code: roleCode, active: true },
      },
      select: {
        permission: { select: { code: true } },
        scope: true,
      },
      orderBy: { permission: { code: "asc" } },
    });
    return rows.map((row) => ({
      id: row.permission.code,
      scope: row.scope === "ALL" ? "all" : "own",
    }));
  } catch (error) {
    console.warn("[auth/me] permissions lookup skipped", error);
    return [];
  }
}

function verifyTotpCode(code: string, secret: string) {
  return verifySync({ secret, token: code, epochTolerance: 30 }).valid;
}

// helpers comunes
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const turnstileDebugEnabled = process.env.TURNSTILE_DEBUG === "true";

function logTurnstileDebug(message: string, metadata: Record<string, unknown>) {
  if (turnstileDebugEnabled) {
    console.log(message, metadata);
  }
}

async function validateUniqueUsername(userId: string, username?: string) {
  if (!username) return undefined;
  const exist = await prisma.user.findUnique({ where: { username } });
  if (exist && exist.id !== userId) throw new Error('USERNAME_CONFLICT');
  return username;
}

function usernamePart(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, "")
    .trim()
    .split(/[\s.-]+/)
    .filter(Boolean);
}

function fitUsername(base: string, suffix = "") {
  const maxBase = Math.max(3, 30 - suffix.length);
  return `${base.slice(0, maxBase).replace(/[.-]+$/g, "")}${suffix}`;
}

async function generateUniqueUsername(firstName: string, lastName: string, client: any = prisma) {
  const first = usernamePart(firstName)[0] || "usuario";
  const lastParts = usernamePart(lastName);
  const firstLast = lastParts[0] || "sinapellido";
  const secondInitial = lastParts[1]?.charAt(0) || "";
  const base = `${first}.${firstLast}`.slice(0, 30).replace(/[.-]+$/g, "");

  const candidates = [base];
  if (secondInitial) candidates.push(fitUsername(base, `.${secondInitial}`));
  for (const candidate of candidates) {
    const existing = await client.user.findUnique({ where: { username: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }

  const numberedBase = secondInitial ? fitUsername(base, `.${secondInitial}`) : base;
  for (let i = 1; i <= 9999; i += 1) {
    const candidate = fitUsername(numberedBase, String(i));
    const existing = await client.user.findUnique({ where: { username: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  return fitUsername(base, `.${crypto.randomBytes(2).toString("hex")}`);
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

async function validateAndBuildProfileUpdate(data: {
  userId: string
  userRole: string
  username?: string
  nationalId?: string
  firstName?: string
  lastName?: string
  phone?: string
  birthdate?: string
  nationalIdDocumentExpiresAt?: string
  role?: "ADMIN" | "STAFF" | "TEACHER"
}) {
  const update: any = {};
  const me = await prisma.user.findUnique({ where: { id: data.userId } });
  if (!me) throw new Error('NOT_FOUND');
  const isAdmin = data.userRole === 'ADMIN';
  const isSettingInitialNationalId = !me?.nationalId;

  const username = await validateUniqueUsername(data.userId, data.username);
  if (username !== undefined) update.username = username;

  const nationalId = await validateNationalIdUpdate(data.userId, data.nationalId, isAdmin, isSettingInitialNationalId);
  if (nationalId !== undefined) update.nationalId = nationalId;

  const role = validateRoleUpdate(data.role, isAdmin, me);
  if (role !== undefined) update.role = role;

  if (data.firstName) update.firstName = data.firstName;
  if (data.lastName) update.lastName = data.lastName;
  if (data.firstName || data.lastName) {
    update.name = buildProfileName(data.firstName ?? me.firstName ?? undefined, data.lastName ?? me.lastName ?? undefined);
  }

  const phone = validatePhoneUpdate(data.phone);
  if (phone !== undefined) update.phone = phone;

  const birthdate = validateBirthdateUpdate(data.birthdate);
  if (birthdate !== undefined) update.birthdate = birthdate;

  const nationalIdDocumentExpiresAt = validateNationalIdDocumentExpiresAtUpdate(data.nationalIdDocumentExpiresAt);
  if (nationalIdDocumentExpiresAt !== undefined) update.nationalIdDocumentExpiresAt = nationalIdDocumentExpiresAt;

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
r.get("/registration-options", async (_req, res) => {
  const livenessRequired = isLivenessRequiredForRegistration()
  return res.json({
    livenessCheckEnabled: livenessRequired,
    diditConfigured: isDiditConfigured(),
  })
});

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
  if (!parsed.success) return res.status(400).json({ message: firstZodIssueMessage(parsed.error) });

  const { email, password, nationalId, firstName, lastName, phone, birthdate, nationalIdDocumentExpiresAt, role, livenessToken } = parsed.data;

  const [byEmail, byNational] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    nationalId ? prisma.user.findUnique({ where: { nationalId: onlyDigits(nationalId) } }) : Promise.resolve(null),
  ]);
  const requireDidit = isLivenessRequiredForRegistration()
  if (requireDidit && !isDiditConfigured()) {
    return res.status(503).json({
      message:
        'El registro con verificación de identidad no está disponible: el servidor no tiene configurado Didit (DIDIT_API_KEY y DIDIT_WORKFLOW_ID).',
    })
  }
  const livenessRequired = requireDidit;
  /** Fila interna; el cliente puede mandar `id` (vendor_data) o el session_id de Didit del retorno. */
  let livenessRowId: string | null = null;
  if (livenessRequired) {
    if (!livenessToken) {
      return res.status(400).json({ message: "Falta completar la prueba de vida (Didit)." });
    }
    let ls = await prisma.livenessSession.findFirst({
      where: { OR: [{ id: livenessToken }, { diditSessionId: livenessToken }] },
    });
    if (ls && ls.status !== "APPROVED" && !ls.consumedAt && ls.diditSessionId) {
      await syncLivenessSessionFromDiditApi(ls.id);
      ls = await prisma.livenessSession.findUnique({ where: { id: ls.id } });
    }
    if (!ls || ls.status !== "APPROVED" || ls.consumedAt) {
      return res.status(400).json({ message: "Prueba de vida no válida o no aprobada. Iniciá el proceso otra vez." });
    }
    if (ls.expiresAt < new Date()) {
      return res.status(400).json({ message: "La prueba de vida venció. Iniciá una nueva sesión." });
    }
    if (ls.email && ls.email.toLowerCase() !== email.trim().toLowerCase()) {
      return res.status(400).json({ message: "El email de registro no coincide con el de la prueba de vida." });
    }
    livenessRowId = ls.id;
  }

  if (byEmail) return res.status(409).json({ message: "Email ya registrado" });
  if (byNational) return res.status(409).json({ message: "Cédula/Documento ya registrado" });
  if (nationalId && !isValidUruguayanCI(nationalId)) return res.status(400).json({ message: "Cédula inválida" });

  if (phone != null && String(phone).trim() !== "") {
    const normalizedPhone = normalizePhoneUY(phone);
    if (!normalizedPhone) {
      return res.status(400).json({
        message:
          "Celular inválido. Debe ser uruguayo: 9 dígitos empezando con 09 (sin cédula en este campo).",
      });
    }
  }

  let nationalIdDocumentExpiresAtDate: Date | undefined;
  try {
    nationalIdDocumentExpiresAtDate = validateNationalIdDocumentExpiresAtUpdate(nationalIdDocumentExpiresAt);
  } catch {
    return res.status(400).json({ message: "Vencimiento de documento inválido" });
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const registerRoleCode = normalizeOrgRoleCode(role || "STAFF");
  let registerRoleId: string;
  try {
    registerRoleId = await getOrgRoleIdByCodeOrThrow(registerRoleCode);
  } catch {
    return res.status(400).json({ message: "Rol inválido." });
  }
  const nowLv = livenessRequired && livenessRowId ? new Date() : null;
  const user = await prisma.$transaction(async (tx) => {
    const generatedUsername = await generateUniqueUsername(firstName, lastName, tx);
    const u = await tx.user.create({
      data: {
        email,
        passwordHash,
        username: generatedUsername,
        nationalId: nationalId ? onlyDigits(nationalId) : null,
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        phone: normalizePhoneUY(phone) ?? null,
        birthdate: birthdate ? new Date(birthdate) : null,
        nationalIdDocumentExpiresAt: nationalIdDocumentExpiresAtDate ?? null,
        roleId: registerRoleId,
        isApproved: false,
        approvedAt: null,
        isActive: true,
        livenessVerifiedAt: nowLv,
      },
    });
    if (livenessRequired && livenessRowId) {
      await tx.livenessSession.update({
        where: { id: livenessRowId },
        data: { consumedAt: new Date() },
      });
    }
    return u;
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

  const at = signAccessToken({ sub: user.id, email: user.email, role: registerRoleCode });
  setAuthCookie(res, at);
  const rt = crypto.randomBytes(40).toString("hex");
  await prisma.refreshToken.create({ data: { tokenHash: hashToken(rt), userId: user.id, expiresAt: new Date(Date.now() + parseDurationMs(process.env.REFRESH_TOKEN_TTL || "7d")) } });
  setRefreshCookie(res, rt);
  return res.json({ id: user.id, email: user.email, username: user.username, role: registerRoleCode });
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
    nationalIdDocumentExpiresAt: z.string().min(8).max(40).optional(),
    role: z.enum(["ADMIN","STAFF","TEACHER"]).optional(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Datos inválidos" });
  const { username, nationalId, firstName, lastName, phone, birthdate, nationalIdDocumentExpiresAt, role } = parsed.data;
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
      nationalIdDocumentExpiresAt,
      role,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return mapProfileUpdateError(error, res);
  }

  const pendingRoleCode = data.role as string | undefined;
  if ("role" in data) delete (data as Record<string, unknown>).role;
  if (pendingRoleCode !== undefined) {
    try {
      (data as Record<string, unknown>).roleId = await getOrgRoleIdByCodeOrThrow(normalizeOrgRoleCode(pendingRoleCode));
    } catch {
      return res.status(400).json({ message: "Rol inválido" });
    }
  }

  const updated = await prisma.user.update({ where: { id: u.sub }, data });
  return res.json({ ok: true, id: updated.id });
});

// Establecer contraseña si aún no tiene
r.put("/password", authGuard, async (req, res) => {
  const u = (req as any).user;
  const parsed = z.object({ password: strongPasswordSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: firstZodIssueMessage(parsed.error) });
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
  const parsed = z
    .object({ currentPassword: z.string().min(8).max(64), newPassword: strongPasswordSchema })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: firstZodIssueMessage(parsed.error) });
  const me = await prisma.user.findUnique({ where: { id: u.sub }, select: { passwordHash: true } });
  if (!me || !me.passwordHash) return res.status(409).json({ message: "No hay contraseña definida" });
  const ok = await argon2.verify(me.passwordHash, parsed.data.currentPassword);
  if (!ok) return res.status(401).json({ message: "Contraseña actual incorrecta" });
  const passwordHash = await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id });
  await prisma.user.update({ where: { id: u.sub }, data: { passwordHash } });
  return res.json({ ok: true });
});

r.post("/2fa/setup", authGuard, async (req, res) => {
  const u = (req as any).user;
  const me = await prisma.user.findUnique({ where: { id: u.sub }, select: { id: true, email: true, twoFactorEnabled: true } });
  if (!me) return res.status(401).json({ message: "No autorizado" });
  if (me.twoFactorEnabled) return res.status(409).json({ message: "La autenticación en dos pasos ya está activa" });

  const secret = generateSecret();
  const issuer = process.env.TWO_FACTOR_ISSUER || "EduTrack";
  const otpauthUrl = generateURI({ issuer, label: me.email, secret });
  const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
  await prisma.$transaction(async (tx: any) => {
    await tx.user.update({
      where: { id: me.id },
      data: { twoFactorSecret: encryptTwoFactorSecret(secret), twoFactorConfirmedAt: null },
    });
    await tx.twoFactorBackupCode.deleteMany({ where: { userId: me.id } });
  });
  return res.json({ qrCodeDataUrl, otpauthUrl, manualEntryKey: secret, issuer, accountName: me.email });
});

r.post("/2fa/confirm", authGuard, async (req, res) => {
  const u = (req as any).user;
  const parsed = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Código inválido" });

  const me = await prisma.user.findUnique({
    where: { id: u.sub },
    select: { id: true, twoFactorEnabled: true, twoFactorSecret: true },
  });
  if (!me) return res.status(401).json({ message: "No autorizado" });
  if (me.twoFactorEnabled) return res.status(409).json({ message: "La autenticación en dos pasos ya está activa" });
  if (!me.twoFactorSecret) return res.status(400).json({ message: "Primero inicia la configuración de 2FA" });

  const secret = decryptTwoFactorSecret(me.twoFactorSecret);
  if (!verifyTotpCode(parsed.data.code, secret)) return res.status(401).json({ message: "Código inválido" });

  const backupCodes = await prisma.$transaction(async (tx: any) => {
    await tx.user.update({
      where: { id: me.id },
      data: {
        twoFactorEnabled: true,
        twoFactorConfirmedAt: new Date(),
      },
    });
    return replaceBackupCodesForUser(me.id, tx);
  });
  return res.json({ ok: true, backupCodes });
});

r.post("/2fa/disable", authGuard, async (req, res) => {
  const u = (req as any).user;
  const parsed = z.object({ password: z.string().min(1).optional(), code: z.string().trim().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Datos inválidos" });

  const me = await prisma.user.findUnique({
    where: { id: u.sub },
    select: { id: true, passwordHash: true, twoFactorEnabled: true, twoFactorSecret: true },
  });
  if (!me) return res.status(401).json({ message: "No autorizado" });
  if (!me.twoFactorEnabled) return res.status(409).json({ message: "La autenticación en dos pasos no está activa" });

  let verified = false;
  if (parsed.data.password && me.passwordHash) verified = await argon2.verify(me.passwordHash, parsed.data.password);
  if (!verified && parsed.data.code && me.twoFactorSecret) {
    const code = parsed.data.code.trim();
    if (/^\d{6}$/.test(code)) verified = verifyTotpCode(code, decryptTwoFactorSecret(me.twoFactorSecret));
    else if (/^[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(code)) verified = await consumeBackupCodeForUser(me.id, code);
  }
  if (!verified) return res.status(401).json({ message: "Verificación inválida" });

  await prisma.$transaction(async (tx: any) => {
    await tx.user.update({
      where: { id: me.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorConfirmedAt: null },
    });
    await tx.twoFactorBackupCode.deleteMany({ where: { userId: me.id } });
  });
  return res.json({ ok: true });
});

r.post("/2fa/backup-codes/regenerate", authGuard, async (req, res) => {
  const u = (req as any).user;
  const parsed = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Código inválido" });
  const me = await prisma.user.findUnique({ where: { id: u.sub }, select: { id: true, twoFactorEnabled: true, twoFactorSecret: true } });
  if (!me) return res.status(401).json({ message: "No autorizado" });
  if (!me.twoFactorEnabled || !me.twoFactorSecret) return res.status(409).json({ message: "La autenticación en dos pasos no está activa" });
  if (!verifyTotpCode(parsed.data.code, decryptTwoFactorSecret(me.twoFactorSecret))) return res.status(401).json({ message: "Código inválido" });
  const backupCodes = await replaceBackupCodesForUser(me.id);
  return res.json({ backupCodes });
});

// Login
r.post("/login", createIpRateLimit(60 * 1000, 10), async (req, res) => {
  clearAuthCookies(res);
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
    include: { orgRole: { select: { code: true } } },
  });
  if (!user || !user.passwordHash) {
    recordAuditEvent({
      action: AuditAction.AUTH_LOGIN_FAILURE,
      req,
      metadata: { reason: "UNKNOWN_IDENTIFIER_OR_NO_PASSWORD" },
    });
    return res.status(401).json({ message: "Credenciales" });
  }
  if (!user.isActive) {
    recordAuditEvent({
      action: AuditAction.AUTH_LOGIN_FAILURE,
      actorUserId: user.id,
      req,
      metadata: { reason: "ACCOUNT_INACTIVE" },
    });
    return res.status(403).json({ message: "Cuenta desactivada" });
  }

  if (user.lockUntil && user.lockUntil > new Date()) {
    recordAuditEvent({
      action: AuditAction.AUTH_LOGIN_FAILURE,
      actorUserId: user.id,
      req,
      metadata: { reason: "ACCOUNT_LOCKED" },
    });
    return res.status(429).json({ message: "Cuenta bloqueada temporalmente. Intenta más tarde" });
  }

  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) {
    await registerFailedLogin(user.id);
    recordAuditEvent({
      action: AuditAction.AUTH_LOGIN_FAILURE,
      actorUserId: user.id,
      req,
      metadata: { reason: "INVALID_PASSWORD" },
    });
    return res.status(401).json({ message: "Credenciales" });
  }

  const roleCode = user.orgRole?.code ?? "";
  if (user.twoFactorEnabled) {
    recordAuditEvent({
      action: AuditAction.AUTH_LOGIN_SUCCESS,
      actorUserId: user.id,
      req,
      metadata: { requiresTwoFactor: true },
    });
    return res.json({
      requiresTwoFactor: true,
      twoFactorToken: signTwoFactorLoginToken({ sub: user.id, email: user.email, role: roleCode }),
      email: user.email,
    });
  }

  await registerSuccessfulLogin(user.id);

  recordAuditEvent({
    action: AuditAction.AUTH_LOGIN_SUCCESS,
    actorUserId: user.id,
    req,
  });

  await issueSessionCookies(res, req, { id: user.id, email: user.email, role: roleCode });
  return res.json({ id: user.id, email: user.email, name: user.name, role: roleCode });
});

r.post("/login/2fa", createIpRateLimit(60 * 1000, 10), async (req, res) => {
  clearAuthCookies(res);
  const parsed = z.object({ twoFactorToken: z.string().min(20), code: twoFactorCodeSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Datos inválidos" });

  let payload: ReturnType<typeof verifyTwoFactorLoginToken>;
  try {
    payload = verifyTwoFactorLoginToken(parsed.data.twoFactorToken);
  } catch {
    return res.status(401).json({ message: "Token inválido" });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { orgRole: { select: { code: true } } },
  });
  if (!user || !user.isActive) return res.status(401).json({ message: "No autorizado" });
  if (!user.twoFactorEnabled || !user.twoFactorSecret) return res.status(409).json({ message: "La autenticación en dos pasos no está activa" });

  const code = parsed.data.code.trim();
  let ok = false;
  if (/^\d{6}$/.test(code)) {
    ok = verifyTotpCode(code, decryptTwoFactorSecret(user.twoFactorSecret));
  } else {
    ok = await consumeBackupCodeForUser(user.id, code);
  }
  if (!ok) {
    recordAuditEvent({
      action: AuditAction.AUTH_LOGIN_FAILURE,
      actorUserId: user.id,
      req,
      metadata: { reason: "INVALID_2FA_CODE" },
    });
    return res.status(401).json({ message: "Código inválido" });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockUntil: null,
      },
    }),
  ]);
  await issueSessionCookies(res, req, { id: user.id, email: user.email, role: user.orgRole?.code ?? "" });
  recordAuditEvent({ action: AuditAction.AUTH_LOGIN_SUCCESS, actorUserId: user.id, req, metadata: { twoFactor: true } });
  return res.json({ id: user.id, email: user.email, name: user.name, role: user.orgRole?.code ?? "" });
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
      logTurnstileDebug("[TURNSTILE] verifying", { host: req.headers.host, origin: req.headers.origin });
      const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: captchaToken }),
      });
      const data = await resp.json();
      logTurnstileDebug("[TURNSTILE] verify response", { status: resp.status, success: data?.success, "error-codes": data?.["error-codes"], hostname: data?.hostname });
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

// Reset password (tras éxito: misma sesión que login — evita volver a escribir la clave)
r.post("/reset", async (req, res) => {
  const parsed = z.object({ token: z.string().min(10), password: strongPasswordSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: firstZodIssueMessage(parsed.error) });
  const { token, password } = parsed.data;

  const pr = await prisma.passwordReset.findUnique({ where: { token } });
  if (!pr || pr.usedAt || pr.expiresAt < new Date()) return res.status(400).json({ message: "Token inválido" });

  const user = await prisma.user.findUnique({
    where: { id: pr.userId },
    select: {
      id: true,
      email: true,
      name: true,
      isActive: true,
      twoFactorEnabled: true,
      orgRole: { select: { code: true } },
    },
  });
  if (!user) return res.status(400).json({ message: "Token inválido" });
  if (!user.isActive) return res.status(403).json({ message: "Cuenta desactivada" });

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.$transaction([
    prisma.user.update({ where: { id: pr.userId }, data: { passwordHash } }),
    prisma.passwordReset.update({ where: { token }, data: { usedAt: new Date() } }),
  ]);

  const resetRoleCode = user.orgRole?.code ?? "";
  if (user.twoFactorEnabled) {
    return res.json({
      requiresTwoFactor: true,
      twoFactorToken: signTwoFactorLoginToken({ sub: user.id, email: user.email, role: resetRoleCode }),
      email: user.email,
    });
  }
  await registerSuccessfulLogin(user.id);
  await issueSessionCookies(res, req, { id: user.id, email: user.email, role: resetRoleCode });
  return res.json({ id: user.id, email: user.email, name: user.name, role: resetRoleCode });
});

// Perfil con needsProfileCompletion
r.get("/me", authGuard, async (req, res) => {
  const u = (req as any).user;
  const raw = await prisma.user.findUnique({
    where: { id: u.sub },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerifiedAt: true,
      username: true,
      nationalId: true,
      nationalIdDocumentExpiresAt: true,
      firstName: true,
      lastName: true,
      phone: true,
      birthdate: true,
      passwordHash: true,
      isApproved: true,
      approvedAt: true,
      isActive: true,
      twoFactorEnabled: true,
      orgRole: { select: { code: true } },
    },
  });
  if (!raw) return res.status(401).json({ message: "No autorizado" });
  const roleCode = raw.orgRole?.code ?? "";
  const needsProfileCompletion = !raw.firstName || !raw.lastName || !raw.nationalId || !raw.birthdate || !raw.username;
  const hasPassword = !!raw.passwordHash;
  try {
    await ensureDefaultProfilePermissionsIfNeeded();
  } catch (error) {
    console.warn("[auth/me] permissions bootstrap skipped", error);
  }
  const permissions = await enabledPermissionsForRole(roleCode);
  const canShowNav =
    Boolean(raw.isApproved && raw.isActive && !needsProfileCompletion);
  const navLinks = canShowNav
    ? NAV_LINKS_BY_ROLE[roleCode] || []
    : [];
  const { passwordHash, orgRole, ...safe } = raw as any;
  res.json({
    ...safe,
    role: roleCode,
    needsProfileCompletion,
    hasPassword,
    navLinks,
    permissions,
    permissionIds: permissions.map((permission) => permission.id),
  });
});

r.post("/logout", async (req, res) => {
  let actorId: string | null = null;
  const accessTok = (req as any).cookies?.access_token as string | undefined;
  if (accessTok) {
    try {
      const payload = verifyToken(accessTok);
      actorId = payload.sub ?? null;
    } catch {
      /* cookie inválida: igual cerramos sesión */
    }
  }
  recordAuditEvent({
    action: AuditAction.AUTH_LOGOUT,
    actorUserId: actorId,
    req,
  });

  const rt = (req as any).cookies?.refresh_token as string | undefined;
  if (rt) {
    try {
      const hashed = hashToken(rt);
      await prisma.refreshToken.updateMany({ where: { tokenHash: hashed, revokedAt: null }, data: { revokedAt: new Date() } });
    } catch {}
  }
  clearAuthCookies(res);
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
      clearAuthCookies(res);
      return res.redirect(process.env.FRONTEND_URL! + "/login?error=inactive");
    }
    if (!user.emailVerifiedAt) {
      try { await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }); } catch {}
    }
    const oauthUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { orgRole: { select: { code: true } } },
    });
    const oauthRoleCode = oauthUser?.orgRole?.code ?? "STAFF";
    const needsProfileCompletion = !oauthUser?.firstName || !oauthUser?.lastName || !oauthUser?.nationalId || !oauthUser?.birthdate || !oauthUser?.username;
    if (oauthUser?.twoFactorEnabled) {
      const twoFactorToken = signTwoFactorLoginToken({ sub: user.id, email: user.email, role: oauthRoleCode });
      recordAuditEvent({
        action: AuditAction.AUTH_GOOGLE_LOGIN_SUCCESS,
        actorUserId: user.id,
        req,
        metadata: { needsProfileCompletion, requiresTwoFactor: true },
      });
      return res.redirect(
        `${process.env.FRONTEND_URL!}/login?twoFactorToken=${encodeURIComponent(twoFactorToken)}&email=${encodeURIComponent(user.email)}`,
      );
    }
    await issueSessionCookies(res, req, { id: user.id, email: user.email, role: oauthRoleCode });
    recordAuditEvent({
      action: AuditAction.AUTH_GOOGLE_LOGIN_SUCCESS,
      actorUserId: user.id,
      req,
      metadata: { needsProfileCompletion },
    });
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

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    include: { orgRole: { select: { code: true } } },
  });
  if (!user) return res.status(401).json({ message: "No autorizado" });
  if (!user.isActive) return res.status(403).json({ message: "Cuenta desactivada" });

  const refreshRoleCode = user.orgRole?.code ?? "";
  const at = signAccessToken({ sub: user.id, email: user.email, role: refreshRoleCode });
  setAuthCookie(res, at);
  setRefreshCookie(res, newRt);
  return res.json({ ok: true });
});

export default r;
