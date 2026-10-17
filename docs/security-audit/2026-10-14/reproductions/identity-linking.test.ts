import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(), sync: vi.fn() }))
vi.mock('../db/prisma.js', () => ({ prisma: { user: { findUnique: m.findUnique, update: m.update } } }))
vi.mock('../auth/keycloak.js', () => ({ syncKeycloakUserIdentity: m.sync }))
import { provisionUserFromClaims } from '../auth/keycloak-provisioning.js'
beforeEach(() => { vi.clearAllMocks(); m.sync.mockResolvedValue(undefined) })
it('AUD-02: unverified email from a different OIDC subject is matched to an existing privileged user', async () => {
  m.findUnique.mockResolvedValue({ id: 'existing-admin', email: 'admin@example.test', username: 'admin', orgRole: { code: 'ADMIN' } })
  const result = await provisionUserFromClaims({ sub: 'unrelated-subject', email: 'admin@example.test', email_verified: false })
  expect(result).toMatchObject({ id: 'existing-admin', role: 'ADMIN' })
  expect(m.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'admin@example.test' } }))
})
it('AUD-02: username fallback can overwrite the local account email for a different subject', async () => {
  m.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'existing-admin', email: 'original@example.test', username: 'admin', orgRole: { code: 'ADMIN' } })
  const result = await provisionUserFromClaims({ sub: 'unrelated-subject', email: 'other@example.test', preferred_username: 'admin', email_verified: false })
  expect(result.id).toBe('existing-admin')
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: 'other@example.test' }) }))
})
