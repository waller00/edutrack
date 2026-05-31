import { prisma } from "../db/prisma.js";
import { ensureBuiltinOrgRoles } from "../identity/org-role-seed.js";
import { resolveRoleIdByCode } from "../identity/org-role-service.js";
import { pickRealmRole, syncKeycloakUserIdentity } from "./keycloak.js";

export type ProvisionedUser = {
  id: string;
  email: string;
  role: string;
};

const DEFAULT_ROLE = "TEACHER";

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

  const roleCode = pickRealmRole(claims) || DEFAULT_ROLE;
  const roleId = await resolveRoleIdByCodeEnsuring(roleCode);

  const firstName = claims.given_name ?? null;
  const lastName = claims.family_name ?? null;
  const fullName = claims.name ?? ([firstName, lastName].filter(Boolean).join(" ") || null);
  const emailVerified = claims.email_verified === true;

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        ...(email ? [{ email }] : []),
        ...(claimUsername ? [{ username: claimUsername }] : []),
      ],
    },
    select: { id: true, email: true, username: true, firstName: true, lastName: true },
  });

  if (existing) {
    const nextUsername = existing.username || claimUsername || undefined;
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        roleId,
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
    return { id: existing.id, email: email || existing.email, role: roleCode };
  }

  if (!email) throw new Error("Claims sin email para crear usuario local");

  const created = await prisma.user.create({
    data: {
      email,
      username: claimUsername ?? null,
      firstName,
      lastName,
      name: fullName,
      roleId,
      isActive: true,
      isApproved: true,
      emailVerifiedAt: emailVerified ? new Date() : null,
    },
    select: { id: true },
  });

  return { id: created.id, email, role: roleCode };
}

async function resolveRoleIdByCodeEnsuring(code: string): Promise<string> {
  let id = await resolveRoleIdByCode(code);
  if (!id) {
    await ensureBuiltinOrgRoles();
    id = await resolveRoleIdByCode(code);
  }
  if (!id) {
    // Ultima red: caer al rol por defecto si el codigo no existe.
    await ensureBuiltinOrgRoles();
    id = await resolveRoleIdByCode(DEFAULT_ROLE);
  }
  if (!id) throw new Error(`No se pudo resolver orgRole para ${code}`);
  return id;
}
