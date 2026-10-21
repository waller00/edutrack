'use client'
import { useLibreta } from '@/contexts/LibretaContext'
import MessagesPanel from '@/components/gradebook/MessagesPanel'
import ObservacionesDireccion from '@/components/libreta/ObservacionesDireccion'
import SectionHeader from '@/components/libreta/SectionHeader'

/** "Mensajes de Dirección y Adscripción": lo que la supervisión le observó y le escribió al docente en esta libreta. */
export default function Page() {
  const { gradeBookId, detail } = useLibreta()
  if (!detail) return null
  return (
    <>
      <SectionHeader id="mensajes" />
      <div className="space-y-5">
        <ObservacionesDireccion gradeBookId={gradeBookId} />
        <MessagesPanel gradeBookId={gradeBookId} variant="teacher" readOnly={detail.status === 'ARCHIVED'} />
      </div>
    </>
  )
}
