'use client'

import { Stamp } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import EndorsementGrid from '@/components/admin/gradebook/EndorsementGrid'

export default function EndorsementsPage() {
  return (
    <RoleGuard permission="gradebook.read" permissionScope="all">
      <main className="responsive-page max-w-[1500px] space-y-5">
        <header className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
            <Stamp className="h-7 w-7 text-emerald-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-gray-900">Visado de libretas</h1>
            <p className="text-sm text-gray-600">
              Períodos cerrados esperando revisión. Observar corresponde a adscripción, dirección e
              inspección; visar, sólo a Dirección.
            </p>
          </div>
        </header>

        <EndorsementGrid />
      </main>
    </RoleGuard>
  )
}
