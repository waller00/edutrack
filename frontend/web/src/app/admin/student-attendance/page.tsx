'use client'

import { ClipboardList } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import { useAuth, type AuthMe } from '@/contexts/AuthContext'
import PendingRollCallsPanel from '@/components/admin/student-attendance/PendingRollCallsPanel'
import JustificationRangesPanel from '@/components/admin/student-attendance/JustificationRangesPanel'

function hasAllScope(me: AuthMe | null, permission: string): boolean {
  return Boolean(me?.permissions?.some((p) => p.id === permission && p.scope === 'all'))
}

function StudentAttendanceContent() {
  const { me } = useAuth()
  // Adscripción y dirección justifican; sólo administración controla las listas sin pasar.
  const canManage = hasAllScope(me, 'student-attendance.manage')
  const canJustify = hasAllScope(me, 'student-attendance.justify')

  return (
    <main className="responsive-page max-w-[1400px] space-y-5">
      <header className="flex flex-wrap items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
          <ClipboardList className="h-7 w-7 text-emerald-600" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Adscripción · Dirección</p>
          <h1 className="text-2xl font-bold text-gray-900">Pase de lista</h1>
          <p className="text-sm text-gray-600">
            Justificación de faltas y seguimiento de las listas que los docentes toman en sus clases.
          </p>
        </div>
      </header>

      {canJustify && <JustificationRangesPanel />}
      {canManage && <PendingRollCallsPanel />}
    </main>
  )
}

export default function AdminStudentAttendancePage() {
  return (
    <RoleGuard permission={['student-attendance.manage', 'student-attendance.justify']} permissionScope="all">
      <StudentAttendanceContent />
    </RoleGuard>
  )
}
