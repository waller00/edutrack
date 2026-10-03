import AdminShell from '@/components/admin/AdminShell'
import AuthGuard from '@/components/auth/AuthGuard'
import { AdminSchoolYearProvider } from '@/contexts/AdminSchoolYearContext'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AdminSchoolYearProvider>
        <AdminShell>{children}</AdminShell>
      </AdminSchoolYearProvider>
    </AuthGuard>
  )
}
