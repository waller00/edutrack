'use client'
import RoleGuard from '@/components/auth/RoleGuard'
import GroupMatrix from '@/components/admin/gradebook/GroupMatrix'

/** Vista de reunión (RF-070): la misma matriz, en tamaño de proyección. */
export default function Page() {
  return (
    <RoleGuard permission="gradebook.read" permissionScope="all">
      <main className="responsive-page max-w-[1800px] space-y-4">
        <header className="border-b border-gray-200 pb-2">
          <h1 className="text-lg font-bold uppercase tracking-wide text-slate-700">Reunión de profesores</h1>
          <p className="text-sm text-gray-600">
            La matriz del grupo en tamaño de proyección, para mirarla entre todos.
          </p>
        </header>
        <GroupMatrix projection />
      </main>
    </RoleGuard>
  )
}
