'use client'
import RoleGuard from '@/components/auth/RoleGuard'
import EndorsementGrid from '@/components/admin/gradebook/EndorsementGrid'

export default function Page() {
  return (
    <RoleGuard permission="gradebook.read" permissionScope="all">
      <main className="responsive-page max-w-[1500px] space-y-4">
        <header className="border-b border-gray-200 pb-2">
          <h1 className="text-lg font-bold uppercase tracking-wide text-slate-700">Visado de libretas</h1>
          <p className="text-sm text-gray-600">
            Períodos cerrados esperando revisión. Observar es de adscripción, dirección e inspección;
            visar, sólo de Dirección.
          </p>
        </header>
        <EndorsementGrid />
      </main>
    </RoleGuard>
  )
}
