import { describe, it, expect, beforeEach } from 'vitest'
import {
  loginUrl,
  logoutUrl,
  accountSecurityUrl,
  accountPasswordUrl,
  accountTwoFactorUrl,
} from './urls'

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test'
})

describe('loginUrl', () => {
  it('arma returnTo seguro y default', () => {
    expect(loginUrl('/dashboard')).toBe('http://api.test/auth/login?returnTo=%2Fdashboard')
    // returnTo no relativo → cae a "/"
    expect(loginUrl('https://evil.com')).toBe('http://api.test/auth/login?returnTo=%2F')
    expect(loginUrl()).toBe('http://api.test/auth/login?returnTo=%2F')
  })

  it('incluye provider cuando se pasa', () => {
    expect(loginUrl('/', 'google')).toContain('provider=google')
  })
})

describe('logoutUrl', () => {
  it('sin returnTo devuelve base', () => {
    expect(logoutUrl()).toBe('http://api.test/auth/logout')
  })

  it('rechaza protocol-relative y absolutos', () => {
    expect(logoutUrl('//evil.com')).toBe('http://api.test/auth/logout')
    expect(logoutUrl('http://evil')).toBe('http://api.test/auth/logout')
  })

  it('acepta path relativo', () => {
    expect(logoutUrl('/login')).toBe('http://api.test/auth/logout?returnTo=%2Flogin')
  })
})

describe('account URLs', () => {
  it('construye los endpoints de cuenta', () => {
    expect(accountSecurityUrl()).toBe('http://api.test/auth/account/security')
    expect(accountPasswordUrl()).toBe('http://api.test/auth/account/password')
    expect(accountTwoFactorUrl()).toBe('http://api.test/auth/account/2fa')
  })
})
