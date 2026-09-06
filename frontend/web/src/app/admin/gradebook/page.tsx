'use client'

import { LayoutGrid } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import GroupMatrix from '@/components/admin/gradebook/GroupMatrix'

export default function AdminGradeBookPage() {
  return (
    <RoleGuard permission="gradebook.read" permissionScope="all">
      <main className="responsive-page max-w-[1500px] space-y-5">
        <header className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
            <LayoutGrid className="h-7 w-7 text-emerald-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-gray-900">Vista de grupo</h1>
            <p className="text-sm text-gray-600">
              Matriz Estudiante × Asignatura del período: calificación, juicio, pendientes y alertas.
            </p>
          </div>
        </header>

        <GroupMatrix />
      </main>
    </RoleGuard>
  )
}
