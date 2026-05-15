import AdminProfilesPanel from '@/components/AdminProfilesPanel'
import RoleGuard from '@/components/RoleGuard'

export default function AdminProfilesPage() {
  return (
    <RoleGuard permission="profiles.manage">
      <AdminProfilesPanel />
    </RoleGuard>
  )
}
