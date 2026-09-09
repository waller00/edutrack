'use client'
import { useLibreta } from '@/contexts/LibretaContext'
import EvaluationsBoard from '@/components/gradebook/EvaluationsBoard'

export default function Page() {
  const { gradeBookId, detail } = useLibreta()
  if (!detail) return null
  return <EvaluationsBoard gradeBookId={gradeBookId} detail={detail} />
}
