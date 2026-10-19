import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROFILE_PERMISSIONS } from '../identity/profile-permissions-defaults.js'
import { userPermissionScope } from './auth.js'
import { requireSchoolYearAccess } from './school-year-access.js'

vi.mock('./auth.js', () => ({
  userPermissionScope: vi.fn(),
  requirePermission: () => (req: any, res: any, next: any) => req.user?.role === 'ADMIN'
    ? next() : res.status(403).json({ message: 'Prohibido' }),
}))

function app(role?: string) {
  const a = express()
  a.use((req, _res, next) => {
    if (role) (req as any).user = { sub: 'u1', role }
    next()
  })
  a.use('/admin/school-years', requireSchoolYearAccess, (_req, res) => res.json({ allowed: true }))
  return a
}

beforeEach(() => {
  vi.mocked(userPermissionScope).mockImplementation(async (_user, permission, role) => {
    const grants = DEFAULT_PROFILE_PERMISSIONS[role as keyof typeof DEFAULT_PROFILE_PERMISSIONS] ?? []
    return grants.find(grant => grant.id === permission && grant.enabled)?.scope ?? null
  })
})

describe('catálogo de ciclos para los perfiles que usan el selector', () => {
  it.each(['ADMIN', 'TEACHER', 'ADSCRIPTO', 'DIRECCION'])('permite consultar catálogo y ciclo activo a %s', async role => {
    for (const path of ['', '/active', '/active/']) {
      expect((await request(app(role)).get('/admin/school-years' + path)).status).toBe(200)
    }
  })

  it.each(['TEACHER', 'STAFF', 'ADSCRIPTO', 'DIRECCION'])('no habilita gestión, métricas o planes a %s', async role => {
    expect((await request(app(role)).post('/admin/school-years')).status).toBe(403)
    expect((await request(app(role)).patch('/admin/school-years/y1')).status).toBe(403)
    expect((await request(app(role)).delete('/admin/school-years/y1')).status).toBe(403)
    expect((await request(app(role)).get('/admin/school-years/compare-metrics')).status).toBe(403)
    expect((await request(app(role)).get('/admin/school-years/y1/start-plan')).status).toBe(403)
  })

  it('conserva todas las operaciones de administración', async () => {
    expect((await request(app('ADMIN')).post('/admin/school-years')).status).toBe(200)
    expect((await request(app('ADMIN')).get('/admin/school-years/compare-metrics')).status).toBe(200)
  })

  it('admite un perfil personalizado por permiso y respeta su alcance', async () => {
    vi.mocked(userPermissionScope).mockImplementation(async (_user, permission) => permission === 'attendance.read' ? 'own' : null)
    expect((await request(app('PERSONALIZADO')).get('/admin/school-years')).status).toBe(403)
    vi.mocked(userPermissionScope).mockImplementation(async (_user, permission) => permission === 'attendance.read' ? 'all' : null)
    expect((await request(app('PERSONALIZADO')).get('/admin/school-years')).status).toBe(200)
    expect((await request(app('PERSONALIZADO')).post('/admin/school-years')).status).toBe(403)
  })

  it('rechaza cuentas sin módulos y solicitudes sin sesión', async () => {
    expect((await request(app('SIN_PERMISOS')).get('/admin/school-years')).status).toBe(403)
    expect((await request(app()).get('/admin/school-years')).status).toBe(403)
  })

  it('rechaza la consulta si falla la comprobación de permisos', async () => {
    vi.mocked(userPermissionScope).mockRejectedValue(new Error('db unavailable'))
    expect((await request(app('TEACHER')).get('/admin/school-years')).status).toBe(403)
  })
})
