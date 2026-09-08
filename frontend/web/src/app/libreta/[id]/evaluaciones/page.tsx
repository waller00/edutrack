'use client'
import { useLibreta } from '@/contexts/LibretaContext'
import AssessmentsPanel from '@/components/gradebook/AssessmentsPanel'
import SectionHeader from '@/components/libreta/SectionHeader'

export default function Page() {
  const { gradeBookId, detail } = useLibreta()
  if (!detail) return null
  return (
    <>
      <SectionHeader id="evaluaciones" />
      <AssessmentsPanel gradeBookId={gradeBookId} canGrade={detail.access.canGrade} />
    </>
  )
}
