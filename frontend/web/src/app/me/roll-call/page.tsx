'use client'

import { Suspense } from 'react'
import RoleGuard from '@/components/auth/RoleGuard'
import RollCallTodayList from '@/components/rollcall/RollCallTodayList'

export default function MyRollCallPage() {
  return (
    <RoleGuard permission="student-attendance.take" permissionScope="own">
      <main className="responsive-page max-w-3xl">
        {/* El día va en la URL: useSearchParams necesita un Suspense para prerenderizar. */}
        <Suspense fallback={null}>
          <RollCallTodayList />
        </Suspense>
      </main>
    </RoleGuard>
  )
}
