import type { PermissionScope as PrismaPermissionScope, PrismaClient } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { ensureBuiltinOrgRoles, RETIRED_ORG_ROLE_CODES } from './org-role-seed.js'
import {
  type PermissionLock,
  type ProfilePermissionRow,
  type ProfilePermissionsByCodeStore,
  type BuiltinProfileRole,
  BUILTIN_PROFILE_ROLES,
  DEFAULT_PROFILE_PERMISSIONS,
  ENFORCED_PROFILE_PERMISSION_SCOPES,
  normalizePermissionId,
  permissionLocksFor,
  policyLockFor,
  REMOVED_PERMISSION_REASON,
  REMOVED_PROFILE_PERMISSION_IDS,
  RETIRED_PERMISSION_CODES,
  REVOKED_PROFILE_PERMISSION_IDS,
  RENAMED_PERMISSION_MODULES,
  permissionSourceResolved,
} from './profile-permissions-defaults.js'

function scopeToDb(s: 'own' | 'all'): PrismaPermissionScope {
  return s === 'all' ? 'ALL' : 'OWN'
}

function scopeFromDb(s: PrismaPermissionScope): 'own' | 'all' {
  return s === 'ALL' ? 'all' : 'own'
}

/** Perfiles activos para Roles / Perfiles. Los retirados (Inspección) no se listan. */
export async function listActiveRolesMetaOrdered() {
  return prisma.orgRole.findMany({
    where: { active: true, code: { notIn: [...RETIRED_ORG_ROLE_CODES] } },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: { code: true, label: true, builtIn: true },
  })
}

/**
 * ¿El sistema fija este cambio? Lo que la política fuerza o apaga no se toca desde Roles / Perfiles,
 * y un permiso que dejó de ser del perfil sólo se puede apagar. `null` si el cambio está permitido.
 */
function lockedChange(roleCode: string, permissionId: string, enabled: boolean | undefined): PermissionLock | null {
  const lock = policyLockFor(roleCode, permissionId)
  if (lock) return lock
  const removed = REMOVED_PROFILE_PERMISSION_IDS[roleCode as BuiltinProfileRole]?.has(permissionId) ?? false
  if (removed && enabled !== false) return { enabled: false, scope: null, reason: REMOVED_PERMISSION_REASON }
  return null
}

export async function listPermissionCatalog() {
  const rows = await prisma.permission.findMany({
    where: { code: { notIn: [...RETIRED_PERMISSION_CODES] } },
    orderBy: [{ module: 'asc' }, { code: 'asc' }],
    select: {
      code: true,
      module: true,
      action: true,
      isSystem: true,
      roleGrants: {
        take: 1,
        select: { label: true },
      },
    },
  })
  return rows.map((permission) => ({
    id: permission.code,
    module: permission.module,
    action: permission.action,
    label: permission.roleGrants[0]?.label ?? permission.code,
    source: permission.isSystem ? 'system' as const : 'custom' as const,
  }))
}

/**
 * Pasa los módulos de nombre viejo al nuevo (`RENAMED_PERMISSION_MODULES`). Va por nombre de
 * módulo y no por código: así alcanza también a los permisos que ya no están en la matriz.
 */
export async function renameLegacyPermissionModules(client: PrismaClient = prisma): Promise<void> {
  for (const [from, to] of Object.entries(RENAMED_PERMISSION_MODULES)) {
    await client.permission.updateMany({ where: { module: from }, data: { module: to } })
  }
}

/** Upsert canónico de la matriz de los roles built-in (por código de `OrgRole`). */
export async function upsertCanonicalProfilePermissions(client: PrismaClient = prisma): Promise<void> {
  await ensureBuiltinOrgRoles()
  await renameLegacyPermissionModules(client)
  for (const code of BUILTIN_PROFILE_ROLES) {
    const org = await client.orgRole.findUnique({ where: { code } })
    if (!org) continue
    for (const p of DEFAULT_PROFILE_PERMISSIONS[code]) {
      if (REMOVED_PROFILE_PERMISSION_IDS[code].has(p.id)) continue
      const permRow = await client.permission.upsert({
        where: { code: p.id },
        create: {
          code: p.id,
          module: p.module,
          action: p.action,
          isSystem: true,
        },
        update: {
          module: p.module,
          action: p.action,
        },
      })
      await client.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: org.id, permissionId: permRow.id } },
        create: {
          roleId: org.id,
          permissionId: permRow.id,
          enabled: p.enabled,
          scope: scopeToDb(p.scope),
          label: p.label,
        },
        update: {
          enabled: p.enabled,
          scope: scopeToDb(p.scope),
          label: p.label,
        },
      })
    }
  }
}

async function ensureCanonicalProfilePermissionsPresent(client: PrismaClient = prisma): Promise<void> {
  await ensureBuiltinOrgRoles()
  await renameLegacyPermissionModules(client)
  for (const code of BUILTIN_PROFILE_ROLES) {
    const org = await client.orgRole.findUnique({ where: { code } })
    if (!org) continue
    for (const p of DEFAULT_PROFILE_PERMISSIONS[code]) {
      if (REMOVED_PROFILE_PERMISSION_IDS[code].has(p.id)) continue
      const permRow = await client.permission.upsert({
        where: { code: p.id },
        create: {
          code: p.id,
          module: p.module,
          action: p.action,
          isSystem: true,
        },
        update: {
          module: p.module,
          action: p.action,
          isSystem: true,
        },
      })
      if (!permRow) continue
      await client.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: org.id, permissionId: permRow.id } },
        create: {
          roleId: org.id,
          permissionId: permRow.id,
          enabled: p.enabled,
          scope: scopeToDb(p.scope),
          label: p.label,
        },
        update: {},
      })
    }
  }
}

/**
 * Apaga en la base los permisos de `REVOKED_PROFILE_PERMISSION_IDS`, y los de `RETIRED_PERMISSION_CODES`
 * en todos los perfiles. La autorización lee las filas de `RolePermission`, así que dejar de sembrar
 * un permiso no se lo saca a quien ya lo tenía.
 */
export async function revokeRetiredProfilePermissions(client: PrismaClient = prisma): Promise<number> {
  let revoked = 0
  for (const [roleCode, reasons] of Object.entries(REVOKED_PROFILE_PERMISSION_IDS)) {
    const permissionCodes = Object.keys(reasons ?? {})
    if (!permissionCodes.length) continue
    const result = await client.rolePermission.updateMany({
      where: {
        enabled: true,
        orgRole: { code: roleCode },
        permission: { code: { in: permissionCodes } },
      },
      data: { enabled: false },
    })
    revoked += result.count
  }
  const retired = await client.rolePermission.updateMany({
    where: { enabled: true, permission: { code: { in: [...RETIRED_PERMISSION_CODES] } } },
    data: { enabled: false },
  })
  return revoked + retired.count
}

/**
 * Aplica en la base los permisos de `ENFORCED_PROFILE_PERMISSION_SCOPES`: el sync de defaults sólo
 * crea filas faltantes, así que un permiso apagado o un cambio de alcance en la matriz no llegaría a
 * quien ya tiene la fila. Idempotente: sólo toca filas que no estén ya habilitadas con ese alcance.
 */
export async function enforceProfilePermissionScopes(client: PrismaClient = prisma): Promise<number> {
  let updated = 0
  for (const [roleCode, grants] of Object.entries(ENFORCED_PROFILE_PERMISSION_SCOPES)) {
    for (const [permissionCode, { scope }] of Object.entries(grants ?? {})) {
      const target = scopeToDb(scope)
      const result = await client.rolePermission.updateMany({
        where: {
          orgRole: { code: roleCode },
          permission: { code: permissionCode },
          OR: [{ enabled: false }, { scope: { not: target } }],
        },
        data: { enabled: true, scope: target },
      })
      updated += result.count
    }
  }
  return updated
}

export async function ensureDefaultProfilePermissionsIfNeeded(): Promise<void> {
  await ensureBuiltinOrgRoles()
  const count = await prisma.rolePermission.count()
  if (count > 0) {
    await ensureCanonicalProfilePermissionsPresent()
    await revokeRetiredProfilePermissions()
    await enforceProfilePermissionScopes()
    return
  }
  await upsertCanonicalProfilePermissions()
}

/** Agrupa RolePermission por `OrgRole.code` (todos los roles activos aparecen). */
export async function loadProfilePermissionsStore(): Promise<ProfilePermissionsByCodeStore> {
  const meta = await listActiveRolesMetaOrdered()
  const store: ProfilePermissionsByCodeStore = {}
  for (const m of meta) {
    store[m.code] = []
  }

  const rows = await prisma.rolePermission.findMany({
    include: { permission: true, orgRole: true },
    orderBy: [
      { orgRole: { code: 'asc' } },
      { permission: { module: 'asc' } },
      { permission: { code: 'asc' } },
    ],
  })

  for (const row of rows) {
    const code = row.orgRole.code
    if (!(code in store)) continue
    if (RETIRED_PERMISSION_CODES.includes(row.permission.code)) continue
    // Un permiso que dejó de ser del perfil se oculta sólo si está apagado: prendido, autoriza, así
    // que la pantalla tiene que mostrarlo para poder apagarlo.
    if (!row.enabled && isRemovedFromRole(code, row.permission.code)) continue
    store[code].push({
      id: row.permission.code,
      module: row.permission.module,
      action: row.permission.action,
      label: row.label,
      enabled: row.enabled,
      scope: scopeFromDb(row.scope),
    })
  }

  return store
}

function isRemovedFromRole(roleCode: string, permCode: string) {
  return REMOVED_PROFILE_PERMISSION_IDS[roleCode as BuiltinProfileRole]?.has(permCode) ?? false
}

/**
 * Perfiles con sus permisos y, por perfil, los permisos que fija el sistema (`locks`): la pantalla
 * los muestra con su estado y su motivo, y no deja cambiarlos.
 */
export function profilePermissionsResponse(
  store: ProfilePermissionsByCodeStore,
  rolesMeta: { code: string; label: string; builtIn?: boolean }[],
) {
  return {
    roles: rolesMeta.map(({ code, label, builtIn }) => {
      const permissions = store[code] ?? []
      const enabledIds = new Set(permissions.filter((p) => p.enabled).map((p) => p.id))
      return {
        role: code,
        label,
        builtIn: builtIn ?? false,
        permissions: permissions.map((permission: ProfilePermissionRow) => ({
          ...permission,
          source: permissionSourceResolved(code, permission.id),
        })),
        locks: Object.fromEntries(permissionLocksFor(code, enabledIds)),
      }
    }),
  }
}

export async function updateRolePermissionGrant(
  roleCode: string,
  permissionCode: string,
  patch: Partial<{ enabled: boolean; scope: 'own' | 'all'; label: string }>,
) {
  const org = await prisma.orgRole.findFirst({ where: { code: roleCode, active: true } })
  if (!org) return null
  const permRow = await prisma.permission.findUnique({ where: { code: permissionCode } })
  if (!permRow) return null

  const existing = await prisma.rolePermission.findUnique({
    where: { roleId_permissionId: { roleId: org.id, permissionId: permRow.id } },
  })
  if (!existing) return null

  // Cambiar el nombre visible no toca el acceso; prenderlo, apagarlo o cambiarle el alcance sí.
  const changesAccess = patch.enabled !== undefined || patch.scope !== undefined
  const lock = changesAccess ? lockedChange(roleCode, permissionCode, patch.enabled) : null
  if (lock) return { locked: lock }

  await prisma.rolePermission.update({
    where: { roleId_permissionId: { roleId: org.id, permissionId: permRow.id } },
    data: {
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.scope !== undefined ? { scope: scopeToDb(patch.scope) } : {}),
      ...(patch.label !== undefined ? { label: patch.label } : {}),
    },
  })
  return existing
}

export async function replaceRolePermissionGrants(
  roleCode: string,
  grants: Array<{ id: string; enabled: boolean; scope?: 'own' | 'all'; label?: string }>,
) {
  const org = await prisma.orgRole.findFirst({ where: { code: roleCode, active: true } })
  if (!org) return { error: 'NO_ROLE' as const }

  const codes = [...new Set(grants.map((grant) => grant.id))]
  const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } })
  const byCode = new Map(permissions.map((permission) => [permission.code, permission]))
  const missing = codes.filter((code) => !byCode.has(code))
  if (missing.length > 0) return { error: 'NO_PERMISSION' as const, missing }

  // Lo que fija el sistema se deja como está: la pantalla manda todos los permisos del catálogo.
  const editable = grants.filter((grant) => !lockedChange(roleCode, grant.id, grant.enabled))

  await prisma.$transaction(
    editable.map((grant) => {
      const permission = byCode.get(grant.id)!
      return prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: org.id, permissionId: permission.id } },
        create: {
          roleId: org.id,
          permissionId: permission.id,
          enabled: grant.enabled,
          scope: scopeToDb(grant.scope ?? 'own'),
          label: grant.label?.trim() || permission.code,
        },
        update: {
          enabled: grant.enabled,
          ...(grant.scope !== undefined ? { scope: scopeToDb(grant.scope) } : {}),
          ...(grant.label !== undefined ? { label: grant.label.trim() || permission.code } : {}),
        },
      })
    }),
  )

  return { ok: true as const }
}

export async function createProfileRoleWithPermissions(input: {
  code: string
  label: string
  grants: Array<{ id: string; enabled: boolean; scope?: 'own' | 'all'; label?: string }>
}) {
  const codes = [...new Set(input.grants.map((grant) => grant.id))]
  const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } })
  const byCode = new Map(permissions.map((permission) => [permission.code, permission]))
  const missing = codes.filter((code) => !byCode.has(code))
  if (missing.length > 0) return { error: 'NO_PERMISSION' as const, missing }

  try {
    await prisma.$transaction(async (tx) => {
      const maxRole = await tx.orgRole.findFirst({
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      })
      const org = await tx.orgRole.create({
        data: {
          code: input.code,
          label: input.label.trim(),
          builtIn: false,
          active: true,
          sortOrder: (maxRole?.sortOrder ?? 100) + 1,
        },
      })
      for (const grant of input.grants) {
        const permission = byCode.get(grant.id)!
        await tx.rolePermission.create({
          data: {
            roleId: org.id,
            permissionId: permission.id,
            enabled: grant.enabled,
            scope: scopeToDb(grant.scope ?? 'own'),
            label: grant.label?.trim() || permission.code,
          },
        })
      }
    })
  } catch (e: unknown) {
    const meta = typeof e === 'object' && e !== null ? (e as { code?: string }) : {}
    if (meta.code === 'P2002') return { error: 'EXISTS' as const }
    throw e
  }

  return { ok: true as const }
}

export async function createCustomPermissionForRole(
  roleCode: string,
  input: {
    module: string
    action: string
    label: string
    enabled: boolean
    scope: 'own' | 'all'
  },
) {
  const org = await prisma.orgRole.findFirst({ where: { code: roleCode, active: true } })
  if (!org) return { error: 'NO_ROLE' as const }

  const code = normalizePermissionId(input.module, input.action)
  const lock = lockedChange(roleCode, code, input.enabled)
  if (lock) return { error: 'LOCKED' as const, reason: lock.reason }

  let permRow = await prisma.permission.findUnique({ where: { code } })
  if (!permRow) {
    permRow = await prisma.permission.create({
      data: {
        code,
        module: input.module.trim(),
        action: input.action.trim(),
        isSystem: false,
      },
    })
  }

  try {
    await prisma.rolePermission.create({
      data: {
        roleId: org.id,
        permissionId: permRow.id,
        enabled: input.enabled,
        scope: scopeToDb(input.scope),
        label: input.label,
      },
    })
  } catch (e: unknown) {
    const meta = typeof e === 'object' && e !== null ? (e as { code?: string }) : {}
    if (meta.code === 'P2002') return { error: 'EXISTS' as const }
    throw e
  }

  return { ok: true as const }
}

export async function roleHasPermissionAssignment(roleCode: string, permissionCodeNorm: string): Promise<boolean> {
  const org = await prisma.orgRole.findFirst({ where: { code: roleCode, active: true } })
  if (!org) return false
  const permRow = await prisma.permission.findUnique({ where: { code: permissionCodeNorm } })
  if (!permRow) return false
  const row = await prisma.rolePermission.findUnique({
    where: { roleId_permissionId: { roleId: org.id, permissionId: permRow.id } },
  })
  return Boolean(row)
}
