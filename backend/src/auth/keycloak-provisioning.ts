import { prisma } from "../db/prisma.js";
import { syncKeycloakUserIdentity } from "./keycloak.js";
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
 * Sincroniza (o crea) el usuario local a partir de los claims de Keycloak.
 *
 * Keycloak es la fuente de verdad de autenticacion e identidad de rol; los
 * permisos granulares siguen viviendo en Postgres (orgRole + grants).
 */
export async function provisionUserFromClaims(claims: Record<string, any>): Promise<ProvisionedUser> {
  const email = cleanClaim(claims.email)?.toLowerCase();
  const claimUsername = normalizeUsername(claims.preferred_username ?? claims.username, email);
  if (!email && !claimUsername) throw new Error("Claims sin email ni username");

  const firstName = claims.given_name ?? null;
  const lastName = claims.family_name ?? null;
  const fullName = claims.name ?? ([firstName, lastName].filter(Boolean).join(" ") || null);
  const emailVerified = claims.email_verified === true;

  // Prioriza el match por email (clave estable de Keycloak); el username es respaldo.
  const userSelect = {
    id: true,
    email: true,
    username: true,
    firstName: true,
    lastName: true,
    orgRole: { select: { code: true } },
  } as const;
  let existing = email
    ? await prisma.user.findUnique({ where: { email }, select: userSelect })
    : null;
  if (!existing && claimUsername) {
    existing = await prisma.user.findUnique({ where: { username: claimUsername }, select: userSelect });
  }

  if (existing) {
    // Postgres es la fuente de verdad de autorización: NO sobreescribimos el
    // rol del usuario existente con el rol del realm (evita revertir cambios de
    // rol hechos por un admin). Keycloak solo siembra el rol al crear la cuenta.
    const nextUsername = existing.username || claimUsername || undefined;
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(email && existing.email !== email ? { email } : {}),
        ...(nextUsername && !existing.username ? { username: nextUsername } : {}),
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
        ...(fullName ? { name: fullName } : {}),
        ...(emailVerified ? { emailVerifiedAt: new Date() } : {}),
      },
    });
    await syncKeycloakUserIdentity({
      kcId: String(claims.sub || ""),
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

  throw new SsoRegistrationRequiredError({
    kcId: String(claims.sub || ""),
    email,
    username: claimUsername ?? null,
    firstName,
    lastName,
    name: fullName,
    emailVerified,
  });
}
