'use client'

import { useAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import { BookMarked } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import MisLibretas from '@/components/libreta/MisLibretas'

export default function MisLibretasPage() {
  const { me } = useAuth()
  const allBooks = hasPermission(me, 'gradebook.read', 'all')
  return (
    <RoleGuard permission="gradebook.read">
      <main className="responsive-page max-w-[1500px] space-y-4">
        <header className="flex items-start gap-3">
          <span className="hidden rounded-xl bg-emerald-50 p-3 text-emerald-700 sm:block">
            <BookMarked className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {allBooks ? 'Libretas' : 'Mis Libretas'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {allBooks
                ? 'Encontrá un grupo y abrí su libreta para consultar o trabajar.'
                : 'Encontrá tu grupo y abrí su libreta para trabajar.'}
            </p>
          </div>
        </header>
        <MisLibretas />
      </main>
    </RoleGuard>
  )
}
