'use client'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import AuthLoadingScreen from '@/components/auth/AuthLoadingScreen'
import { resolveAuthRedirect } from '@/components/auth/auth-redirect'
import { useAuth } from '@/contexts/AuthContext'
import { hasAnyPermission } from '@/lib/auth/permissions'

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
  const redirect = !loading ? resolveAuthRedirect(me, pathname) : null
  const roleAllowed = Boolean(
    me && (allow ? allow.includes(me.role) : !permission),
  )
  const permissionAllowed = Boolean(
    permission && hasAnyPermission(me, permission, permissionScope),
  )
  const allowed = roleAllowed || permissionAllowed

  useEffect(() => {
    if (loading) return
    if (redirect) {
      globalThis.location.href = redirect
      return
    }
    if (!me) return // inalcanzable: sin sesión `resolveAuthRedirect` ya devolvió el login
    if (!allowed) globalThis.location.href = '/'
  }, [me, loading, redirect, allowed])

  if (loading || !me || redirect || !allowed) return <AuthLoadingScreen />
  return <>{children}</>
}
