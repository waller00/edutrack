function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
}

export function loginUrl(returnTo = '/'): string {
  const base = `${apiBase()}/auth/login`
  const safe = returnTo && returnTo.startsWith('/') ? returnTo : '/'
  return `${base}?returnTo=${encodeURIComponent(safe)}`
}

export function logoutUrl(): string {
  return `${apiBase()}/auth/logout`
}
