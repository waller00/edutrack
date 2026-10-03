'use client'
import { useLibreta } from '@/contexts/LibretaContext'
import MessagesPanel from '@/components/gradebook/MessagesPanel'
import SectionHeader from '@/components/libreta/SectionHeader'

export default function Page() {
  const { gradeBookId, detail } = useLibreta()
  if (!detail) return null
  return (
    <>
      <SectionHeader id="mensajes" />
      <MessagesPanel gradeBookId={gradeBookId} readOnly={detail.status === 'ARCHIVED'} />
    </>
  )
}
