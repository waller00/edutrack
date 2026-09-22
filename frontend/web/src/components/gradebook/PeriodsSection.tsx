'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import PeriodClosurePanel from './PeriodClosurePanel'

type PeriodRow = {
  periodId: string
  code: string
  name: string
  closesOn: string | null
  status: 'OPEN' | 'CLOSED' | 'REOPENED'
  closedLate: boolean
  assessmentCount: number
  gradedStudents: number
}

const STATUS_LABELS: Record<PeriodRow['status'], string> = {
  OPEN: 'Abierto',
  CLOSED: 'Cerrado',
  REOPENED: 'Reabierto',
}

/** Texto además del color en el estado del período (RNF 7.2). */
const STATUS_STYLES: Record<PeriodRow['status'], string> = {
  OPEN: 'border-gray-200 bg-gray-50 text-gray-700',
  CLOSED: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  REOPENED: 'border-amber-200 bg-amber-50 text-amber-900',
}

export default function PeriodsSection({
  gradeBookId,
  decimals,
}: {
  gradeBookId: string
  decimals: number
}) {
  const [periods, setPeriods] = useState<PeriodRow[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ data: PeriodRow[] }>(`/gradebook/${gradeBookId}/periods`)
      setPeriods(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los períodos')
    } finally {
      setLoading(false)
    }
  }, [gradeBookId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando períodos…
      </p>
    )
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center gap-2">
        <CalendarCheck className="h-4 w-4 text-gray-400" aria-hidden />
        <h2 className="text-sm font-semibold text-gray-900">Cierre de períodos</h2>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {periods.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-5 text-sm text-gray-500">
          El ciclo no tiene períodos configurados para este nivel.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {periods.map((period) => (
            <li key={period.periodId}>
              <button
                type="button"
                onClick={() => setSelected(selected === period.periodId ? null : period.periodId)}
                aria-expanded={selected === period.periodId}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-2 text-left transition hover:bg-gray-50"
              >
                <span className="text-sm font-medium text-gray-900">{period.name}</span>
                <span className={`rounded border px-1.5 py-0.5 text-xs ${STATUS_STYLES[period.status]}`}>
                  {STATUS_LABELS[period.status]}
                  {period.closedLate && ' · fuera de plazo'}
                </span>
                <span className="ml-auto text-xs text-gray-500">
                  {period.assessmentCount} evaluación(es) · {period.gradedStudents} cerradas
                </span>
              </button>
              {selected === period.periodId && (
                <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-3">
                  <PeriodClosurePanel gradeBookId={gradeBookId} periodId={period.periodId} decimals={decimals} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
