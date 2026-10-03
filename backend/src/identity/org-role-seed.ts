import { prisma } from '../db/prisma.js'

/** Roles base (códigos estables para JWT/guards); `ensureBuiltinOrgRoles()` es idempotente. */
export const BUILTIN_ORG_ROLE_ROWS = [
  { code: 'ADMIN', label: 'Administrador', sortOrder: 0 },
  { code: 'STAFF', label: 'Staff', sortOrder: 1 },
  { code: 'TEACHER', label: 'Docente', sortOrder: 2 },
  // Roles de la libreta. Son built-in y no perfiles personalizados a propósito: el visado sólo
  // puede estar en Dirección y la inspección no puede modificarlo, y esa separación tiene que
  // venir garantizada por el catálogo, no depender de cómo un admin arme una matriz a mano.
  { code: 'ADSCRIPTO', label: 'Adscripto', sortOrder: 3 },
  { code: 'DIRECCION', label: 'Dirección', sortOrder: 4 },
  { code: 'INSPECCION', label: 'Inspección', sortOrder: 5 },
] as const

/** Códigos de los roles built-in; no se pueden recrear ni renombrar desde la administración. */
export const BUILTIN_ORG_ROLE_CODES: readonly string[] = BUILTIN_ORG_ROLE_ROWS.map((r) => r.code)

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
