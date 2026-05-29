import { prisma } from "../db/prisma.js";
import { ensureBuiltinOrgRoles } from "../identity/org-role-seed.js";
import { resolveRoleIdByCode } from "../identity/org-role-service.js";
import { pickRealmRole } from "./keycloak.js";

export type ProvisionedUser = {
  id: string;
  email: string;
  role: string;
};

const DEFAULT_ROLE = "TEACHER";

/**
 * Sincroniza (o crea) el usuario local a partir de los claims de Keycloak.
 *
 * Keycloak es la fuente de verdad de autenticacion e identidad de rol; los
 * permisos granulares siguen viviendo en Postgres (orgRole + grants).
 */
export async function provisionUserFromClaims(claims: Record<string, any>): Promise<ProvisionedUser> {
  const email: string | undefined = claims.email;
  if (!email) throw new Error("Claims sin email");

  const roleCode = pickRealmRole(claims) || DEFAULT_ROLE;
  const roleId = await resolveRoleIdByCodeEnsuring(roleCode);

  const firstName = claims.given_name ?? null;
  const lastName = claims.family_name ?? null;
  const fullName = claims.name ?? ([firstName, lastName].filter(Boolean).join(" ") || null);
  const emailVerified = claims.email_verified === true;

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, roleId: true },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        roleId,
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
        ...(fullName ? { name: fullName } : {}),
        ...(emailVerified ? { emailVerifiedAt: new Date() } : {}),
      },
    });
    return { id: existing.id, email, role: roleCode };
  }

  const created = await prisma.user.create({
    data: {
      email,
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
