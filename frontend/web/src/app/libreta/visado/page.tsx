'use client'
import RoleGuard from '@/components/auth/RoleGuard'
import EndorsementGrid from '@/components/admin/gradebook/EndorsementGrid'
import ModuleHeader from '@/components/common/ModuleHeader'

export default function Page() {
  return (
    <RoleGuard permission="gradebook.read" permissionScope="all">
      <main className="responsive-page max-w-[1500px] space-y-4">
        <ModuleHeader id="gradebook-endorsement">
          <p className="text-sm text-gray-600">
            Observar es de adscripción, dirección e inspección; visar, sólo de Dirección.
          </p>
        </ModuleHeader>
        <EndorsementGrid />
      </main>
    </RoleGuard>
  )
}
