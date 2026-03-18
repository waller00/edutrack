'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

export default function RoleGuard({ allow, children }: { allow: ('ADMIN'|'STAFF'|'TEACHER')[]; children: React.ReactNode }) {
  const [ok, setOk] = useState(false)

  useEffect(() => {
    api('/auth/me')
      .then((me:any) => {
        if (!me) { window.location.href = '/login'; return }
        if (me.needsProfileCompletion) { window.location.href = '/onboarding'; return }
        if (!me.isActive || !me.isApproved) { window.location.href = '/'; return }
        if (!allow.includes(me.role)) { window.location.href = '/'; return }
        setOk(true)
      })
      .catch(() => (window.location.href = '/login'))
  }, [allow])

  if (!ok) return null
  return <>{children}</>
} 
