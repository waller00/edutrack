import AdminAuditPanel from '@/components/admin/AdminAuditPanel'
import RoleGuard from '@/components/auth/RoleGuard'

export default function AdminAuditPage() {
  return (
    <RoleGuard permission="audit.read">
      <AdminAuditPanel />
    </RoleGuard>
  )
}
