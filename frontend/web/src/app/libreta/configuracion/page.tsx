'use client'
import RoleGuard from '@/components/auth/RoleGuard'
import AcademicConfigPanel from '@/components/admin/academic-config/AcademicConfigPanel'
import ModuleHeader from '@/components/common/ModuleHeader'

export default function Page() {
  return (
    <RoleGuard permission="academic-config.manage" permissionScope="all">
      <main className="responsive-page max-w-[1400px] space-y-5">
        <ModuleHeader id="gradebook-config" />
        <AcademicConfigPanel />
      </main>
    </RoleGuard>
  )
}
