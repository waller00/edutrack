import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Revisiones de perfiles que tienen que llegar a una base de producción que ya tiene sus filas:
 * Dirección y Adscripción ven todo el centro (20/10/2026), Administración vuelve a editar las
 * libretas (25/10/2026) e Inspección se retira.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    orgRole: { upsert: vi.fn(), findMany: vi.fn(), delete: vi.fn(), update: vi.fn() },
    rolePermission: { updateMany: vi.fn() },
  },
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))

import { enforceProfilePermissionScopes } from './profile-permissions-repository.js'
import { ensureBuiltinOrgRoles } from './org-role-seed.js'

describe('enforceProfilePermissionScopes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.rolePermission.updateMany.mockResolvedValue({ count: 1 })
  })

  function calls() {
    return prismaMock.rolePermission.updateMany.mock.calls.map(([arg]) => ({
      role: arg.where.orgRole.code,
      permission: arg.where.permission.code,
      data: arg.data,
    }))
  }

  it('sube a "all" la asistencia, la agenda y las licencias de Dirección y Adscripción', async () => {
    await enforceProfilePermissionScopes(prismaMock as never)

    for (const role of ['DIRECCION', 'ADSCRIPTO']) {
      for (const permission of ['attendance.read', 'events.read', 'licenses.read']) {
        expect(calls()).toContainEqual({ role, permission, data: { enabled: true, scope: 'ALL' } })
      }
    }
  })

  it('le prende a Administración la edición de las libretas y sus avisos', async () => {
    const updated = await enforceProfilePermissionScopes(prismaMock as never)

    expect(updated).toBe(10)
    for (const permission of ['gradebook.grade', 'gradebook.plan', 'gradebook.close']) {
      expect(calls()).toContainEqual({ role: 'ADMIN', permission, data: { enabled: true, scope: 'ALL' } })
    }
    expect(calls()).toContainEqual({ role: 'ADMIN', permission: 'notifications.read', data: { enabled: true, scope: 'OWN' } })
  })

  it('es idempotente: sólo toca filas apagadas o con otro alcance', async () => {
    await enforceProfilePermissionScopes(prismaMock as never)

    const [first] = prismaMock.rolePermission.updateMany.mock.calls[0]
    expect(first.where.OR).toEqual([{ enabled: false }, { scope: { not: first.data.scope } }])
  })
})

describe('ensureBuiltinOrgRoles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.orgRole.findMany.mockResolvedValue([])
    prismaMock.orgRole.upsert.mockResolvedValue({})
    prismaMock.orgRole.delete.mockResolvedValue({})
    prismaMock.orgRole.update.mockResolvedValue({})
  })

  it('borra Inspección si no tiene usuarios', async () => {
    prismaMock.orgRole.findMany.mockResolvedValue([{ id: 'r-insp', code: 'INSPECCION', _count: { users: 0 } }])

    await ensureBuiltinOrgRoles()

    expect(prismaMock.orgRole.findMany.mock.calls[0][0].where).toEqual({ code: { in: ['INSPECCION'] } })
    expect(prismaMock.orgRole.delete).toHaveBeenCalledWith({ where: { id: 'r-insp' } })
  })

  it('con usuarios la deja apagada hasta que se reasignen', async () => {
    // `User.roleId` es `Restrict`: borrarla fallaría. Sus usuarios ya no tenían permisos.
    prismaMock.orgRole.findMany.mockResolvedValue([{ id: 'r-insp', code: 'INSPECCION', _count: { users: 2 } }])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await ensureBuiltinOrgRoles()

    expect(prismaMock.orgRole.delete).not.toHaveBeenCalled()
    expect(prismaMock.orgRole.update).toHaveBeenCalledWith({
      where: { id: 'r-insp' },
      data: { active: false, builtIn: false },
    })
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/INSPECCION.*2 usuario/))
    warn.mockRestore()
  })

  it('ya no siembra Inspección y siembra Staff con el nombre "Personal"', async () => {
    await ensureBuiltinOrgRoles()

    const codes = prismaMock.orgRole.upsert.mock.calls.map(([arg]) => arg.where.code)
    expect(codes).not.toContain('INSPECCION')
    const staff = prismaMock.orgRole.upsert.mock.calls.find(([arg]) => arg.where.code === 'STAFF')?.[0]
    expect(staff?.update.label).toBe('Personal')
  })
})
