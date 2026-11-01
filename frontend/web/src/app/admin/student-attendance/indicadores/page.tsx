'use client'

import { Suspense } from 'react'
import RoleGuard from '@/components/auth/RoleGuard'
import ModuleHeader from '@/components/common/ModuleHeader'
import AttendanceIndicators from '@/components/admin/student-attendance/AttendanceIndicators'

export default function StudentAttendanceIndicatorsPage() {
  return (
    <RoleGuard permission="student-reports.read" permissionScope="all">
      <main className="responsive-page max-w-[1400px] space-y-5">
        <ModuleHeader id="student-attendance-indicators" />
        <Suspense fallback={null}><AttendanceIndicators /></Suspense>
      </main>
    </RoleGuard>
  )
}
