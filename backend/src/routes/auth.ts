import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../db/prisma.js";
import { authGuard } from "../middlewares/auth.js";
import { onlyDigits, isValidUruguayanCI } from "../identity/uruguay-ci.js";
import {
  normalizePhoneUY,
  buildProfileName,
  validateRoleUpdate,
  validatePhoneUpdate,
  validateBirthdateUpdate,
  mapProfileUpdateError,
} from "../auth/auth-profile-pure.js";
import { firstZodIssueMessage, strongPasswordSchema } from "../auth/password-policy.js";
import { getOrgRoleIdByCodeOrThrow, normalizeOrgRoleCode } from "../identity/org-role-service.js";
import {
  createKeycloakUser,
  freeKeycloakUsernameIfOrphan,
  logoutKeycloakUserSessions,
  syncKeycloakUserIdentity,
  syncRegisteredSsoUser,
} from "../auth/keycloak.js";
import { consumeSsoRegistration, getSsoRegistration } from "../auth/sso-registration.js";
import { linkKeycloakAccount } from "../auth/keycloak-provisioning.js";
import { getSession, newSessionId, saveSession } from "../auth/session-store.js";
import { sendVerificationEmail, VERIFY_RESEND_COOLDOWN_SECONDS } from "../auth/email-verification.js";
import { USERNAME_REGEX, usernameSchema } from "../auth/account-validation.js";
import { generateUniqueUsername as generateUniqueUsernameWith } from "../services/usernames.js";

const r = Router();

function performanceAuthEnabled(): boolean {
  return (process.env.EDUTRACK_PERFORMANCE_AUTH_ENABLED || "").toLowerCase() === "true";
}

function performanceAuthSecret(): string {
  return process.env.EDUTRACK_PERFORMANCE_AUTH_SECRET || "";
}

function readPerformanceSecret(req: any): string {
  const header = req.get?.("x-edutrack-performance-secret");
  if (typeof header === "string") return header;
  const bodySecret = req.body?.secret;
  return typeof bodySecret === "string" ? bodySecret : "";
}

function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function performanceSessionTtlMs(): number {
  const minutes = Number(process.env.EDUTRACK_PERFORMANCE_SESSION_TTL_MINUTES || "30");
  return Math.max(5, Math.min(Number.isFinite(minutes) ? minutes : 30, 120)) * 60 * 1000;
}

function readPerformanceIdentifier(req: any): string {
  const identifier = req.body?.identifier ?? req.body?.email ?? req.body?.username;
  return typeof identifier === "string" ? identifier.trim() : "";
}

const registerSchema = z.object({
  email: z.string().email(),
  // El alta con Google no muestra el campo de contraseña, y el formulario manda la cadena vacía.
  // Sin esto, `strongPasswordSchema` la rechaza y el usuario recibe "la contraseña debe tener..."
  // sobre un campo que no existe en pantalla.
  password: z.preprocess((value) => (value === "" ? undefined : value), strongPasswordSchema.optional()),
  nationalId: z.string().min(6).max(20).optional(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  phone: z.string().min(7).max(20).optional(),
  birthdate: z.string().datetime().optional(),
  // Los perfiles que puede pedir quien se registra solo. Administrador nunca: lo asigna un admin.
  role: z.enum(["STAFF", "TEACHER", "ADSCRIPTO", "DIRECCION"]).optional(),
  ssoRegistrationToken: z.string().min(20).max(128).optional(),
});

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function handleRegisterUnexpectedError(error: unknown, res: any) {
  console.error("[register] unexpected:", error);
  if (res.headersSent) return undefined;

  const code = errorCode(error);
  if (code === "P2002") {
    return res.status(409).json({ message: "Ese correo, usuario o cédula ya está registrado." });
  }
  if (code === "P2003" || errorMessage(error).startsWith("ROLE_NOT_FOUND:")) {
    return res.status(400).json({ message: "Rol inválido." });
  }
  if (code === "P2025") {
    return res.status(400).json({ message: "La sesión de verificación ya no está disponible. Iniciá el proceso otra vez." });
  }

  return res.status(500).json({
    message: "No se pudo completar el registro. Revisá los datos e intentá nuevamente.",
  });
}

async function enabledPermissionsForRole(roleCode: string) {
  if (!roleCode) return [];
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

async function generateUniqueUsername(firstName: string, lastName: string, client: any = prisma) {
  // Unicidad SOLO contra usuarios reales de la app. Un username que solo exista en Keycloak
  // (cuenta huérfana) NO bloquea el nombre limpio: ese huérfano se borra antes de crear (ver
  // freeKeycloakUsernameIfOrphan). Así "lucia.fernandez" se reusa en vez de saltar a ".p".
  return generateUniqueUsernameWith(firstName, lastName, async (candidate) => {
    const existing = await client.user.findUnique({ where: { username: candidate }, select: { id: true } });
    return Boolean(existing);
  });
}

async function validateUniqueUsername(userId: string, username?: string) {
  if (!username) return undefined;
  const exist = await prisma.user.findUnique({ where: { username } });
  if (exist && exist.id !== userId) throw new Error("USERNAME_CONFLICT");
  return username;
}

async function validateUniqueEmail(userId: string, email?: string) {
  if (!email) return undefined;
  const normalized = email.trim().toLowerCase();
  const parsed = z.string().email().safeParse(normalized);
  if (!parsed.success) throw new Error("INVALID_EMAIL");
  const exist = await prisma.user.findUnique({ where: { email: normalized } });
  if (exist && exist.id !== userId) throw new Error("EMAIL_CONFLICT");
  return normalized;
}

async function validateNationalIdUpdate(
  userId: string,
  nationalId: string | undefined,
  isAdmin: boolean,
  isSettingInitialNationalId: boolean,
) {
  if (!nationalId) return undefined;
  if (!isValidUruguayanCI(nationalId)) throw new Error("INVALID_CI");
  const normCi = onlyDigits(nationalId);
  const existCi = await prisma.user.findUnique({ where: { nationalId: normCi } });
  if (existCi && existCi.id !== userId) throw new Error("CI_CONFLICT");
  if (!isAdmin && !isSettingInitialNationalId) throw new Error("FORBIDDEN");
  return normCi;
}

async function validateAndBuildProfileUpdate(data: {
  userId: string;
  userRole: string;
  email?: string;
  username?: string;
  nationalId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  birthdate?: string;
  role?: "ADMIN" | "STAFF" | "TEACHER";
}) {
  const update: Record<string, unknown> = {};
  const me = await prisma.user.findUnique({ where: { id: data.userId } });
  if (!me) throw new Error("NOT_FOUND");
  const isAdmin = data.userRole === "ADMIN";
  const isSettingInitialNationalId = !me?.nationalId;

  const email = await validateUniqueEmail(data.userId, data.email);
  if (email !== undefined && email !== me.email) {
    update.email = email;
    update.emailVerifiedAt = null;
  }

  const username = await validateUniqueUsername(data.userId, data.username);
  if (username !== undefined) update.username = username;

  const nationalId = await validateNationalIdUpdate(
    data.userId,
    data.nationalId,
    isAdmin,
    isSettingInitialNationalId,
  );
  if (nationalId !== undefined) update.nationalId = nationalId;

  const role = validateRoleUpdate(data.role, isAdmin, me);
  if (role !== undefined) update.role = role;

  if (data.firstName) update.firstName = data.firstName;
  if (data.lastName) update.lastName = data.lastName;
  if (data.firstName || data.lastName) {
    update.name = buildProfileName(
      data.firstName ?? me.firstName ?? undefined,
      data.lastName ?? me.lastName ?? undefined,
    );
  }

  const phone = validatePhoneUpdate(data.phone);
  if (phone !== undefined) update.phone = phone;

  const birthdate = validateBirthdateUpdate(data.birthdate);
  if (birthdate !== undefined) update.birthdate = birthdate;

  return update;
}

r.get("/check-username", async (req, res) => {
  const u = String(req.query.u || "").trim();
  const valid = USERNAME_REGEX.test(u);
  if (!valid) return res.json({ available: false, valid: false });
  const exist = await prisma.user.findUnique({ where: { username: u } });
  return res.json({ available: !exist, valid: true });
});

r.post("/performance/session", async (req, res) => {
  if (!performanceAuthEnabled()) {
    return res.status(404).json({ message: "No encontrado" });
  }

  const expectedSecret = performanceAuthSecret();
  if (!constantTimeEqual(readPerformanceSecret(req), expectedSecret)) {
    return res.status(403).json({ message: "Prohibido" });
  }

  const identifier = readPerformanceIdentifier(req);
  if (!identifier || identifier.length > 255) {
    return res.status(400).json({ message: "Usuario de performance invalido" });
  }

  const normalizedEmail = identifier.toLowerCase();
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: normalizedEmail },
        { username: identifier },
      ],
    },
    select: {
      id: true,
      email: true,
      googleId: true,
      isActive: true,
      isApproved: true,
      lockUntil: true,
      orgRole: { select: { code: true, active: true } },
    },
  });

  if (!user || !user.isActive || !user.isApproved || !user.orgRole?.active) {
    return res.status(403).json({ message: "Usuario de performance no habilitado" });
  }
  if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
    return res.status(403).json({ message: "Usuario de performance bloqueado" });
  }

  const sid = newSessionId();
  const now = Date.now();
  await saveSession({
    sid,
    userId: user.id,
    kcId: user.googleId || `performance:${user.id}`,
    email: user.email,
    role: user.orgRole.code,
    accessToken: "performance-baseline",
    accessTokenExpiresAt: now + performanceSessionTtlMs(),
    createdAt: now,
  });

  return res.json({
    ok: true,
    sid,
    user: {
      id: user.id,
      email: user.email,
      role: user.orgRole.code,
    },
  });
});

r.get("/register/sso", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const profile = await getSsoRegistration(token);
  if (!profile) return res.status(404).json({ message: "Registro con Google vencido o inválido." });
  return res.json({
    email: profile.email,
    username: profile.username ?? "",
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
    name: profile.name ?? "",
    emailLocked: true,
    provider: "google",
  });
});

r.post("/register", async (req, res) => {
  try {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: firstZodIssueMessage(parsed.error) });

  const {
    email,
    password,
    nationalId,
    firstName,
    lastName,
    phone,
    birthdate,
    role,
    ssoRegistrationToken,
  } = parsed.data;

  const ssoProfile = ssoRegistrationToken ? await getSsoRegistration(ssoRegistrationToken) : null;
  if (ssoRegistrationToken && !ssoProfile) {
    return res.status(400).json({ message: "El registro con Google venció. Iniciá nuevamente con Google." });
  }
  if (!ssoProfile && !password) {
    return res.status(400).json({ message: "La contraseña es obligatoria." });
  }
  if (ssoProfile && ssoProfile.email.toLowerCase() !== email.trim().toLowerCase()) {
    return res.status(400).json({ message: "El correo de registro no coincide con la cuenta de Google." });
  }

  const [byEmail, byNational] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    nationalId ? prisma.user.findUnique({ where: { nationalId: onlyDigits(nationalId) } }) : Promise.resolve(null),
  ]);
  // Sin prueba de vida: la identidad la controla administración, que aprueba cada cuenta nueva
  // (se crea con `isApproved: false` y no puede entrar hasta entonces).
  const canCompleteSsoPlaceholder =
    Boolean(ssoProfile && byEmail && byEmail.isActive && !byEmail.isApproved);
  if (byEmail && !canCompleteSsoPlaceholder) return res.status(409).json({ message: "Correo ya registrado" });
  if (byNational && (!canCompleteSsoPlaceholder || byNational.id !== byEmail?.id)) {
    return res.status(409).json({ message: "Cédula/Documento ya registrado" });
  }
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

  const registerRoleCode = normalizeOrgRoleCode(role || "STAFF");
  let registerRoleId: string;
  try {
    registerRoleId = await getOrgRoleIdByCodeOrThrow(registerRoleCode);
  } catch {
    return res.status(400).json({ message: "Rol inválido." });
  }

  // El username se genera ANTES de la transacción: chequea unicidad contra la app y contra
  // Keycloak (I/O de red), que no debe correr dentro de un $transaction.
  const generatedUsername = byEmail?.username || (await generateUniqueUsername(firstName, lastName));
  const user = await prisma.$transaction(async (tx) => {
    const userData = {
      email,
      username: generatedUsername,
      nationalId: nationalId ? onlyDigits(nationalId) : null,
      googleId: ssoProfile?.kcId ?? null,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`,
      phone: normalizePhoneUY(phone) ?? null,
      birthdate: birthdate ? new Date(birthdate) : null,
      roleId: registerRoleId,
      isApproved: false,
      approvedAt: null,
      isActive: true,
      emailVerifiedAt: ssoProfile?.emailVerified ? new Date() : null,
    };
    const u = canCompleteSsoPlaceholder && byEmail
      ? await tx.user.update({
        where: { id: byEmail.id },
        data: userData,
      })
      : await tx.user.create({
        data: userData,
      });
    return u;
  });

  // Keycloak primero (crítico: sin la cuenta en el IdP el usuario no puede loguear).
  // Si falla, respondemos 503 antes de enviar ningún correo. No 502: Cloudflare cambia los 502/504
  // del origen por su propia página, sin CORS, y el front sólo vería "No se pudo conectar con la API".
  try {
    if (ssoProfile) {
      await syncRegisteredSsoUser({
        kcId: ssoProfile.kcId,
        email,
        username: user.username,
        firstName,
        lastName,
        role: registerRoleCode,
        emailVerified: ssoProfile.emailVerified,
      });
      await linkKeycloakAccount(user.id, ssoProfile.kcId);
      if (ssoRegistrationToken) await consumeSsoRegistration(ssoRegistrationToken);
      // La sesión de Google en Keycloak sigue abierta: el próximo login entraría sin preguntar y
      // mostraría otra vez "espera aprobación". Si no se puede cerrar, el alta vale igual.
      await logoutKeycloakUserSessions(ssoProfile.kcId).catch((error) =>
        console.warn("[register] no se pudo cerrar la sesión de Keycloak:", error),
      );
    } else {
      // Si el username quedó ocupado en Keycloak por una cuenta huérfana (sin usuario en la app),
      // la borramos para usar el nombre limpio (no se crean ni se toleran huérfanos).
      await freeKeycloakUsernameIfOrphan(user.username, async (mail) =>
        Boolean(await prisma.user.findUnique({ where: { email: mail }, select: { id: true } })),
      );
      const kcId = await createKeycloakUser({
        email,
        username: user.username,
        firstName,
        lastName,
        password,
        role: registerRoleCode,
        emailVerified: false,
      });
      await linkKeycloakAccount(user.id, kcId);
    }
  } catch (e) {
    // Atomicidad: si Keycloak falla y nosotros creamos el usuario (no era un placeholder SSO
    // preexistente), lo borramos para no dejar una cuenta huérfana sin acceso.
    if (!canCompleteSsoPlaceholder) {
      await prisma.user
        .delete({ where: { id: user.id } })
        .catch((delErr) => console.error("[register] rollback usuario tras fallo Keycloak:", delErr));
    }
    const usernameTakenInKc = e instanceof Error && (e as { code?: string }).code === "KEYCLOAK_USERNAME_TAKEN";
    console.error("[register] keycloak create user:", e);
    return res.status(usernameTakenInKc ? 409 : 503).json({
      message: usernameTakenInKc
        ? "No pudimos generar tu acceso por un conflicto de nombre de usuario. Probá de nuevo o contactá al administrador."
        : "No se pudo activar el acceso de la cuenta.",
    });
  }

  // Correo de verificación: best-effort y en segundo plano. No bloquea la respuesta,
  // así un SMTP lento/caído no cuelga el registro (causa de cortes 502/CORS en prod).
  // Si no llega, la pantalla de registro ofrece reenviarlo (`/verify/request`).
  const emailVerificationRequired = !ssoProfile?.emailVerified;
  if (emailVerificationRequired) {
    void sendVerificationEmail({ id: user.id, email }, { pendingApproval: true, ignoreCooldown: true }).catch((e) =>
      console.error("SMTP send error (verify):", e),
    );
  }

  return res.json({
    id: user.id,
    email: user.email,
    username: user.username,
    role: registerRoleCode,
    emailVerificationRequired,
  });
  } catch (error) {
    return handleRegisterUnexpectedError(error, res);
  }
});

r.post("/verify", async (req, res) => {
  const parsed = z.object({ token: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Datos inválidos" });
  const { token } = parsed.data;
  const ev = await prisma.emailVerification.findUnique({ where: { token } });
  if (!ev || ev.usedAt || ev.expiresAt < new Date()) return res.status(400).json({ message: "Token inválido" });
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: ev.userId }, data: { emailVerifiedAt: new Date() }, select: { isApproved: true } }),
    prisma.emailVerification.update({ where: { token }, data: { usedAt: new Date() } }),
  ]);
  // Verificar no habilita el acceso: la pantalla le dice que ahora falta la aprobación.
  return res.json({ ok: true, pendingApproval: !user?.isApproved });
});

r.post("/verify/resend", authGuard, async (req, res) => {
  const u = (req as any).user;
  const user = await prisma.user.findUnique({ where: { id: u.sub } });
  if (!user) return res.json({ ok: true });
  if (user.emailVerifiedAt) return res.json({ ok: true });

  try {
    await sendVerificationEmail(user, { pendingApproval: !user.isApproved });
  } catch (e) {
    console.error("SMTP send error (resend verify):", e);
  }
  return res.json({ ok: true, cooldownSeconds: VERIFY_RESEND_COOLDOWN_SECONDS });
});

/** Quién pide el reenvío: la sesión si la hay (cuenta todavía sin aprobar), si no el email del form. */
async function findVerificationRequester(req: any) {
  const select = { id: true, email: true, emailVerifiedAt: true, isApproved: true, isActive: true } as const;
  const sid = req.cookies?.sid as string | undefined;
  const session = sid ? await getSession(sid) : null;
  if (session) return prisma.user.findUnique({ where: { id: session.userId }, select });

  const parsed = z.object({ email: z.string().trim().email().max(200) }).safeParse(req.body);
  if (!parsed.success) return null;
  return prisma.user.findFirst({ where: { email: { equals: parsed.data.email, mode: "insensitive" } }, select });
}

/**
 * Reenvío del enlace de verificación sin estar aprobado. `/verify/resend` exige `authGuard`, que
 * rechaza a las cuentas pendientes: justo quien acaba de registrarse y no recibió el correo no
 * tenía cómo pedir otro. Responde siempre lo mismo, exista o no la cuenta, para no revelar qué
 * correos están registrados.
 */
r.post("/verify/request", async (req, res) => {
  try {
    const user = await findVerificationRequester(req);
    if (user?.isActive && !user.emailVerifiedAt) {
      await sendVerificationEmail(user, { pendingApproval: !user.isApproved });
    }
  } catch (e) {
    console.error("[auth/verify/request]", e);
  }
  return res.json({ ok: true, cooldownSeconds: VERIFY_RESEND_COOLDOWN_SECONDS });
});

r.put("/profile", authGuard, async (req, res) => {
  const u = (req as any).user;
  const bodySchema = z.object({
    email: z.string().email().optional(),
    username: usernameSchema.optional(),
    nationalId: z.string().min(6).max(20).optional(),
    firstName: z.string().min(1).max(80).optional(),
    lastName: z.string().min(1).max(80).optional(),
    phone: z.string().min(7).max(20).optional(),
    birthdate: z.string().min(8).max(32).optional(),
    role: z.enum(["ADMIN", "STAFF", "TEACHER"]).optional(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: firstZodIssueMessage(parsed.error) });

  let data: Record<string, unknown>;
  try {
    data = await validateAndBuildProfileUpdate({
      userId: u.sub,
      userRole: u.role,
      ...parsed.data,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return mapProfileUpdateError(error, res);
  }

  const pendingRoleCode = data.role as string | undefined;
  if ("role" in data) delete data.role;
  if (pendingRoleCode !== undefined) {
    try {
      data.roleId = await getOrgRoleIdByCodeOrThrow(normalizeOrgRoleCode(pendingRoleCode));
    } catch {
      return res.status(400).json({ message: "Rol inválido" });
    }
  }

  if (typeof data.email === "string") {
    const session = (req as any).bffSession as { kcId?: string } | undefined;
    if (session?.kcId) {
      try {
        await syncKeycloakUserIdentity({ kcId: session.kcId, email: data.email, emailVerified: false });
      } catch (error) {
        console.error("[profile] no se pudo sincronizar correo:", error);
        return res.status(502).json({ message: "No se pudo actualizar el correo de acceso." });
      }
    }
  }

  const updated = await prisma.user.update({ where: { id: u.sub }, data });
  const session = (req as any).bffSession as { email?: string } | undefined;
  if (session && typeof data.email === "string") {
    session.email = data.email;
    await saveSession(session as Parameters<typeof saveSession>[0]).catch((error) => {
      console.warn("[profile] no se pudo actualizar el correo de la sesión:", error);
    });
  }
  return res.json({ ok: true, id: updated.id });
});

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
      isApproved: true,
      approvedAt: true,
      isActive: true,
      orgRole: { select: { code: true, label: true } },
    },
  });
  if (!raw) return res.status(401).json({ message: "No autorizado" });
  const roleCode = raw.orgRole?.code ?? "";
  const roleLabel = raw.orgRole?.label ?? null;
  const needsProfileCompletion =
    !raw.firstName || !raw.lastName || !raw.nationalId || !raw.birthdate || !raw.username;
  // El seed de permisos por rol vive en el arranque del servidor y en los seeds;
  // no se hace acá para no escribir en BD en cada carga de página autenticada.
  const permissions = await enabledPermissionsForRole(roleCode);
  const { orgRole, ...safe } = raw as typeof raw & { orgRole?: { code: string } };
  res.json({
    ...safe,
    role: roleCode,
    roleLabel,
    needsProfileCompletion,
    permissions,
    permissionIds: permissions.map((permission) => permission.id),
  });
});

export default r;
