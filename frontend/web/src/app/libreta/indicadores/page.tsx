'use client'
import { Suspense } from 'react'
import { BarChart3 } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import AcademicIntelligence from '@/components/admin/analytics-academic/AcademicIntelligence'

export default function Page() {
  return (
    // Adscripción entra sólo por los reportes de estudiantes: ve el seguimiento de notas.
    <RoleGuard permission={['academic-analytics.read', 'student-reports.read']} permissionScope="all">
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
              Consultá el resumen, el rendimiento, la gestión o el seguimiento
              de quiénes tienen notas bajas.
            </p>
          </div>
        </header>
        {/* `?view=seguimiento` se lee de la URL: useSearchParams necesita un Suspense para prerenderizar. */}
        <Suspense fallback={null}>
          <AcademicIntelligence />
        </Suspense>
      </main>
    </RoleGuard>
  )
}
