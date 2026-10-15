'use client'

import { Suspense } from 'react'
import RoleGuard from '@/components/auth/RoleGuard'
import StudentAttendanceTabs from '@/components/admin/student-attendance/StudentAttendanceTabs'
import ModuleHeader from '@/components/common/ModuleHeader'

/**
 * Asistencia de estudiantes: justificar faltas, seguir a quien falta seguido o llegó a 18/25 faltas,
 * y controlar las listas sin pasar. Antes las faltas vivían en un "Reportes" aparte.
 */
export default function AdminStudentAttendancePage() {
  return (
    <RoleGuard
      permission={['student-attendance.manage', 'student-attendance.justify', 'student-reports.read']}
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
