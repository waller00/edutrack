'use client'

import { LineChart } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import AcademicDashboard from '@/components/admin/analytics-academic/AcademicDashboard'

export default function AcademicAnalyticsPage() {
  return (
    <RoleGuard permission="academic-analytics.read" permissionScope="all">
      <main className="responsive-page max-w-[1500px] space-y-5">
        <header className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
            <LineChart className="h-7 w-7 text-emerald-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-gray-900">Inteligencia académica</h1>
            <p className="text-sm text-gray-600">
              Indicadores de estudiantes, rendimiento y gestión de libretas, con comparativas por
              asignatura, curso y ciclo lectivo.
            </p>
          </div>
        </header>

        <AcademicDashboard />
      </main>
    </RoleGuard>
  )
}
