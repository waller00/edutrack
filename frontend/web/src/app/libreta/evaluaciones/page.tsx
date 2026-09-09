'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import ElegirLibreta from '@/components/libreta/ElegirLibreta'

export default function Page() {
  return (
    <RoleGuard permission="gradebook.read">
      <main className="responsive-page max-w-[1200px]">
        <ElegirLibreta section="evaluaciones" title="Evaluaciones" hint="Cartas por alumno: cargar orales, escritos y otras actividades, y ver el detalle." />
      </main>
    </RoleGuard>
  )
}
