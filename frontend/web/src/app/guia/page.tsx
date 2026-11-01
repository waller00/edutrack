'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import GuidePage from '@/components/guide/GuidePage'

/** Conserva el enlace de la antigua guía como entrada al onboarding de cada perfil. */
export default function GuiaPage() {
  return (
    <RoleGuard>
      <GuidePage />
    </RoleGuard>
  )
}
