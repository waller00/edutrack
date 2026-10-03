'use client'

import { Suspense } from 'react'
import { BellRing } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import StudentReports from '@/components/admin/student-reports/StudentReports'

export default function StudentReportsPage() {
  return (
    <RoleGuard permission="student-reports.read" permissionScope="all">
      <main className="responsive-page max-w-[1400px] space-y-5">
        <header className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100">
            <BellRing className="h-7 w-7 text-amber-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Adscripción · Dirección</p>
            <h1 className="text-2xl font-bold text-gray-900">Reportes de estudiantes</h1>
            <p className="text-sm text-gray-600">
              Notas bajas por materia y curso, bajas de un boletín a otro, faltas seguidas y alumnos con 18 o 25 faltas.
            </p>
          </div>
        </header>
        {/* useSearchParams necesita un Suspense para que la página se pueda prerenderizar. */}
        <Suspense fallback={null}>
          <StudentReports />
        </Suspense>
      </main>
    </RoleGuard>
  )
}
