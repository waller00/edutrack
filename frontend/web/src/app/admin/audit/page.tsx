import AdminAuditPanel from '@/components/AdminAuditPanel'
import RoleGuard from '@/components/RoleGuard'

export default function AdminAuditPage() {
  return (
    <RoleGuard permission="audit.read">
      <AdminAuditPanel />
    </RoleGuard>
  )
}
