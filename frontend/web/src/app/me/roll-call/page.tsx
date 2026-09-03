'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import RollCallTodayList from '@/components/rollcall/RollCallTodayList'

export default function MyRollCallPage() {
  return (
    <RoleGuard permission="student-attendance.take" permissionScope="own">
      <main className="responsive-page max-w-3xl">
        <RollCallTodayList />
      </main>
    </RoleGuard>
  )
}
