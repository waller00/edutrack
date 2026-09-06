'use client'

import { SlidersHorizontal } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import AcademicConfigPanel from '@/components/admin/academic-config/AcademicConfigPanel'

export default function AdminAcademicConfigPage() {
  return (
    <RoleGuard permission="academic-config.manage" permissionScope="all">
      <main className="responsive-page max-w-[1400px] space-y-5">
        <header className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
            <SlidersHorizontal className="h-7 w-7 text-emerald-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Solo administración</p>
            <h1 className="text-2xl font-bold text-gray-900">Configuración académica</h1>
            <p className="text-sm text-gray-600">
              Períodos, escalas de evaluación y tipos de actividad de la libreta. Se cambian acá, sin tocar el
              código, para poder seguir los cambios de reglamento.
            </p>
          </div>
        </header>

        <AcademicConfigPanel />
      </main>
    </RoleGuard>
  )
}
