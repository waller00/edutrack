'use client'
import RoleGuard from '@/components/auth/RoleGuard'
import CompletenessPanel from '@/components/admin/gradebook/CompletenessPanel'

export default function Page() {
  return (
    <RoleGuard permission="gradebook.review" permissionScope="all">
      <main className="responsive-page max-w-[1400px] space-y-4">
        <header className="border-b border-gray-200 pb-2">
          <h1 className="text-lg font-bold uppercase tracking-wide text-slate-700">Control de libretas</h1>
          <p className="text-sm text-gray-600">
            Qué libretas están incompletas en cada período y aviso al docente por notificación interna.
          </p>
        </header>
        <CompletenessPanel />
      </main>
    </RoleGuard>
  )
}
