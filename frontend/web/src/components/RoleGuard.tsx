'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

type RoleGuardMe = {
  role: string
  isActive?: boolean
  isApproved?: boolean
  needsProfileCompletion?: boolean
  permissionIds?: string[]
  permissions?: Array<{ id: string; scope?: 'own' | 'all' }>
}

function hasAnyPermission(me: RoleGuardMe, permission?: string | string[], permissionScope?: 'own' | 'all') {
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
  const [ok, setOk] = useState(false)

  useEffect(() => {
    api<RoleGuardMe>('/auth/me')
      .then((me: RoleGuardMe) => {
        if (!me) { window.location.href = '/login'; return }
        if (me.needsProfileCompletion) { window.location.href = '/onboarding'; return }
        if (!me.isActive || !me.isApproved) { window.location.href = '/'; return }
        const roleAllowed = !allow || allow.includes(me.role)
        const permissionAllowed = hasAnyPermission(me, permission, permissionScope)
        if (!roleAllowed && !permissionAllowed) { window.location.href = '/'; return }
        setOk(true)
      })
      .catch(() => (window.location.href = '/login'))
  }, [allow, permission])

  if (!ok) return null
  return <>{children}</>
} 
