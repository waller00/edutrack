'use client'
import { Suspense } from 'react'
import RoleGuard from '@/components/auth/RoleGuard'
import AcademicIntelligence from '@/components/admin/analytics-academic/AcademicIntelligence'
import ModuleHeader from '@/components/common/ModuleHeader'

export default function Page() {
  return (
    // Adscripción entra sólo por los reportes de estudiantes: ve el seguimiento de notas.
    <RoleGuard permission={['academic-analytics.read', 'student-reports.read']} permissionScope="all">
      <main className="responsive-page max-w-[1500px] space-y-4">
        <ModuleHeader id="academic-performance">
          <p className="text-sm text-slate-500">
            Consultá el resumen, el rendimiento, la gestión o el seguimiento de quiénes tienen notas bajas.
          </p>
        </ModuleHeader>
        {/* `?view=seguimiento` se lee de la URL: useSearchParams necesita un Suspense para prerenderizar. */}
        <Suspense fallback={null}>
          <AcademicIntelligence />
        </Suspense>
      </main>
    </RoleGuard>
  )
}
