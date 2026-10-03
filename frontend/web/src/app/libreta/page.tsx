'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import MisLibretas from '@/components/libreta/MisLibretas'

export default function MisLibretasPage() {
  return (
    <RoleGuard permission="gradebook.read">
      <main className="responsive-page max-w-[1500px] space-y-4">
        <header className="border-b border-gray-200 pb-2">
          <h1 className="text-lg font-bold uppercase tracking-wide text-slate-700">Mis Libretas</h1>
        </header>
        <MisLibretas />
      </main>
    </RoleGuard>
  )
}
