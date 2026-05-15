import AdminShell from '@/components/AdminShell'
import { AdminSchoolYearProvider } from '@/contexts/AdminSchoolYearContext'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminSchoolYearProvider>
      <AdminShell>{children}</AdminShell>
    </AdminSchoolYearProvider>
  )
}
