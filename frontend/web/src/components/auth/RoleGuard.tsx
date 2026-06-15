'use client'
import { useEffect, useState } from 'react'
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
  const [ok, setOk] = useState(false)

  useEffect(() => {
    if (loading) return
    if (!me) { globalThis.location.href = '/login'; return }
    if (me.needsProfileCompletion) { globalThis.location.href = '/onboarding'; return }
    if (!me.isActive || !me.isApproved) { globalThis.location.href = '/'; return }
    const roleAllowed = !allow || allow.includes(me.role)
    const permissionAllowed = hasAnyPermission(me, permission, permissionScope)
    if (!roleAllowed && !permissionAllowed) { globalThis.location.href = '/'; return }
    setOk(true)
  }, [me, loading, allow, permission, permissionScope])

  if (!ok) return null
  return <>{children}</>
}
