import { redirect } from 'next/navigation'
import { legacyAttendanceIndicatorsTarget, searchParamsOf } from '@/lib/admin/legacy-reports'

/**
 * "Indicadores de asistencia de estudiantes" es ahora la sección Asistencia de Indicadores de
 * estudiantes. La ruta queda por los avisos guardados: `?tab=` abre la lista de cada uno.
 */
export default function Page({ searchParams }: Readonly<{ searchParams?: Record<string, string | string[] | undefined> }>) {
  redirect(legacyAttendanceIndicatorsTarget(searchParamsOf(searchParams)))
}
