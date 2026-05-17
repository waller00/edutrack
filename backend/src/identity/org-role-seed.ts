import { prisma } from '../db/prisma.js'

/** Roles base (códigos estables para JWT/guards); `ensureBuiltinOrgRoles()` es idempotente. */
export const BUILTIN_ORG_ROLE_ROWS = [
  { code: 'ADMIN', label: 'Administrador', sortOrder: 0 },
  { code: 'STAFF', label: 'Staff', sortOrder: 1 },
  { code: 'TEACHER', label: 'Tutor', sortOrder: 2 },
] as const

export async function ensureBuiltinOrgRoles(): Promise<void> {
  for (const r of BUILTIN_ORG_ROLE_ROWS) {
    await prisma.orgRole.upsert({
      where: { code: r.code },
      create: {
        code: r.code,
        label: r.label,
        builtIn: true,
        active: true,
        sortOrder: r.sortOrder,
      },
      update: {
        label: r.label,
        builtIn: true,
        active: true,
      },
    })
  }
}
