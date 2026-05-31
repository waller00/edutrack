function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
}

export type LoginProvider = 'google'

export function loginUrl(returnTo = '/', provider?: LoginProvider): string {
  const base = `${apiBase()}/auth/login`
  const safe = returnTo && returnTo.startsWith('/') ? returnTo : '/'
  const params = new URLSearchParams({ returnTo: safe })
  if (provider) params.set('provider', provider)
  return `${base}?${params.toString()}`
}

export function logoutUrl(): string {
  return `${apiBase()}/auth/logout`
}
