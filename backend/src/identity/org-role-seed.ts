import { prisma } from '../db/prisma.js'

/** Roles base (códigos estables para JWT/guards); `ensureBuiltinOrgRoles()` es idempotente. */
export const BUILTIN_ORG_ROLE_ROWS = [
  { code: 'ADMIN', label: 'Administrador', sortOrder: 0 },
  // Personal no docente (limpieza, administración): sólo sus ingresos y sus licencias.
  { code: 'STAFF', label: 'Personal', sortOrder: 1 },
  { code: 'TEACHER', label: 'Docente', sortOrder: 2 },
  // Roles de la libreta. Son built-in y no perfiles personalizados a propósito: el visado sólo
  // puede estar en Dirección, y esa separación tiene que venir garantizada por el catálogo, no
  // depender de cómo un admin arme una matriz a mano.
  { code: 'ADSCRIPTO', label: 'Adscripto', sortOrder: 3 },
  { code: 'DIRECCION', label: 'Dirección', sortOrder: 4 },
] as const

/** Códigos de los roles built-in; no se pueden recrear ni renombrar desde la administración. */
export const BUILTIN_ORG_ROLE_CODES: readonly string[] = BUILTIN_ORG_ROLE_ROWS.map((r) => r.code)

/**
 * Perfiles del sistema que el liceo dejó de usar. Se desactivan (sus usuarios quedan sin permisos
 * hasta que administración les asigne otro) y pasan a personalizados para poder eliminarlos desde
 * Perfiles una vez sin usuarios. No se borran: `User.roleId` es `Restrict` y visados y mensajes
 * guardan el código.
 */
export const RETIRED_ORG_ROLE_CODES: readonly string[] = ['INSPECCION']

export async function ensureBuiltinOrgRoles(): Promise<void> {
  // Sólo los que todavía figuran como del sistema: si después un admin lo reactiva, no se pisa.
  await prisma.orgRole.updateMany({
    where: { code: { in: [...RETIRED_ORG_ROLE_CODES] }, builtIn: true },
    data: { active: false, builtIn: false },
  })
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
