import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Revisión de perfiles del 20/10/2026: Dirección y Adscripción pasan a ver todo el centro, Personal
 * (STAFF) se queda con sus ingresos y licencias, e Inspección se retira. Estas piezas son las que
 * hacen llegar el cambio a una base de producción que ya tiene sus filas.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    orgRole: { upsert: vi.fn(), updateMany: vi.fn() },
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

  it('sube a "all" la asistencia, la agenda y las licencias de Dirección y Adscripción', async () => {
    const updated = await enforceProfilePermissionScopes(prismaMock as never)

    expect(updated).toBe(6)
    const calls = prismaMock.rolePermission.updateMany.mock.calls.map(([arg]) => ({
      role: arg.where.orgRole.code,
      permission: arg.where.permission.code,
      data: arg.data,
    }))
    for (const role of ['DIRECCION', 'ADSCRIPTO']) {
      for (const permission of ['attendance.read', 'events.read', 'licenses.read']) {
        expect(calls).toContainEqual({ role, permission, data: { enabled: true, scope: 'ALL' } })
      }
    }
  })

  it('es idempotente: sólo toca filas apagadas o con otro alcance', async () => {
    await enforceProfilePermissionScopes(prismaMock as never)

    const [first] = prismaMock.rolePermission.updateMany.mock.calls[0]
    expect(first.where.OR).toEqual([{ enabled: false }, { scope: { not: 'ALL' } }])
  })
})

describe('ensureBuiltinOrgRoles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.orgRole.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.orgRole.upsert.mockResolvedValue({})
  })

  it('desactiva Inspección y la pasa a personalizada, sin pisarla si un admin la reactivó', async () => {
    await ensureBuiltinOrgRoles()

    expect(prismaMock.orgRole.updateMany).toHaveBeenCalledWith({
      where: { code: { in: ['INSPECCION'] }, builtIn: true },
      data: { active: false, builtIn: false },
    })
  })

  it('ya no siembra Inspección y siembra Staff con el nombre "Personal"', async () => {
    await ensureBuiltinOrgRoles()

    const codes = prismaMock.orgRole.upsert.mock.calls.map(([arg]) => arg.where.code)
    expect(codes).not.toContain('INSPECCION')
    const staff = prismaMock.orgRole.upsert.mock.calls.find(([arg]) => arg.where.code === 'STAFF')?.[0]
    expect(staff?.update.label).toBe('Personal')
  })
})
