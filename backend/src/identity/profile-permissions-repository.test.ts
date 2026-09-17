import { describe, it, expect, beforeEach, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    orgRole: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    permission: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    rolePermission: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), create: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('./org-role-seed.js', () => ({ ensureBuiltinOrgRoles: vi.fn().mockResolvedValue(undefined) }))

import {
  listPermissionCatalog,
  profilePermissionsResponse,
  updateRolePermissionGrant,
  replaceRolePermissionGrants,
  createProfileRoleWithPermissions,
  createCustomPermissionForRole,
  roleHasPermissionAssignment,
  loadProfilePermissionsStore,
  upsertCanonicalProfilePermissions,
  ensureDefaultProfilePermissionsIfNeeded,
} from './profile-permissions-repository.js'
import { BUILTIN_PROFILE_ROLES } from './profile-permissions-defaults.js'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.$transaction.mockImplementation(async (input: any) =>
    typeof input === 'function' ? input(prismaMock) : Promise.all(input),
  )
})

describe('profilePermissionsResponse (puro)', () => {
  it('marca source system/custom según defaults built-in', () => {
    const store = {
      ADMIN: [{ id: 'users.read', module: 'Usuarios', action: 'read', label: 'Ver', enabled: true, scope: 'all' as const }],
      COORD: [{ id: 'x.y', module: 'X', action: 'y', label: 'XY', enabled: true, scope: 'own' as const }],
    }
    const out = profilePermissionsResponse(store, [
      { code: 'ADMIN', label: 'Admin' },
      { code: 'COORD', label: 'Coordinación' },
    ])
    expect(out.roles[0].permissions[0].source).toBe('system')
    expect(out.roles[1].permissions[0].source).toBe('custom')
  })

  it('rol sin filas en store → permissions vacío', () => {
    const out = profilePermissionsResponse({}, [{ code: 'STAFF', label: 'Staff' }])
    expect(out.roles[0].permissions).toEqual([])
  })
})

describe('listPermissionCatalog', () => {
  it('mapea code/module/action/label/source', async () => {
    prismaMock.permission.findMany.mockResolvedValueOnce([
      { code: 'users.read', module: 'Usuarios', action: 'read', isSystem: true, roleGrants: [{ label: 'Ver usuarios' }] },
      { code: 'x.y', module: 'X', action: 'y', isSystem: false, roleGrants: [] },
    ])
    const out = await listPermissionCatalog()
    expect(out[0]).toMatchObject({ id: 'users.read', label: 'Ver usuarios', source: 'system' })
    expect(out[1]).toMatchObject({ id: 'x.y', label: 'x.y', source: 'custom' })
  })
})

describe('updateRolePermissionGrant', () => {
  it('null si rol inexistente', async () => {
    prismaMock.orgRole.findFirst.mockResolvedValueOnce(null)
    expect(await updateRolePermissionGrant('NOPE', 'users.read', { enabled: false })).toBeNull()
  })
  it('null si permiso inexistente', async () => {
    prismaMock.orgRole.findFirst.mockResolvedValueOnce({ id: 'r1' })
    prismaMock.permission.findUnique.mockResolvedValueOnce(null)
    expect(await updateRolePermissionGrant('ADMIN', 'nope', {})).toBeNull()
  })
  it('null si no hay grant existente', async () => {
    prismaMock.orgRole.findFirst.mockResolvedValueOnce({ id: 'r1' })
    prismaMock.permission.findUnique.mockResolvedValueOnce({ id: 'p1' })
    prismaMock.rolePermission.findUnique.mockResolvedValueOnce(null)
    expect(await updateRolePermissionGrant('ADMIN', 'users.read', {})).toBeNull()
  })
  it('actualiza enabled/scope/label cuando existe', async () => {
    prismaMock.orgRole.findFirst.mockResolvedValueOnce({ id: 'r1' })
    prismaMock.permission.findUnique.mockResolvedValueOnce({ id: 'p1' })
    prismaMock.rolePermission.findUnique.mockResolvedValueOnce({ roleId: 'r1', permissionId: 'p1' })
    prismaMock.rolePermission.update.mockResolvedValueOnce({})
    const res = await updateRolePermissionGrant('ADMIN', 'users.read', { enabled: false, scope: 'all', label: 'X' })
    expect(res).not.toBeNull()
    expect(prismaMock.rolePermission.update).toHaveBeenCalled()
  })
})

describe('replaceRolePermissionGrants', () => {
  it('NO_ROLE si rol inexistente', async () => {
    prismaMock.orgRole.findFirst.mockResolvedValueOnce(null)
    expect(await replaceRolePermissionGrants('NOPE', [])).toEqual({ error: 'NO_ROLE' })
  })
  it('NO_PERMISSION si hay códigos inexistentes', async () => {
    prismaMock.orgRole.findFirst.mockResolvedValueOnce({ id: 'r1' })
    prismaMock.permission.findMany.mockResolvedValueOnce([{ code: 'a.b', id: 'p1' }])
    const res = await replaceRolePermissionGrants('ADMIN', [
      { id: 'a.b', enabled: true },
      { id: 'missing', enabled: true },
    ])
    expect(res).toMatchObject({ error: 'NO_PERMISSION', missing: ['missing'] })
  })
  it('ok hace upsert en transacción', async () => {
    prismaMock.orgRole.findFirst.mockResolvedValueOnce({ id: 'r1' })
    prismaMock.permission.findMany.mockResolvedValueOnce([{ code: 'a.b', id: 'p1' }])
    prismaMock.rolePermission.upsert.mockResolvedValue({})
    const res = await replaceRolePermissionGrants('ADMIN', [{ id: 'a.b', enabled: true, scope: 'all', label: 'AB' }])
    expect(res).toEqual({ ok: true })
    expect(prismaMock.rolePermission.upsert).toHaveBeenCalled()
  })
})

describe('createProfileRoleWithPermissions', () => {
  it('NO_PERMISSION con códigos faltantes', async () => {
    prismaMock.permission.findMany.mockResolvedValueOnce([])
    const res = await createProfileRoleWithPermissions({ code: 'COORD', label: 'C', grants: [{ id: 'x.y', enabled: true }] })
    expect(res).toMatchObject({ error: 'NO_PERMISSION' })
  })
  it('crea rol + grants', async () => {
    prismaMock.permission.findMany.mockResolvedValueOnce([{ code: 'x.y', id: 'p1' }])
    prismaMock.orgRole.findFirst.mockResolvedValueOnce({ sortOrder: 100 })
    prismaMock.orgRole.create.mockResolvedValueOnce({ id: 'r-new' })
    prismaMock.rolePermission.create.mockResolvedValue({})
    const res = await createProfileRoleWithPermissions({ code: 'COORD', label: 'C', grants: [{ id: 'x.y', enabled: true }] })
    expect(res).toEqual({ ok: true })
  })
  it('EXISTS ante P2002', async () => {
    prismaMock.permission.findMany.mockResolvedValueOnce([{ code: 'x.y', id: 'p1' }])
    prismaMock.$transaction.mockRejectedValueOnce({ code: 'P2002' })
    const res = await createProfileRoleWithPermissions({ code: 'COORD', label: 'C', grants: [{ id: 'x.y', enabled: true }] })
    expect(res).toEqual({ error: 'EXISTS' })
  })
})

describe('createCustomPermissionForRole', () => {
  it('NO_ROLE si rol inexistente', async () => {
    prismaMock.orgRole.findFirst.mockResolvedValueOnce(null)
    const res = await createCustomPermissionForRole('NOPE', { module: 'M', action: 'a', label: 'L', enabled: true, scope: 'own' })
    expect(res).toEqual({ error: 'NO_ROLE' })
  })
  it('crea permiso nuevo y grant', async () => {
    prismaMock.orgRole.findFirst.mockResolvedValueOnce({ id: 'r1' })
    prismaMock.permission.findUnique.mockResolvedValueOnce(null)
    prismaMock.permission.create.mockResolvedValueOnce({ id: 'p-new' })
    prismaMock.rolePermission.create.mockResolvedValueOnce({})
    const res = await createCustomPermissionForRole('COORD', { module: 'Reportes', action: 'export', label: 'Exportar', enabled: true, scope: 'all' })
    expect(res).toEqual({ ok: true })
  })
  it('EXISTS ante P2002 al crear grant', async () => {
    prismaMock.orgRole.findFirst.mockResolvedValueOnce({ id: 'r1' })
    prismaMock.permission.findUnique.mockResolvedValueOnce({ id: 'p1' })
    prismaMock.rolePermission.create.mockRejectedValueOnce({ code: 'P2002' })
    const res = await createCustomPermissionForRole('COORD', { module: 'M', action: 'a', label: 'L', enabled: true, scope: 'own' })
    expect(res).toEqual({ error: 'EXISTS' })
  })
})

describe('roleHasPermissionAssignment', () => {
  it('false si falta rol/permiso/grant', async () => {
    prismaMock.orgRole.findFirst.mockResolvedValueOnce(null)
    expect(await roleHasPermissionAssignment('NOPE', 'a.b')).toBe(false)
    prismaMock.orgRole.findFirst.mockResolvedValueOnce({ id: 'r1' })
    prismaMock.permission.findUnique.mockResolvedValueOnce(null)
    expect(await roleHasPermissionAssignment('ADMIN', 'nope')).toBe(false)
  })
  it('true cuando existe el grant', async () => {
    prismaMock.orgRole.findFirst.mockResolvedValueOnce({ id: 'r1' })
    prismaMock.permission.findUnique.mockResolvedValueOnce({ id: 'p1' })
    prismaMock.rolePermission.findUnique.mockResolvedValueOnce({ roleId: 'r1', permissionId: 'p1' })
    expect(await roleHasPermissionAssignment('ADMIN', 'users.read')).toBe(true)
  })
})

describe('seed de matriz canónica', () => {
  function seedMocks() {
    prismaMock.orgRole.findUnique.mockResolvedValue({ id: 'r1' })
    prismaMock.permission.upsert.mockResolvedValue({ id: 'p1' })
    prismaMock.rolePermission.upsert.mockResolvedValue({})
  }

  it('upsertCanonicalProfilePermissions siembra permisos de built-ins', async () => {
    seedMocks()
    await upsertCanonicalProfilePermissions()
    expect(prismaMock.permission.upsert).toHaveBeenCalled()
    expect(prismaMock.rolePermission.upsert).toHaveBeenCalled()
  })

  it('omite roles built-in inexistentes (orgRole null)', async () => {
    prismaMock.orgRole.findUnique.mockResolvedValue(null)
    await upsertCanonicalProfilePermissions()
    expect(prismaMock.permission.upsert).not.toHaveBeenCalled()
  })

  it('ensureDefaultProfilePermissionsIfNeeded con matriz existente refuerza presencia', async () => {
    seedMocks()
    prismaMock.rolePermission.count.mockResolvedValue(10)
    await ensureDefaultProfilePermissionsIfNeeded()
    expect(prismaMock.permission.upsert).toHaveBeenCalled()
  })

  it('ensureDefaultProfilePermissionsIfNeeded sin filas hace el seed canónico', async () => {
    seedMocks()
    prismaMock.rolePermission.count.mockResolvedValue(0)
    await ensureDefaultProfilePermissionsIfNeeded()
    expect(prismaMock.rolePermission.upsert).toHaveBeenCalled()
  })

  it('siembra TODOS los roles de la matriz, no una lista fija', async () => {
    // La lista de built-ins estaba hardcodeada acá dentro: agregar un rol a la matriz no lo
    // sembraba y quedaba sin ningún permiso, sin ruido. Ahora se deriva de la propia matriz.
    seedMocks()
    await upsertCanonicalProfilePermissions()

    const seeded = prismaMock.orgRole.findUnique.mock.calls.map(([args]: any) => args.where.code)
    expect(seeded.sort()).toEqual([...BUILTIN_PROFILE_ROLES].sort())
  })

  it('siembra los permisos de libreta de cada rol nuevo', async () => {
    seedMocks()
    await upsertCanonicalProfilePermissions()

    const codes = new Set(prismaMock.permission.upsert.mock.calls.map(([args]: any) => args.where.code))
    for (const code of ['gradebook.read', 'gradebook.grade', 'gradebook.close', 'gradebook.review', 'gradebook.endorse', 'gradebook.inspect', 'gradebook.manage']) {
      expect(codes.has(code), `falta sembrar ${code}`).toBe(true)
    }

    // El visado se siembra con alcance ALL: si entrara como OWN, Dirección no podría visar
    // libretas ajenas, que es justamente lo único que hace.
    const endorseGrants = prismaMock.rolePermission.upsert.mock.calls
      .map(([args]: any) => args.create)
      .filter((c: any) => c.label === 'Visar libretas')
    expect(endorseGrants.length).toBe(2) // ADMIN y DIRECCION
    for (const grant of endorseGrants) expect(grant.scope).toBe('ALL')
  })
})

describe('loadProfilePermissionsStore', () => {
  it('agrupa grants por código de rol activo', async () => {
    prismaMock.orgRole.findMany.mockResolvedValueOnce([
      { code: 'ADMIN', label: 'Admin' },
      { code: 'STAFF', label: 'Staff' },
    ])
    prismaMock.rolePermission.findMany.mockResolvedValueOnce([
      { label: 'Ver', enabled: true, scope: 'ALL', permission: { code: 'users.read', module: 'Usuarios', action: 'read' }, orgRole: { code: 'ADMIN' } },
      { label: 'Mis', enabled: true, scope: 'OWN', permission: { code: 'events.read', module: 'Eventos', action: 'read' }, orgRole: { code: 'STAFF' } },
      // rol no listado → se ignora
      { label: 'X', enabled: true, scope: 'OWN', permission: { code: 'x.y', module: 'X', action: 'y' }, orgRole: { code: 'GHOST' } },
    ])
    const store = await loadProfilePermissionsStore()
    expect(store.ADMIN).toHaveLength(1)
    expect(store.ADMIN[0]).toMatchObject({ id: 'users.read', scope: 'all', enabled: true })
    expect(store.STAFF[0]).toMatchObject({ id: 'events.read', scope: 'own' })
    expect(store.GHOST).toBeUndefined()
  })
})
