'use client'
import { BarChart3 } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import AcademicDashboard from '@/components/admin/analytics-academic/AcademicDashboard'

export default function Page() {
  return (
    <RoleGuard permission="academic-analytics.read" permissionScope="all">
      <main className="responsive-page max-w-[1500px] space-y-4">
        <header className="flex items-start gap-3">
          <span className="hidden rounded-xl bg-emerald-50 p-3 text-emerald-700 sm:block">
            <BarChart3 className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Inteligencia académica
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Consultá el resumen y explorá el rendimiento o la gestión cuando
              lo necesites.
            </p>
          </div>
        </header>
        <AcademicDashboard />
      </main>
    </RoleGuard>
  )
}
