'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import AttendanceOverview from './AttendanceOverview'

export default function AttendanceIndicators() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const tab = params?.get('tab')
  return (
    <AttendanceOverview
      initialView={tab === 'faltas' || tab === 'seguidas' ? tab : 'prioridad'}
      onViewChange={(view) => {
        const next = new URLSearchParams(params?.toString())
        next.set('tab', view)
        router.replace(`${pathname}?${next}`, { scroll: false })
      }}
    />
  )
}
