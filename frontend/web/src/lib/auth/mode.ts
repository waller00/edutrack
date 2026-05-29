// Modo de autenticacion del frontend.
// "legacy": JWT propio (login/registro/2FA in-app).
// "keycloak": BFF OIDC (login/logout delegados a Keycloak).
export const AUTH_MODE = process.env.NEXT_PUBLIC_AUTH_MODE || 'legacy'
export const isKeycloak = AUTH_MODE === 'keycloak'

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
}

export function keycloakLoginUrl(returnTo = '/'): string {
  const base = `${apiBase()}/auth/login`
  const safe = returnTo && returnTo.startsWith('/') ? returnTo : '/'
  return `${base}?returnTo=${encodeURIComponent(safe)}`
}

export function keycloakLogoutUrl(): string {
  return `${apiBase()}/auth/logout`
}
