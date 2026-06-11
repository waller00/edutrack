import { describe, it, expect, beforeEach, vi } from 'vitest'

const { prismaMock, getSessionMock } = vi.hoisted(() => ({
  prismaMock: { user: { findUnique: vi.fn() } },
  getSessionMock: vi.fn(),
}))
vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../auth/session-store.js', () => ({ getSession: getSessionMock }))

import { userPermissionScope, requirePermission, requireRole, requireAnyRole, authGuard } from './auth.js'

function mockRes() {
  const res: Record<string, ReturnType<typeof vi.fn>> = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res as never
}

describe('auth middleware — permisos y sesión', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockReset()
    getSessionMock.mockReset()
  })

  it('userPermissionScope: en test resuelve por roleCode', async () => {
    expect(await userPermissionScope('u1', 'x', 'ADMIN')).toBe('all')
    expect(await userPermissionScope('u1', 'x', 'STAFF')).toBe('own')
  })

  it('userPermissionScope: rama DB (sin roleCode)', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ isActive: true, isApproved: true, orgRole: { active: true, grants: [{ scope: 'ALL' }] } })
    expect(await userPermissionScope('u1', 'users.read')).toBe('all')
    prismaMock.user.findUnique.mockResolvedValueOnce({ isActive: true, isApproved: true, orgRole: { active: true, grants: [{ scope: 'OWN' }] } })
    expect(await userPermissionScope('u1', 'users.read')).toBe('own')
    prismaMock.user.findUnique.mockResolvedValueOnce({ isActive: true, isApproved: true, orgRole: { active: true, grants: [] } })
    expect(await userPermissionScope('u1', 'users.read')).toBeNull()
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    expect(await userPermissionScope('u1', 'users.read')).toBeNull()
  })

  it('requirePermission: sin userId → 403', async () => {
    const res = mockRes()
    const next = vi.fn()
    await requirePermission('x')({ user: {} } as never, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('requirePermission: scope ok → next; requiredScope all con own → 403', async () => {
    const next1 = vi.fn()
    await requirePermission('x')({ user: { id: 'u1', role: 'STAFF' } } as never, mockRes(), next1)
    expect(next1).toHaveBeenCalled()

    const res2 = mockRes()
    await requirePermission('x', 'all')({ user: { id: 'u1', role: 'STAFF' } } as never, res2, vi.fn())
    expect(res2.status).toHaveBeenCalledWith(403)
  })

  it('requireRole / requireAnyRole sin coincidencia → 403', () => {
    const res = mockRes()
    requireRole('ADMIN')({} as never, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(403)

    const res2 = mockRes()
    requireAnyRole(['STAFF'])({ user: { role: 'ADMIN' } } as never, res2, vi.fn())
    expect(res2.status).toHaveBeenCalledWith(403)
  })

  it('authGuard: sesión válida adjunta el usuario', async () => {
    getSessionMock.mockResolvedValueOnce({ userId: 'u1', email: 'a@b.com', role: 'ADMIN' })
    prismaMock.user.findUnique.mockResolvedValueOnce({ isActive: true, isApproved: true, lockUntil: null })
    const req: Record<string, unknown> = { cookies: { sid: 's1' }, headers: {} }
    const next = vi.fn()
    await authGuard(req as never, mockRes(), next)
    expect(next).toHaveBeenCalled()
    expect((req.user as { id: string }).id).toBe('u1')
  })

  it('authGuard: expirada (401), inhabilitada (403) y bloqueada (403)', async () => {
    getSessionMock.mockResolvedValueOnce(null)
    let res = mockRes()
    await authGuard({ cookies: { sid: 's' }, headers: {} } as never, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(401)

    getSessionMock.mockResolvedValueOnce({ userId: 'u1' })
    prismaMock.user.findUnique.mockResolvedValueOnce({ isActive: false, isApproved: true, lockUntil: null })
    res = mockRes()
    await authGuard({ cookies: { sid: 's' }, headers: {} } as never, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(403)

    getSessionMock.mockResolvedValueOnce({ userId: 'u1' })
    prismaMock.user.findUnique.mockResolvedValueOnce({ isActive: true, isApproved: true, lockUntil: new Date(Date.now() + 60_000) })
    res = mockRes()
    await authGuard({ cookies: { sid: 's' }, headers: {} } as never, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(403)
  })
})
