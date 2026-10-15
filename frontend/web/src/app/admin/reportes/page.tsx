'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { legacyReportsTarget } from '@/lib/admin/legacy-reports'

function RedirectToNewPlace() {
  const router = useRouter()
  const params = useSearchParams()
  const tab = params?.get('tab') ?? null
  useEffect(() => {
    router.replace(legacyReportsTarget(tab))
  }, [router, tab])
  return <main className="responsive-page max-w-lg text-center text-sm text-gray-600">Redirigiendo…</main>
}

/**
 * Ruta legacy. Los reportes de estudiantes se repartieron: las faltas están en Asistencia de
 * estudiantes y las notas en el Seguimiento de Rendimiento académico. La ruta se conserva por los
 * avisos guardados y los enlaces viejos.
 */
export default function LegacyStudentReportsPage() {
  return (
    <Suspense fallback={null}>
      <RedirectToNewPlace />
    </Suspense>
  )
}
