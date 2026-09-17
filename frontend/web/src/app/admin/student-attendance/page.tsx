'use client'

import { ClipboardList } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import PendingRollCallsPanel from '@/components/admin/student-attendance/PendingRollCallsPanel'

export default function AdminStudentAttendancePage() {
  return (
    <RoleGuard permission="student-attendance.manage" permissionScope="all">
      <main className="responsive-page max-w-[1400px] space-y-5">
        <header className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
            <ClipboardList className="h-7 w-7 text-emerald-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Solo administración</p>
            <h1 className="text-2xl font-bold text-gray-900">Pase de lista (control)</h1>
            <p className="text-sm text-gray-600">
              Seguimiento de las listas que los docentes toman en sus clases.
            </p>
          </div>
        </header>

        <PendingRollCallsPanel />
      </main>
    </RoleGuard>
  )
}
