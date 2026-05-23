import AdminProfilesPanel from '@/components/admin/AdminProfilesPanel'
import RoleGuard from '@/components/auth/RoleGuard'

export default function AdminProfilesPage() {
  return (
    <RoleGuard permission="profiles.manage">
      <AdminProfilesPanel />
    </RoleGuard>
  )
}
