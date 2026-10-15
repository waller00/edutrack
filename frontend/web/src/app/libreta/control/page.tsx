'use client'
import RoleGuard from '@/components/auth/RoleGuard'
import CompletenessPanel from '@/components/admin/gradebook/CompletenessPanel'
import ModuleHeader from '@/components/common/ModuleHeader'

export default function Page() {
  return (
    <RoleGuard permission="gradebook.review" permissionScope="all">
      <main className="responsive-page max-w-[1400px] space-y-4">
        <ModuleHeader id="gradebook-control" />
        <CompletenessPanel />
      </main>
    </RoleGuard>
  )
}
