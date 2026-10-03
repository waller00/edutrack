'use client'
import InasistenciasSection from '@/components/libreta/InasistenciasSection'
import SectionHeader from '@/components/libreta/SectionHeader'

export default function Page() {
  return (
    <>
      <SectionHeader id="inasistencias" />
      <InasistenciasSection />
    </>
  )
}
