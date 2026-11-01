'use client'
import { Suspense } from 'react'
import SectionHeader from '@/components/libreta/SectionHeader'
import VisadoDireccionSection from '@/components/libreta/VisadoDireccionSection'

export default function Page() {
  return (
    <>
      <SectionHeader id="visado" />
      {/* La reunión llega en la URL (`?reunion=`): useSearchParams necesita un Suspense para prerenderizar. */}
      <Suspense fallback={null}>
        <VisadoDireccionSection />
      </Suspense>
    </>
  )
}
