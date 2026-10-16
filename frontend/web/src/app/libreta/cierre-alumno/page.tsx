'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import ElegirLibreta from '@/components/libreta/ElegirLibreta'

export default function Page() {
  return (
    <RoleGuard permission="gradebook.read">
      <main className="responsive-page max-w-[1200px]">
        <ElegirLibreta
          section="cierre"
          title="Cierre de períodos"
          hint="Conducta (C), rendimiento (R) e informe alumno por alumno, y el cierre de cada entrega."
        />
      </main>
    </RoleGuard>
  )
}
