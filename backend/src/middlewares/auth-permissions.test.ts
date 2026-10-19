import { describe, it, expect, beforeEach, vi } from 'vitest'

const { prismaMock, getSessionMock } = vi.hoisted(() => ({
  prismaMock: { user: { findUnique: vi.fn() } },
  getSessionMock: vi.fn(),
}))
vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../auth/session-store.js', () => ({ getSession: getSessionMock }))

import { userPermissionScope, requirePermission, requireRole, requireAnyRole, authGuard } from './auth.js'
import { requestCacheMiddleware } from '../lib/request-cache.js'

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

  it('userPermissionScope: en test resuelve con la matriz de fábrica del rol', async () => {
    expect(await userPermissionScope('u1', 'users.read', 'ADMIN')).toBe('all')
    expect(await userPermissionScope('u1', 'gradebook.grade', 'TEACHER')).toBe('own')
    // Antes cualquier permiso daba `own` a cualquier rol: un docente "podía" editar eventos.
    expect(await userPermissionScope('u1', 'events.update', 'TEACHER')).toBeNull()
    expect(await userPermissionScope('u1', 'gradebook.grade', 'DIRECCION')).toBeNull()
    expect(await userPermissionScope('u1', 'gradebook.plan', 'DIRECCION')).toBeNull()
    expect(await userPermissionScope('u1', 'x', 'ROL_INEXISTENTE')).toBeNull()
  })

  const grant = (code: string, scope: 'ALL' | 'OWN') => ({ scope, permission: { code } })
  const account = (grants: unknown[], over: Record<string, unknown> = {}) => ({
    isActive: true,
    isApproved: true,
    orgRole: { active: true, grants },
    ...over,
  })

  it('userPermissionScope: rama DB (sin roleCode)', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(account([grant('users.read', 'ALL')]))
    expect(await userPermissionScope('u1', 'users.read')).toBe('all')
    prismaMock.user.findUnique.mockResolvedValueOnce(account([grant('users.read', 'OWN')]))
    expect(await userPermissionScope('u1', 'users.read')).toBe('own')
    prismaMock.user.findUnique.mockResolvedValueOnce(account([grant('otro.permiso', 'ALL')]))
    expect(await userPermissionScope('u1', 'users.read')).toBeNull()
    prismaMock.user.findUnique.mockResolvedValueOnce(account([grant('users.read', 'ALL')], { isActive: false }))
    expect(await userPermissionScope('u1', 'users.read')).toBeNull()
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    expect(await userPermissionScope('u1', 'users.read')).toBeNull()
  })

  it('authGuard y los permisos comparten una sola consulta por pedido', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', email: 'u1@e.com', role: 'STAFF' })
    prismaMock.user.findUnique.mockResolvedValue(
      account([grant('gradebook.read', 'OWN')], { emailVerifiedAt: new Date(), lockUntil: null }),
    )
    const req: any = { cookies: { sid: 'sid-1' } }
    const scope = await new Promise((resolve, reject) => {
      requestCacheMiddleware({} as never, {} as never, () => {
        authGuard(req, mockRes(), async () => {
          try {
            resolve(await userPermissionScope('u1', 'gradebook.read'))
          } catch (e) {
            reject(e)
          }
        })
      })
    })
    expect(scope).toBe('own')
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1)
  })

  it('userPermissionScope: con un grant ALL y otro OWN del mismo permiso gana ALL', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(account([grant('x', 'OWN'), grant('x', 'ALL'), grant('x', 'OWN')]))
    expect(await userPermissionScope('u1', 'x')).toBe('all')
  })

  it('userPermissionScope: dentro de un pedido consulta la matriz una sola vez', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      account([grant('gradebook.read', 'OWN'), grant('gradebook.grade', 'OWN')]),
    )
    const scopes = await new Promise<unknown[]>((resolve, reject) => {
      requestCacheMiddleware({} as never, {} as never, () => {
        Promise.all([
          userPermissionScope('u1', 'gradebook.read'),
          userPermissionScope('u1', 'gradebook.grade'),
          userPermissionScope('u1', 'gradebook.plan'),
        ]).then(resolve, reject)
      })
    })
    expect(scopes).toEqual(['own', 'own', null])
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1)

    // Otro pedido vuelve a leer la matriz: un cambio de permisos aplica en el pedido siguiente.
    await userPermissionScope('u1', 'gradebook.read')
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2)
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
    await requirePermission('gradebook.read')({ user: { id: 'u1', role: 'TEACHER' } } as never, mockRes(), next1)
    expect(next1).toHaveBeenCalled()

    const res2 = mockRes()
    await requirePermission('gradebook.read', 'all')({ user: { id: 'u1', role: 'TEACHER' } } as never, res2, vi.fn())
    expect(res2.status).toHaveBeenCalledWith(403)

    // Un permiso que el rol no tiene en su matriz no pasa, aunque el alcance pedido sea `own`.
    const res3 = mockRes()
    await requirePermission('users.read')({ user: { id: 'u1', role: 'STAFF' } } as never, res3, vi.fn())
    expect(res3.status).toHaveBeenCalledWith(403)
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
