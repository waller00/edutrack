'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import ElegirLibreta from '@/components/libreta/ElegirLibreta'

export default function Page() {
  return (
    <RoleGuard permission="gradebook.read">
      <main className="responsive-page max-w-[1200px]">
        <ElegirLibreta section="evaluaciones" title="Evaluaciones" hint="Las evaluaciones del período y la nota de cada estudiante." />
      </main>
    </RoleGuard>
  )
}
