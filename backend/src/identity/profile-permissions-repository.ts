import type { PermissionScope as PrismaPermissionScope, PrismaClient } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { ensureBuiltinOrgRoles } from './org-role-seed.js'
import {
  type ProfilePermissionRow,
  type ProfilePermissionsByCodeStore,
  type BuiltinProfileRole,
  DEFAULT_PROFILE_PERMISSIONS,
  normalizePermissionId,
  REMOVED_PROFILE_PERMISSION_IDS,
  permissionSourceResolved,
} from './profile-permissions-defaults.js'

function scopeToDb(s: 'own' | 'all'): PrismaPermissionScope {
  return s === 'all' ? 'ALL' : 'OWN'
}

function scopeFromDb(s: PrismaPermissionScope): 'own' | 'all' {
  return s === 'ALL' ? 'all' : 'own'
}

export async function listActiveRolesMetaOrdered() {
  return prisma.orgRole.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: { code: true, label: true },
  })
}

export async function listPermissionCatalog() {
  const rows = await prisma.permission.findMany({
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

/** Upsert canónico solo para ADMIN / STAFF / TEACHER (por código de OrgRole). */
export async function upsertCanonicalProfilePermissions(client: PrismaClient = prisma): Promise<void> {
  await ensureBuiltinOrgRoles()
  const builtins: BuiltinProfileRole[] = ['ADMIN', 'STAFF', 'TEACHER']
  for (const code of builtins) {
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
  const builtins: BuiltinProfileRole[] = ['ADMIN', 'STAFF', 'TEACHER']
  for (const code of builtins) {
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

export async function ensureDefaultProfilePermissionsIfNeeded(): Promise<void> {
  await ensureBuiltinOrgRoles()
  const count = await prisma.rolePermission.count()
  if (count > 0) {
    await ensureCanonicalProfilePermissionsPresent()
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
    if (REMATCH_REMOVED(code, row.permission.code)) continue
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

function REMATCH_REMOVED(roleCode: string, permCode: string) {
  const k = roleCode as BuiltinProfileRole
  const set = REMOVED_PROFILE_PERMISSION_IDS[k]
  return set?.has(permCode) ?? false
}

export function profilePermissionsResponse(
  store: ProfilePermissionsByCodeStore,
  rolesMeta: { code: string; label: string }[],
) {
  return {
    roles: rolesMeta.map(({ code, label }) => ({
      role: code,
      label,
      permissions: (store[code] ?? []).map((permission: ProfilePermissionRow) => ({
        ...permission,
        source: permissionSourceResolved(code, permission.id),
      })),
    })),
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

  await prisma.$transaction(
    grants.map((grant) => {
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
