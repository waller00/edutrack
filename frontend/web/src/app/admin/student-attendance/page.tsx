'use client'

import { Suspense } from 'react'
import RoleGuard from '@/components/auth/RoleGuard'
import StudentAttendanceTabs from '@/components/admin/student-attendance/StudentAttendanceTabs'
import ModuleHeader from '@/components/common/ModuleHeader'

/**
 * Trabajo diario por estudiante: consultar marcas, cargar licencias y justificar faltas.
 * Los enlaces antiguos a alertas se derivan a la pantalla de indicadores.
 */
export default function AdminStudentAttendancePage() {
  return (
    <RoleGuard
      permission={['student-attendance.read', 'student-reports.read']}
      permissionScope="all"
    >
      <main className="responsive-page max-w-[1400px] space-y-5">
        <ModuleHeader id="student-attendance" />
        {/* La pestaña va en la URL: useSearchParams necesita un Suspense para prerenderizar. */}
        <Suspense fallback={null}>
          <StudentAttendanceTabs />
        </Suspense>
      </main>
    </RoleGuard>
  )
}
