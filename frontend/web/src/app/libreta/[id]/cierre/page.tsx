'use client'

import { useLibreta } from '@/contexts/LibretaContext'
import CierreAlumnoBoard from '@/components/gradebook/CierreAlumnoBoard'

export default function Page() {
  const { gradeBookId, detail } = useLibreta()
  if (!detail) return null
  return <CierreAlumnoBoard gradeBookId={gradeBookId} detail={detail} />
}
