import AdminAuditPanel from '@/components/admin/AdminAuditPanel'
import RoleGuard from '@/components/auth/RoleGuard'

export default function AdminAuditPage() {
  return (
    <RoleGuard permission="audit.read" permissionScope="all">
      <AdminAuditPanel />
    </RoleGuard>
  )
}
