'use client'
import RoleGuard from '@/components/auth/RoleGuard'
import AcademicConfigPanel from '@/components/admin/academic-config/AcademicConfigPanel'

export default function Page() {
  return (
    <RoleGuard permission="academic-config.manage" permissionScope="all">
      <main className="responsive-page max-w-[1400px] space-y-4">
        <header className="border-b border-gray-200 pb-2">
          <h1 className="text-lg font-bold uppercase tracking-wide text-slate-700">Configuración de libreta</h1>
          <p className="text-sm text-gray-600">
            Períodos, escalas de evaluación y tipos de actividad. Se cambian acá, sin tocar el código.
          </p>
        </header>
        <AcademicConfigPanel />
      </main>
    </RoleGuard>
  )
}
