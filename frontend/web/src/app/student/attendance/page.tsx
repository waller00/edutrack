'use client'

import Link from 'next/link'
import RoleGuard from '@/components/auth/RoleGuard'
import { GraduationCap } from 'lucide-react'

export default function StudentAttendance() {
  return (
    <RoleGuard permission="attendance.read" permissionScope="own">
      <main className="responsive-page max-w-2xl space-y-6">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
            <GraduationCap className="h-7 w-7 text-emerald-600" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Asistencia estudiantil</h1>
            <p className="text-sm text-slate-600">
              EduTrack gestiona asistencia del personal docente y administrativo. Los alumnos no fichan por esta
              aplicación.
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-700">
            Si necesitás consultar tu situación académica, contactá a secretaría. Para docentes y staff, usá{' '}
            <Link href="/me/attendance" className="font-medium text-emerald-700 hover:underline">
              Mis asistencias
            </Link>{' '}
            cuando tengas permisos de personal.
          </p>
        </div>
      </main>
    </RoleGuard>
  )
}
