'use client'

import { Suspense } from 'react'
import RoleGuard from '@/components/auth/RoleGuard'
import ModuleHeader from '@/components/common/ModuleHeader'
import StudentIndicators from '@/components/admin/student-indicators/StudentIndicators'

export default function StudentIndicatorsPage() {
  return (
    // Adscripción entra con los reportes de estudiantes: ve las secciones que salen de ellos.
    <RoleGuard permission={['academic-analytics.read', 'student-reports.read']} permissionScope="all">
      <main className="responsive-page max-w-[1500px] space-y-4">
        <ModuleHeader id="student-indicators" />
        {/* La sección y el boletín se leen de la URL: useSearchParams necesita un Suspense para prerenderizar. */}
        <Suspense fallback={null}>
          <StudentIndicators />
        </Suspense>
      </main>
    </RoleGuard>
  )
}
