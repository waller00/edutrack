'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import ElegirLibreta from '@/components/libreta/ElegirLibreta'

export default function Page() {
  return (
    <RoleGuard permission="gradebook.read">
      <main className="responsive-page max-w-[1200px]">
        <ElegirLibreta section="inasistencias" title="Inasistencias de Libreta" hint="Faltas y llegadas tarde acumuladas, por libreta." />
      </main>
    </RoleGuard>
  )
}
