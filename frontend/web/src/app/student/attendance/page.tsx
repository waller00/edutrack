'use client'
import RoleGuard from '@/components/RoleGuard'

export default function StudentAttendance() {
  return (
    <RoleGuard allow={['STAFF']}>
      <main className="mx-auto max-w-5xl p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
            <span className="text-emerald-600 text-xl">📊</span>
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