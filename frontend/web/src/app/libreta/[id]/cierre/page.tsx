'use client'

import { useLibreta } from '@/contexts/LibretaContext'
import CierreAlumnoBoard from '@/components/gradebook/CierreAlumnoBoard'
import ObservacionesDireccion from '@/components/libreta/ObservacionesDireccion'

export default function Page() {
  const { gradeBookId, detail } = useLibreta()
  if (!detail) return null
  return (
    <div className="space-y-5">
      {/* Lo que el visado le observó al docente es lo que tiene que corregir y volver a cerrar. */}
      {detail.access.level === 'OWNER' && <ObservacionesDireccion gradeBookId={gradeBookId} />}
      <CierreAlumnoBoard gradeBookId={gradeBookId} detail={detail} />
    </div>
  )
}
