'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Ruta legacy. Antes explicaba que EduTrack no registraba asistencia de alumnos; desde que
 * los docentes pasan lista esa afirmación dejó de ser cierta, así que redirige al pase de
 * lista. La ruta se conserva por los enlaces guardados.
 */
export default function StudentAttendanceRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/me/roll-call')
  }, [router])
  return <main className="responsive-page max-w-lg text-center text-sm text-gray-600">Redirigiendo…</main>
}
