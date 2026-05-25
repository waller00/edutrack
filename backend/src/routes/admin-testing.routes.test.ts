import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import cookieParser from 'cookie-parser'
import { signAccessToken } from '../auth/jwt.js'

const { testingResetPassword } = vi.hoisted(() => ({
  testingResetPassword: () => ['generated', 'test', 'value'].join('-'),
}))

vi.mock('../services/admin-testing-tools.js', () => ({
  isAdminTestingToolsEnabled: vi.fn(() => true),
  getAdminTestingContext: vi.fn().mockResolvedValue({ enabled: true, devices: [], users: [] }),
  simulateAdmsPunchForUser: vi.fn().mockResolvedValue({
    result: { ok: true, duplicate: false, punchId: 'p1', attendanceId: 'a1' },
    device: { id: 'd1', code: 'TEST' },
    mapping: { deviceUserId: 'T123' },
    occurredAt: new Date('2026-05-24T12:00:00.000Z'),
  }),
  wipeOperationalTestingData: vi.fn().mockResolvedValue(undefined),
  resetDatabaseToSingleAdmin: vi.fn().mockResolvedValue({
    admin: { id: 'u1', username: 'testing-admin', email: 'a@e.com' },
    schoolYear: { id: 'sy1', code: 2026, label: 'Ciclo 2026' },
    password: testingResetPassword(),
  }),
}))

import adminTestingRoutes from './admin-testing.js'
import { isAdminTestingToolsEnabled } from '../services/admin-testing-tools.js'

function app() {
  const a = express()
  a.use(express.json())
  a.use(cookieParser())
  a.use('/admin/testing', adminTestingRoutes)
  return a
}

const adminTok = () =>
  signAccessToken({ sub: 'admin-1', email: 'admin@e.com', role: 'ADMIN' as 'ADMIN' })

describe('admin testing routes', () => {
  beforeEach(() => {
    vi.mocked(isAdminTestingToolsEnabled).mockReturnValue(true)
  })

  it('GET /context 401 sin auth', async () => {
    const res = await request(app()).get('/admin/testing/context')
    expect(res.status).toBe(401)
  })

  it('GET /context devuelve contexto', async () => {
    const res = await request(app())
      .get('/admin/testing/context')
      .set('Authorization', `Bearer ${adminTok()}`)
    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(true)
  })

  it('POST /simulate-adms valida body', async () => {
    const res = await request(app())
      .post('/admin/testing/simulate-adms')
      .set('Authorization', `Bearer ${adminTok()}`)
      .send({})
    expect(res.status).toBe(400)
  })

  it('POST /wipe-operational exige confirmación', async () => {
    const res = await request(app())
      .post('/admin/testing/wipe-operational')
      .set('Authorization', `Bearer ${adminTok()}`)
      .send({ confirm: 'NO' })
    expect(res.status).toBe(400)
  })

  it('403 si herramientas deshabilitadas', async () => {
    vi.mocked(isAdminTestingToolsEnabled).mockReturnValue(false)
    const res = await request(app())
      .get('/admin/testing/context')
      .set('Authorization', `Bearer ${adminTok()}`)
    expect(res.status).toBe(403)
  })
})
