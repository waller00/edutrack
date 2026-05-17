'use client'
import RoleGuard from '@/components/auth/RoleGuard'
import { BarChart3 } from 'lucide-react'

export default function StudentAttendance() {
  return (
    <RoleGuard permission="attendance.read" permissionScope="own">
      <main className="mx-auto max-w-5xl p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
            <BarChart3 className="h-7 w-7 text-emerald-600" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Mis asistencias</h1>
            <p className="text-sm text-gray-600">Resumen de asistencias, filtros por fecha y estado.</p>
          </div>
        </div>
        <div className="border rounded p-4 bg-white">Tabla/Gráfico próximamente.</div>
      </main>
    </RoleGuard>
  )
} 
