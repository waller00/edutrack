'use client'
import RoleGuard from '@/components/auth/RoleGuard'
import AcademicConfigPanel from '@/components/admin/academic-config/AcademicConfigPanel'
import { BookOpen } from 'lucide-react'

export default function Page() {
  return (
    <RoleGuard permission="academic-config.manage" permissionScope="all">
      <main className="responsive-page max-w-[1400px] space-y-5">
        <header className="flex items-start gap-3">
          <span className="hidden rounded-xl bg-emerald-50 p-3 text-emerald-600 sm:block">
            <BookOpen className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Configuración de libreta
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Organizá el calendario, las calificaciones y las alertas
              académicas.
            </p>
          </div>
        </header>
        <AcademicConfigPanel />
      </main>
    </RoleGuard>
  )
}
