'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import ElegirLibreta from '@/components/libreta/ElegirLibreta'

export default function Page() {
  return (
    <RoleGuard permission="gradebook.read">
      <main className="responsive-page max-w-[1200px]">
        <ElegirLibreta section="cierre" title="Cerrar Prom. por Libreta" hint="Cerrar el período de una libreta completa." />
      </main>
    </RoleGuard>
  )
}
