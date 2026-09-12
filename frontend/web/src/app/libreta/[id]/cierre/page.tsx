'use client'
import { useLibreta } from '@/contexts/LibretaContext'
import PeriodsSection from '@/components/gradebook/PeriodsSection'
import SectionHeader from '@/components/libreta/SectionHeader'

export default function Page() {
  const { gradeBookId, detail } = useLibreta()
  if (!detail) return null
  return (
    <>
      <SectionHeader id="cierre" />
      <PeriodsSection gradeBookId={gradeBookId} decimals={0} />
    </>
  )
}
