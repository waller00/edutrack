'use client'

import { useParams } from 'next/navigation'
import RoleGuard from '@/components/auth/RoleGuard'
import RollCallSheet from '@/components/rollcall/RollCallSheet'

export default function RollCallSheetPage() {
  const params = useParams<{ eventId: string; ymd: string }>()
  return (
    <RoleGuard permission="student-attendance.take" permissionScope="own">
      <main className="responsive-page max-w-3xl">
        <RollCallSheet eventId={String(params.eventId)} ymd={String(params.ymd)} />
      </main>
    </RoleGuard>
  )
}
