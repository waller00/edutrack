'use client'

import { useLibreta } from '@/contexts/LibretaContext'
import CierreAlumnoBoard from '@/components/gradebook/CierreAlumnoBoard'

export default function Page() {
  const { gradeBookId, detail } = useLibreta()
  if (!detail) return null
  // Lo que el visado le observó al docente lo muestra el panel de cada reunión, dentro del cierre.
  return <CierreAlumnoBoard gradeBookId={gradeBookId} detail={detail} />
}
