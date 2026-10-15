'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import GuidePage from '@/components/guide/GuidePage'

/** Guía de EduTrack: para cualquier usuario con sesión; muestra sólo lo que puede usar. */
export default function GuiaPage() {
  return (
    <RoleGuard>
      <GuidePage />
    </RoleGuard>
  )
}
