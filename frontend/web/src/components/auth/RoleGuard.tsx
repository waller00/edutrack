'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
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
  const [ok, setOk] = useState(false)

  useEffect(() => {
    if (loading) return
    const redirect = resolveAuthRedirect(me, pathname)
    if (redirect) { globalThis.location.href = redirect; return }
    if (!me) return // inalcanzable: sin sesión `resolveAuthRedirect` ya devolvió el login
    const roleAllowed = !allow || allow.includes(me.role)
    const permissionAllowed = permission ? hasAnyPermission(me, permission, permissionScope) : false
    if (!roleAllowed && !permissionAllowed) { globalThis.location.href = '/'; return }
    setOk(true)
  }, [me, loading, pathname, allow, permission, permissionScope])

  if (!ok) return <AuthLoadingScreen />
  return <>{children}</>
}
