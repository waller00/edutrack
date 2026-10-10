'use client'

import { Suspense } from 'react'
import { ClipboardList } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import StudentAttendanceTabs from '@/components/admin/student-attendance/StudentAttendanceTabs'

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
        <header className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
            <ClipboardList className="h-7 w-7 text-emerald-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Adscripción · Dirección</p>
            <h1 className="text-2xl font-bold text-gray-900">Asistencia de estudiantes</h1>
            <p className="text-sm text-gray-600">
              Justificaciones, faltas seguidas, estudiantes con 18 o 25 faltas y listas sin pasar.
            </p>
          </div>
        </header>
        {/* La pestaña va en la URL: useSearchParams necesita un Suspense para prerenderizar. */}
        <Suspense fallback={null}>
          <StudentAttendanceTabs />
        </Suspense>
      </main>
    </RoleGuard>
  )
}
