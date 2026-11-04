import { redirect } from 'next/navigation'
import { legacyReportsTarget, searchParamsOf } from '@/lib/admin/legacy-reports'

/**
 * Ruta legacy de los primeros Reportes de estudiantes: todo está en Indicadores de estudiantes. La
 * ruta se conserva por los avisos guardados y los enlaces viejos.
 */
export default function LegacyStudentReportsPage({ searchParams }: Readonly<{ searchParams?: Record<string, string | string[] | undefined> }>) {
  redirect(legacyReportsTarget(searchParamsOf(searchParams)))
}
