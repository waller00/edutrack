import { apiBaseUrl } from '@/lib/api/base-url'

function apiBase(): string {
  return apiBaseUrl()
}

export type LoginProvider = 'google'

export function loginUrl(returnTo = '/', provider?: LoginProvider): string {
  const base = `${apiBase()}/auth/login`
  const safe = returnTo && returnTo.startsWith('/') ? returnTo : '/'
  const params = new URLSearchParams({ returnTo: safe })
  if (provider) params.set('provider', provider)
  return `${base}?${params.toString()}`
}

export function logoutUrl(returnTo?: string): string {
  const base = `${apiBase()}/auth/logout`
  const safe = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : ''
  if (!safe) return base
  return `${base}?${new URLSearchParams({ returnTo: safe }).toString()}`
}

export function accountSecurityUrl(): string {
  return `${apiBase()}/auth/account/security`
}

export function accountPasswordUrl(): string {
  return `${apiBase()}/auth/account/password`
}

export function accountTwoFactorUrl(): string {
  return `${apiBase()}/auth/account/2fa`
}

export function accountTwoFactorStatusUrl(): string {
  return `${apiBase()}/auth/account/2fa/status`
}

export function accountTwoFactorDisableUrl(): string {
  return `${apiBase()}/auth/account/2fa/disable`
}

export function accountRecoveryCodesUrl(): string {
  return `${apiBase()}/auth/account/recovery-codes`
}
