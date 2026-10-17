import { beforeEach, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
const m = vi.hoisted(() => ({
  find: vi.fn(), process: vi.fn(),
  redis: { incr: vi.fn(), expire: vi.fn(), ttl: vi.fn() },
}))
vi.mock('../db/redis.js', () => ({ getRedis: () => m.redis }))
vi.mock('../db/prisma.js', () => ({ prisma: {
  biometricDevice: { update: vi.fn(async () => ({})) }, biometricUserMapping: { findFirst: vi.fn(async () => ({ id: 'mapping' })) },
} }))
vi.mock('../services/biometric-ingest-core.js', () => ({ findBiometricDeviceByAdmsSn: m.find, processBiometricIngest: m.process }))
vi.mock('../services/biometric-link.js', () => ({ tryCaptureBiometricLinkPunch: vi.fn(async () => ({ handled: false })) }))
import routes from '../routes/zkteco-iclock.js'
import { rateLimit } from '../middlewares/rate-limit.js'
beforeEach(() => {
  vi.clearAllMocks()
  m.find.mockResolvedValue({ id: 'device', code: 'device', isActive: true, allowedIps: ['192.0.2.10'], timezone: 'America/Montevideo' })
  m.process.mockResolvedValue({ ok: true, duplicate: false })
  m.redis.incr.mockResolvedValue(1)
})
it('AUD-05: spoofed leftmost forwarded IP passes the ADMS allowlist without a device secret', async () => {
  const a = express(); a.set('trust proxy', 1); a.use(express.text({ type: () => true })); a.use('/iclock', routes)
  const body = '1001\t2026-10-14 10:00:00\t0\t1\n'
  const blocked = await request(a).post('/iclock/cdata?SN=AUDIT&table=ATTLOG').set('X-Forwarded-For', '198.51.100.20').send(body)
  expect(blocked.status).toBe(403)
  const forged = await request(a).post('/iclock/cdata?SN=AUDIT&table=ATTLOG').set('X-Forwarded-For', '192.0.2.10, 198.51.100.20').send(body)
  expect(forged.status).toBe(200)
  expect(m.process).toHaveBeenCalledTimes(1)
})
it('AUD-05: the rate limiter keys by attacker-supplied leftmost forwarded IP', async () => {
  const a = express(); a.set('trust proxy', 1)
  a.get('/', rateLimit({ bucket: 'audit', max: 1, windowSeconds: 60 }), (_req, res) => res.send('ok'))
  await request(a).get('/').set('X-Forwarded-For', '192.0.2.11, 198.51.100.20')
  await request(a).get('/').set('X-Forwarded-For', '192.0.2.12, 198.51.100.20')
  expect(m.redis.incr.mock.calls.map(x => x[0])).toEqual(['bff:rl:audit:192.0.2.11', 'bff:rl:audit:192.0.2.12'])
})
