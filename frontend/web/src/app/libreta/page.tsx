'use client'

import { useAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import RoleGuard from '@/components/auth/RoleGuard'
import MisLibretas from '@/components/libreta/MisLibretas'
import ModuleHeader from '@/components/common/ModuleHeader'

export default function MisLibretasPage() {
  const { me } = useAuth()
  const allBooks = hasPermission(me, 'gradebook.read', 'all')
  return (
    <RoleGuard permission="gradebook.read">
      <main className="responsive-page max-w-[1500px] space-y-4">
        <ModuleHeader id={allBooks ? 'gradebooks' : 'my-gradebooks'}>
          <p className="text-sm text-slate-500">
            {allBooks
              ? 'Encontrá un grupo y abrí su libreta para consultar o trabajar.'
              : 'Encontrá tu grupo y abrí su libreta para trabajar.'}
          </p>
        </ModuleHeader>
        <MisLibretas />
      </main>
    </RoleGuard>
  )
}
