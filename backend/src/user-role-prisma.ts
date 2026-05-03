import type { Prisma } from '@prisma/client'

/** Incluye `orgRole.code` donde antes se ponía `role` escalar en User. */
export const selectOrgRoleCode: Pick<Prisma.UserSelect, 'orgRole'> = {
  orgRole: { select: { code: true } },
}

export function attachRoleCode<U extends Record<string, unknown> & { orgRole?: { code: string } | null }>(
  u: U,
): Omit<U, 'orgRole'> & { role: string } {
  const { orgRole, ...rest } = u
  return { ...(rest as Omit<U, 'orgRole'>), role: orgRole?.code ?? '' }
}
