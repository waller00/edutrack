import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Sentry from '@sentry/nextjs'

vi.mock('@sentry/nextjs', () => ({
  setUser: vi.fn(),
}))

describe('user-session observability', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_LOGROCKET_APP_ID', 'demo/edutrack')
    vi.stubEnv('NEXT_PUBLIC_LOGROCKET_FORCE', 'true')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.mocked(Sentry.setUser).mockClear()
  })

  it('identifica en Sentry con solo el id', async () => {
    const { identifyObservabilityUser } = await import('./user-session')
    identifyObservabilityUser('user-123')
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'user-123' })
  })

  it('identifica en LogRocket cuando ya esta registrado', async () => {
    const { identifyObservabilityUser, registerLogRocketUserIdentify } = await import('./user-session')
    const identify = vi.fn()
    registerLogRocketUserIdentify(identify)
    identifyObservabilityUser('user-456')
    expect(identify).toHaveBeenCalledWith('user-456')
  })

  it('encola el id hasta que LogRocket este listo', async () => {
    const { identifyObservabilityUser, registerLogRocketUserIdentify } = await import('./user-session')
    identifyObservabilityUser('user-789')
    const identify = vi.fn()
    registerLogRocketUserIdentify(identify)
    expect(identify).toHaveBeenCalledWith('user-789')
  })

  it('limpia el usuario en Sentry', async () => {
    const { identifyObservabilityUser, clearObservabilityUser } = await import('./user-session')
    identifyObservabilityUser('user-999')
    clearObservabilityUser()
    expect(Sentry.setUser).toHaveBeenLastCalledWith(null)
  })
})
