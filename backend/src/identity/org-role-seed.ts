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
 * Perfiles que el liceo dejó de usar. No se listan en Roles / Perfiles ni en Usuarios. Al arrancar,
 * uno sin usuarios se borra (sus permisos caen en cascada); con usuarios queda inactivo, ellos sin
 * permisos hasta que administración los reasigne, y se borra en el arranque siguiente. Visados y
 * mensajes guardan el código como texto, así que borrar el rol no los toca.
 */
export const RETIRED_ORG_ROLE_CODES: readonly string[] = ['INSPECCION']

async function retireOrgRoles(): Promise<void> {
  const roles = await prisma.orgRole.findMany({
    where: { code: { in: [...RETIRED_ORG_ROLE_CODES] } },
    select: { id: true, code: true, _count: { select: { users: true } } },
  })
  for (const role of roles) {
    if (role._count.users === 0) {
      await prisma.orgRole.delete({ where: { id: role.id } })
      continue
    }
    // `User.roleId` es `Restrict`: mientras tenga usuarios, el rol queda apagado.
    await prisma.orgRole.update({ where: { id: role.id }, data: { active: false, builtIn: false } })
    console.warn(`[roles] ${role.code} está retirado y tiene ${role._count.users} usuario(s) para reasignar`)
  }
}

export async function ensureBuiltinOrgRoles(): Promise<void> {
  await retireOrgRoles()
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
