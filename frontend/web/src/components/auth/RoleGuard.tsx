'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import AuthLoadingScreen from '@/components/auth/AuthLoadingScreen'
import { resolveAuthRedirect } from '@/components/auth/auth-redirect'
import { useAuth, type AuthMe } from '@/contexts/AuthContext'

function hasAnyPermission(me: AuthMe, permission?: string | string[], permissionScope?: 'own' | 'all') {
  if (!permission) return false
  const required = Array.isArray(permission) ? permission : [permission]
  const scopes = new Map<string, 'own' | 'all'>()
  for (const id of me.permissionIds ?? []) scopes.set(id, 'own')
  for (const p of me.permissions ?? []) scopes.set(p.id, p.scope === 'all' ? 'all' : 'own')
  return required.some((id) => {
    const scope = scopes.get(id)
    return Boolean(scope && (!permissionScope || scope === permissionScope || scope === 'all'))
  })
}

export default function RoleGuard({
  allow,
  permission,
  permissionScope,
  children,
}: {
  allow?: string[]
  permission?: string | string[]
  permissionScope?: 'own' | 'all'
  children: React.ReactNode
}) {
  const { me, loading } = useAuth()
  const pathname = usePathname()
  const [ok, setOk] = useState(false)

  useEffect(() => {
    if (loading) return
    const redirect = resolveAuthRedirect(me, pathname)
    if (redirect) { globalThis.location.href = redirect; return }
    if (!me) return // inalcanzable: sin sesión `resolveAuthRedirect` ya devolvió el login
    const roleAllowed = !allow || allow.includes(me.role)
    const permissionAllowed = hasAnyPermission(me, permission, permissionScope)
    if (!roleAllowed && !permissionAllowed) { globalThis.location.href = '/'; return }
    setOk(true)
  }, [me, loading, pathname, allow, permission, permissionScope])

  if (!ok) return <AuthLoadingScreen />
  return <>{children}</>
}
