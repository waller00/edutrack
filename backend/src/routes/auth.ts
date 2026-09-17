import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../db/prisma.js";
import { authGuard } from "../middlewares/auth.js";
import { sendMail } from "../notifications/email.js";
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
import { isDiditConfigured, isLivenessRequiredForRegistration } from "../config/system-settings.js";
import { syncLivenessSessionFromDiditApi, fetchDiditDecisionJson } from "../integrations/didit/sync-session.js";
import { getDocumentExpiryValidationErrorFromDecision } from "../integrations/didit/register-verification-from-decision.js";
import { getOrgRoleIdByCodeOrThrow, normalizeOrgRoleCode } from "../identity/org-role-service.js";
import { createKeycloakUser, freeKeycloakUsernameIfOrphan, syncKeycloakUserIdentity, syncRegisteredSsoUser } from "../auth/keycloak.js";
import { consumeSsoRegistration, getSsoRegistration } from "../auth/sso-registration.js";
import { newSessionId, saveSession } from "../auth/session-store.js";
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
  password: strongPasswordSchema.optional(),
  nationalId: z.string().min(6).max(20).optional(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  phone: z.string().min(7).max(20).optional(),
  birthdate: z.string().datetime().optional(),
  role: z.enum(["ADMIN", "STAFF", "TEACHER"]).optional(),
  livenessToken: z.string().uuid().optional(),
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
  // freeKeycloakUsernameIfOrphan). Así "joaquin.waller" se reusa en vez de saltar a ".p".
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

r.get("/registration-options", async (_req, res) => {
  const livenessRequired = isLivenessRequiredForRegistration();
  return res.json({
    livenessCheckEnabled: livenessRequired,
    diditConfigured: isDiditConfigured(),
  });
});

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
    livenessToken,
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
  const requireDidit = isLivenessRequiredForRegistration();
  if (requireDidit && !isDiditConfigured()) {
    return res.status(503).json({
      message:
        "El registro con verificación de identidad no está disponible: el servidor no tiene configurado Didit (DIDIT_API_KEY y DIDIT_WORKFLOW_ID).",
    });
  }
  const livenessRequired = requireDidit;
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
    const diditId = ls.diditSessionId?.trim();
    if (!diditId) {
      return res.status(400).json({ message: "Sesión Didit incompleta. Reiniciá la verificación." });
    }
    const decision = await fetchDiditDecisionJson(diditId);
    if (!decision) {
      return res.status(400).json({ message: "No se pudo validar el documento con Didit. Reintentá en un momento." });
    }
    const birthIso = birthdate ? String(birthdate).slice(0, 10) : "";
    const expiryErr = getDocumentExpiryValidationErrorFromDecision(decision, birthIso);
    if (expiryErr) {
      return res.status(400).json({ message: expiryErr });
    }
    livenessRowId = ls.id;
  }

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

  const nowLv = livenessRequired && livenessRowId ? new Date() : null;
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
      livenessVerifiedAt: nowLv,
    };
    const u = canCompleteSsoPlaceholder && byEmail
      ? await tx.user.update({
        where: { id: byEmail.id },
        data: userData,
      })
      : await tx.user.create({
        data: userData,
      });
    if (livenessRequired && livenessRowId) {
      await tx.livenessSession.update({
        where: { id: livenessRowId },
        data: { consumedAt: new Date() },
      });
    }
    return u;
  });

  // Keycloak primero (crítico: sin la cuenta en el IdP el usuario no puede loguear).
  // Si falla, respondemos 502 (con CORS) antes de enviar ningún correo.
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
      if (ssoRegistrationToken) await consumeSsoRegistration(ssoRegistrationToken);
    } else {
      // Si el username quedó ocupado en Keycloak por una cuenta huérfana (sin usuario en la app),
      // la borramos para usar el nombre limpio (no se crean ni se toleran huérfanos).
      await freeKeycloakUsernameIfOrphan(user.username, async (mail) =>
        Boolean(await prisma.user.findUnique({ where: { email: mail }, select: { id: true } })),
      );
      await createKeycloakUser({
        email,
        username: user.username,
        firstName,
        lastName,
        password,
        role: registerRoleCode,
        emailVerified: false,
      });
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
    return res.status(usernameTakenInKc ? 409 : 502).json({
      message: usernameTakenInKc
        ? "No pudimos generar tu acceso por un conflicto de nombre de usuario. Probá de nuevo o contactá al administrador."
        : "No se pudo activar el acceso de la cuenta.",
    });
  }

  // Correo de verificación: best-effort y en segundo plano. No bloquea la respuesta,
  // así un SMTP lento/caído no cuelga el registro (causa de cortes 502/CORS en prod).
  if (!ssoProfile?.emailVerified) {
    void (async () => {
      try {
        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);
        await prisma.emailVerification.create({ data: { token, userId: user.id, expiresAt } });
        const verifyUrl = `${process.env.FRONTEND_URL}/verify?token=${token}`;
        await sendMail({
          to: email,
          subject: "Verifica tu email",
          html: `<p>Bienvenido/a. Verifica tu correo haciendo clic aquí:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
        });
      } catch (e) {
        console.error("SMTP send error (verify):", e);
      }
    })();
  }

  return res.json({ id: user.id, email: user.email, username: user.username, role: registerRoleCode });
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
  await prisma.$transaction([
    prisma.user.update({ where: { id: ev.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailVerification.update({ where: { token }, data: { usedAt: new Date() } }),
  ]);
  return res.json({ ok: true });
});

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
    await sendMail({
      to: user.email,
      subject: "Verifica tu email",
      html: `<p>Verifica tu correo:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
    });
  } catch (e) {
    console.error("SMTP send error (resend verify):", e);
  }
  return res.json({ ok: true });
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
