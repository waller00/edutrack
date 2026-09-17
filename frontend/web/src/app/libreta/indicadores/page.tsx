'use client'
import RoleGuard from '@/components/auth/RoleGuard'
import AcademicDashboard from '@/components/admin/analytics-academic/AcademicDashboard'

export default function Page() {
  return (
    <RoleGuard permission="academic-analytics.read" permissionScope="all">
      <main className="responsive-page max-w-[1500px] space-y-4">
        <header className="border-b border-gray-200 pb-2">
          <h1 className="text-lg font-bold uppercase tracking-wide text-slate-700">Inteligencia académica</h1>
          <p className="text-sm text-gray-600">
            Indicadores de estudiantes, rendimiento y gestión, con comparativas por asignatura,
            curso y ciclo lectivo.
          </p>
        </header>
        <AcademicDashboard />
      </main>
    </RoleGuard>
  )
}
