'use client'

import { Suspense } from 'react'
import { useLibreta } from '@/contexts/LibretaContext'
import EvaluationsBoard from '@/components/gradebook/EvaluationsBoard'

function Board() {
  const { gradeBookId, detail, reload } = useLibreta()
  if (!detail) return null
  return <EvaluationsBoard gradeBookId={gradeBookId} detail={detail} onStudentsChanged={() => void reload()} />
}

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Cargando evaluaciones…</p>}>
      <Board />
    </Suspense>
  )
}
