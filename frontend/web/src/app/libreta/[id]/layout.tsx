'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import { LibretaProvider } from '@/contexts/LibretaContext'
import LibretaShell from '@/components/libreta/LibretaShell'

export default function LibretaDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { id: string }
}) {
  return (
    <RoleGuard permission="gradebook.read">
      <main className="responsive-page max-w-[1500px]">
        <LibretaProvider gradeBookId={params.id}>
          <LibretaShell>{children}</LibretaShell>
        </LibretaProvider>
      </main>
    </RoleGuard>
  )
}
