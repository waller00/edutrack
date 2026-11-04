import { redirect } from 'next/navigation'
import { legacyAcademicTarget, searchParamsOf } from '@/lib/admin/legacy-reports'

/**
 * "Rendimiento académico" se unió con los indicadores de asistencia en Indicadores de estudiantes.
 * La ruta queda para que los enlaces viejos no se rompan; `?view=` abre la sección que corresponde.
 */
export default function Page({ searchParams }: Readonly<{ searchParams?: Record<string, string | string[] | undefined> }>) {
  redirect(legacyAcademicTarget(searchParamsOf(searchParams)))
}
