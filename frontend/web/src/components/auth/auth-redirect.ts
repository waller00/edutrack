import type { AuthMe } from '@/contexts/AuthContext'

/**
 * Arma el destino de login preservando la ruta original en `returnTo`, que
 * `/login` ya sabe consumir para volver a donde el usuario quería entrar.
 */
export function loginRedirect(pathname?: string | null): string {
  const safe = pathname && pathname.startsWith('/') && !pathname.startsWith('//') ? pathname : null
  if (!safe || safe === '/login') return '/login'
  return `/login?${new URLSearchParams({ returnTo: safe }).toString()}`
}

/**
 * Verificaciones de sesión comunes a todas las rutas protegidas: devuelve la URL
 * a la que hay que redirigir, o `null` si el usuario puede seguir. No cubre
 * permisos por módulo: de eso se ocupa `RoleGuard`.
 */
export function resolveAuthRedirect(me: AuthMe | null, pathname?: string | null): string | null {
  if (!me) return loginRedirect(pathname)
  if (me.needsProfileCompletion) return '/onboarding'
  if (!me.isActive || !me.isApproved) return '/'
  return null
}
