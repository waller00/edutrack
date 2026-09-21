'use client'
import RoleGuard from '@/components/auth/RoleGuard'
import GroupMatrix from '@/components/admin/gradebook/GroupMatrix'

export default function Page() {
  return (
    <RoleGuard permission="gradebook.read" permissionScope="all">
      <main className="responsive-page max-w-[1500px] space-y-4">
        <header className="border-b border-gray-200 pb-2">
          <h1 className="text-lg font-bold uppercase tracking-wide text-slate-700">Vista de grupo</h1>
          <p className="text-sm text-gray-600">
            Matriz Estudiante × Asignatura del período. Abajo podés registrar el{' '}
            <strong>juicio de reunión</strong> por alumno.
          </p>
        </header>
        <GroupMatrix />
      </main>
    </RoleGuard>
  )
}
