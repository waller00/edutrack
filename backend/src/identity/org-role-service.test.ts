import { describe, it, expect, beforeEach, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { orgRole: { findFirst: vi.fn() } },
}))
vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))

import {
  normalizeOrgRoleCode,
  validateOrgRoleCode,
  userWithRoleCode,
  resolveRoleIdByCode,
  getOrgRoleIdByCodeOrThrow,
} from './org-role-service.js'

describe('org-role-service', () => {
  beforeEach(() => prismaMock.orgRole.findFirst.mockReset())

  it('normalizeOrgRoleCode: recorta, mayúsculas y espacios → guion bajo', () => {
    expect(normalizeOrgRoleCode('  admin user ')).toBe('ADMIN_USER')
    expect(normalizeOrgRoleCode('teacher')).toBe('TEACHER')
  })

  it('validateOrgRoleCode: acepta válidos, rechaza inválidos', () => {
    expect(() => validateOrgRoleCode('ADMIN')).not.toThrow()
    expect(() => validateOrgRoleCode('A1_B')).not.toThrow()
    expect(() => validateOrgRoleCode('1ABC')).toThrow('INVALID_ROLE_CODE')
    expect(() => validateOrgRoleCode('admin')).toThrow('INVALID_ROLE_CODE')
  })

  it('userWithRoleCode: mapea orgRole.code a role (o vacío)', () => {
    expect(userWithRoleCode({ id: 'u1', orgRole: { code: 'ADMIN' } })).toEqual({ id: 'u1', role: 'ADMIN' })
    expect(userWithRoleCode({ id: 'u2', orgRole: null })).toEqual({ id: 'u2', role: '' })
    expect(userWithRoleCode({ id: 'u3' })).toEqual({ id: 'u3', role: '' })
  })

  it('resolveRoleIdByCode: devuelve id o null', async () => {
    prismaMock.orgRole.findFirst.mockResolvedValueOnce({ id: 'r1' })
    expect(await resolveRoleIdByCode('ADMIN')).toBe('r1')
    prismaMock.orgRole.findFirst.mockResolvedValueOnce(null)
    expect(await resolveRoleIdByCode('NOPE')).toBeNull()
  })

  it('getOrgRoleIdByCodeOrThrow: devuelve id o lanza ROLE_NOT_FOUND', async () => {
    prismaMock.orgRole.findFirst.mockResolvedValueOnce({ id: 'r2' })
    expect(await getOrgRoleIdByCodeOrThrow('STAFF')).toBe('r2')
    prismaMock.orgRole.findFirst.mockResolvedValueOnce(null)
    await expect(getOrgRoleIdByCodeOrThrow('X')).rejects.toThrow('ROLE_NOT_FOUND:X')
  })
})
