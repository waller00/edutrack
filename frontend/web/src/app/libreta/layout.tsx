import AdminShell from '@/components/admin/AdminShell'
import AuthGuard from '@/components/auth/AuthGuard'
import { AdminSchoolYearProvider } from '@/contexts/AdminSchoolYearContext'

/**
 * El módulo de libreta comparte el shell administrativo por el selector de ciclo lectivo: toda
 * la libreta está acotada a un año, y ese selector es el mismo que usa el resto del sistema.
 */
export default function LibretaLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AdminSchoolYearProvider>
        <AdminShell>{children}</AdminShell>
      </AdminSchoolYearProvider>
    </AuthGuard>
  )
}
