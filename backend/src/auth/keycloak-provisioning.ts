import { prisma } from "../db/prisma.js";
import { findKeycloakUserIdsByEmail, syncKeycloakUserIdentity } from "./keycloak.js";
import type { SsoRegistrationProfile } from "./sso-registration.js";

export type ProvisionedUser = {
  id: string;
  email: string;
  role: string;
};

const DEFAULT_ROLE = "TEACHER";

export class SsoRegistrationRequiredError extends Error {
  profile: SsoRegistrationProfile;

  constructor(profile: SsoRegistrationProfile) {
    super("SSO_REGISTRATION_REQUIRED");
    this.name = "SsoRegistrationRequiredError";
    this.profile = profile;
  }
}

function cleanClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeUsername(value: unknown, email?: string): string | undefined {
  const raw = cleanClaim(value);
  if (!raw) return undefined;
  if (email && raw.toLowerCase() === email.toLowerCase()) return undefined;
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(raw)) return undefined;
  return raw;
}

/**
 * La cuenta de Keycloak que entra no puede quedarse con el usuario local que coincide: ya está
 * vinculado a otra cuenta, o sólo coincide el username (que el usuario edita en Keycloak).
 */
export class KeycloakAccountConflictError extends Error {
  constructor() {
    super("KEYCLOAK_ACCOUNT_CONFLICT");
    this.name = "KeycloakAccountConflictError";
  }
}

const USER_SELECT = {
  id: true,
  email: true,
  username: true,
  firstName: true,
  lastName: true,
  keycloakId: true,
  orgRole: { select: { code: true } },
} as const;

/**
 * Usuario local de la cuenta de Keycloak.
 *
 * El vínculo es el `sub`. El email sólo sirve una vez, para usuarios que todavía no tienen
 * `keycloakId` (anteriores al vínculo y que el relleno de arranque no alcanzó). El username no
 * vincula nunca: con `editUsernameAllowed` cualquiera se pone el de otro en la consola de cuenta.
 */
async function findLinkedUser(kcId: string, email: string | undefined) {
  const linked = await prisma.user.findUnique({ where: { keycloakId: kcId }, select: USER_SELECT });
  if (linked || !email) return linked;
  const byEmail = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: USER_SELECT,
  });
  if (byEmail?.keycloakId && byEmail.keycloakId !== kcId) throw new KeycloakAccountConflictError();
  return byEmail;
}

/**
 * Email y verificación a guardar. Un email nuevo sin verificar en Keycloak se acepta pero queda
 * sin verificar acá: si no, la cuenta seguiría figurando verificada con una dirección que nadie
 * comprobó (y la recuperación de 2FA por correo iría a parar ahí).
 */
function emailUpdate(currentEmail: string, email: string | undefined, emailVerified: boolean) {
  if (!email) return {};
  const changed = currentEmail.toLowerCase() !== email;
  return {
    ...(currentEmail !== email ? { email } : {}),
    ...(changed ? { emailVerifiedAt: emailVerified ? new Date() : null } : {}),
    ...(!changed && emailVerified ? { emailVerifiedAt: new Date() } : {}),
  };
}

/**
 * Sincroniza (o crea) el usuario local a partir de los claims de Keycloak.
 *
 * Keycloak es la fuente de verdad de autenticación e identidad (email, nombre).
 * El rol y los permisos viven en Postgres (orgRole + grants): los realm roles de
 * Keycloak solo siembran el rol al crear la cuenta y NO se reaplican en logins
 * posteriores (ver más abajo). Postgres manda en autorización.
 */
export async function provisionUserFromClaims(claims: Record<string, any>): Promise<ProvisionedUser> {
  const kcId = cleanClaim(claims.sub);
  if (!kcId) throw new Error("Claims sin sub");
  const email = cleanClaim(claims.email)?.toLowerCase();
  const claimUsername = normalizeUsername(claims.preferred_username ?? claims.username, email);
  if (!email && !claimUsername) throw new Error("Claims sin email ni username");

  const firstName = claims.given_name ?? null;
  const lastName = claims.family_name ?? null;
  const fullName = claims.name ?? ([firstName, lastName].filter(Boolean).join(" ") || null);
  const emailVerified = claims.email_verified === true;

  const existing = await findLinkedUser(kcId, email);

  if (existing) {
    // Postgres es la fuente de verdad de autorización: NO sobreescribimos el
    // rol del usuario existente con el rol del realm (evita revertir cambios de
    // rol hechos por un admin). Keycloak solo siembra el rol al crear la cuenta.
    const nextUsername = existing.username || claimUsername || undefined;
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(existing.keycloakId ? {} : { keycloakId: kcId }),
        ...emailUpdate(existing.email, email, emailVerified),
        ...(nextUsername && !existing.username ? { username: nextUsername } : {}),
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
        ...(fullName ? { name: fullName } : {}),
      },
    });
    await syncKeycloakUserIdentity({
      kcId,
      email: email || existing.email,
      username: nextUsername,
      firstName: firstName || existing.firstName,
      lastName: lastName || existing.lastName,
    }).catch((error) => console.warn("[keycloak] sync user identity skipped:", error));
    return {
      id: existing.id,
      email: email || existing.email,
      role: existing.orgRole?.code || DEFAULT_ROLE,
    };
  }

  if (!email) throw new Error("Claims sin email para crear usuario local");

  // Sólo coincide el username: o es la misma persona con el email cambiado en Keycloak (lo resuelve
  // administración alineando el email) o alguien que se puso el username de otro. En ninguno de los
  // dos casos corresponde ni entrar a esa cuenta ni abrir un alta nueva con ese username.
  if (claimUsername) {
    const byUsername = await prisma.user.findUnique({ where: { username: claimUsername }, select: { id: true } });
    if (byUsername) throw new KeycloakAccountConflictError();
  }

  throw new SsoRegistrationRequiredError({
    kcId,
    email,
    username: claimUsername ?? null,
    firstName,
    lastName,
    name: fullName,
    emailVerified,
  });
}

/**
 * Guarda el vínculo al crear la cuenta en Keycloak. Nunca pisa un vínculo existente. Si falla,
 * no rompe el alta: el primer login lo completa por email.
 */
export async function linkKeycloakAccount(userId: string, kcId: string | null | undefined): Promise<void> {
  if (!kcId) return;
  try {
    await prisma.user.updateMany({ where: { id: userId, keycloakId: null }, data: { keycloakId: kcId } });
  } catch (error) {
    console.warn("[keycloak] no se pudo guardar el vínculo de la cuenta:", error);
  }
}

/**
 * Vincula por email a los usuarios anteriores a `keycloakId`. Corre al arrancar, así el vínculo
 * por email del login (lo único que queda de la vinculación vieja) ya no tiene a quién aplicarse.
 * Es idempotente: sólo mira usuarios sin vínculo y nunca pisa uno existente.
 */
export async function backfillKeycloakLinks(): Promise<{ linked: number; missing: string[] }> {
  const pending = await prisma.user.findMany({ where: { keycloakId: null }, select: { id: true, email: true } });
  if (pending.length === 0) return { linked: 0, missing: [] };

  const idsByEmail = await findKeycloakUserIdsByEmail(pending.map((user) => user.email.toLowerCase()));
  let linked = 0;
  const missing: string[] = [];
  for (const user of pending) {
    const kcId = idsByEmail.get(user.email.toLowerCase());
    if (!kcId) {
      missing.push(user.id);
      continue;
    }
    try {
      const { count } = await prisma.user.updateMany({
        where: { id: user.id, keycloakId: null },
        data: { keycloakId: kcId },
      });
      linked += count;
    } catch (error) {
      // P2002: esa cuenta de Keycloak ya está vinculada a otro usuario. No se adivina cuál es el bueno.
      console.warn(`[keycloak] vínculo omitido para el usuario ${user.id}:`, error);
    }
  }
  return { linked, missing };
}
