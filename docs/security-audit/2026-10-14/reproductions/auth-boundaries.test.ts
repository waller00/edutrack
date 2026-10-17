// Audit reproductions: passing assertions document existing weaknesses, not desired behavior.
import { beforeEach, expect, it, vi } from 'vitest'
import express from 'express'
import cookieParser from 'cookie-parser'
import request from 'supertest'

const m = vi.hoisted(() => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  session: vi.fn(), save: vi.fn(), exchange: vi.fn(), provision: vi.fn(),
  user: { findUnique: vi.fn() },
}))
vi.mock('../db/redis.js', () => ({ getRedis: () => m.redis }))
vi.mock('../db/prisma.js', () => ({ prisma: { user: m.user } }))
vi.mock('../notifications/email.js', () => ({ sendMail: vi.fn() }))
vi.mock('../auth/session-store.js', () => ({
  getSession: m.session, saveSession: m.save, newSessionId: () => 'audit-session', deleteSession: vi.fn(),
}))
vi.mock('../auth/keycloak-provisioning.js', () => ({
  provisionUserFromClaims: m.provision, SsoRegistrationRequiredError: class extends Error {},
}))
vi.mock('../auth/sso-registration.js', () => ({ createSsoRegistration: vi.fn() }))
vi.mock('../auth/keycloak.js', () => ({
  buildLoginUrl: vi.fn(async () => ({ state: 'attacker-state', codeVerifier: 'verifier', authUrl: 'https://idp.invalid/login' })),
  exchangeCode: m.exchange,
  redirectUri: () => 'https://api.example.test/auth/callback',
  buildAccountConsoleUrl: () => 'https://idp.invalid/account', buildLogoutUrl: vi.fn(),
  deleteKeycloakUserOtpCredentials: vi.fn(), getKeycloakUserIdByEmail: vi.fn(),
  getKeycloakUserOtpStatus: vi.fn(async () => ({ enabled: true })),
  refreshTokens: vi.fn(), triggerKeycloakPasswordReset: vi.fn(), verifyKeycloakUserOtpCode: vi.fn(),
}))
import routes from '../routes/auth-keycloak.js'
import { authGuard } from '../middlewares/auth.js'

function app() {
  const a = express()
  a.use(express.json(), cookieParser())
  a.use('/auth', routes)
  a.get('/protected', authGuard, (_req, res) => res.json({ ok: true }))
  return a
}
beforeEach(() => {
  vi.clearAllMocks()
  process.env.FRONTEND_URL = 'https://app.example.test'
  m.redis.get.mockResolvedValue(JSON.stringify({ codeVerifier: 'verifier', returnTo: '/' }))
  m.exchange.mockResolvedValue({ accessToken: 'mock', expiresAt: Date.now() + 300000, claims: { sub: 'attacker-kc' } })
  m.provision.mockResolvedValue({ id: 'attacker-user', email: 'attacker@example.test', role: 'TEACHER' })
  m.user.findUnique.mockResolvedValue({ isActive: true, isApproved: true, emailVerifiedAt: new Date(), lockUntil: null })
  m.session.mockResolvedValue({ sid: 'expired', userId: 'user', kcId: 'kc', email: 'u@example.test', role: 'TEACHER',
    accessToken: 'performance-baseline', accessTokenExpiresAt: Date.now() - 86400000, createdAt: Date.now() - 86400000 })
})
it('AUD-01: callback without initiating-browser cookie creates a session for the supplied flow', async () => {
  const start = await request(app()).get('/auth/login')
  expect(start.headers['set-cookie']).toBeUndefined()
  // New client, no cookies from the initiator. IdP exchange is mocked as a legitimate attacker code.
  const response = await request(app()).get('/auth/callback?state=attacker-state&code=legitimate-attacker-code')
  expect(response.status).toBe(302)
  expect(response.headers['set-cookie'].join(';')).toContain('sid=audit-session')
  expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 'attacker-user' }))
})
it('AUD-04: expired performance token still authorizes a protected route while Redis session exists', async () => {
  expect((await request(app()).get('/protected').set('Cookie', 'sid=expired')).status).toBe(200)
})
it('control: disabled account is rejected by authGuard', async () => {
  m.user.findUnique.mockResolvedValue({ isActive: false, isApproved: true })
  expect((await request(app()).get('/protected').set('Cookie', 'sid=expired')).status).toBe(403)
})
it('hardening: account endpoints check Redis session without checking disabled account', async () => {
  m.user.findUnique.mockResolvedValue({ isActive: false, isApproved: true })
  expect((await request(app()).get('/auth/account/2fa/status').set('Cookie', 'sid=expired')).status).toBe(200)
  expect(m.user.findUnique).not.toHaveBeenCalled()
})
