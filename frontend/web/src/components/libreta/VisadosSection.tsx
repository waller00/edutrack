'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useLibreta } from '@/contexts/LibretaContext'

type Section = { section: string; status: string; occurredAt: string | null; observations: string | null }

type PeriodRow = {
  periodId: string
  name: string
  status: 'OPEN' | 'CLOSED' | 'REOPENED'
}

type EndorsementRow = {
  gradeBookPeriodId: string
  gradeBookId: string
  period: { id: string; name: string }
  sections: Section[]
  overallStatus: string
  blockingSections: string[]
}

const SECTION_LABELS: Record<string, string> = {
  GRADES: 'Calificaciones',
  CLOSURE: 'Cierre',
  JUDGEMENTS: 'Juicios',
  ALL: 'Período',
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendiente',
  OBSERVED: 'Observado',
  CORRECTED: 'Corregido',
  ENDORSED: 'Visado',
}

const STATUS_STYLES: Record<string, { className: string; symbol: string }> = {
  PENDING: { className: 'border-gray-200 bg-gray-50 text-gray-700', symbol: '·' },
  OBSERVED: { className: 'border-amber-200 bg-amber-50 text-amber-900', symbol: '▲' },
  CORRECTED: { className: 'border-blue-200 bg-blue-50 text-blue-900', symbol: '↻' },
  ENDORSED: { className: 'border-emerald-200 bg-emerald-50 text-emerald-800', symbol: '✓' },
}

function Badge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.PENDING
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${style.className}`}>
      <span aria-hidden>{style.symbol}</span>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

/**
 * Estado de visado de la libreta, **visto desde el docente**: qué le observaron y qué ya está
 * visado. No se actúa desde acá — visar es de Dirección, y la grilla de acción vive en el módulo
 * de supervisión.
 */
export default function VisadosSection() {
  const { gradeBookId } = useLibreta()
  const [rows, setRows] = useState<EndorsementRow[]>([])
  const [periods, setPeriods] = useState<PeriodRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [grid, periodList] = await Promise.all([
        api<{ data: EndorsementRow[] }>('/admin/gradebook/endorsements').catch(() => ({ data: [] as EndorsementRow[] })),
        api<{ data: PeriodRow[] }>(`/gradebook/${gradeBookId}/periods`),
      ])
      setRows(grid.data)
      setPeriods(periodList.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el estado de visado')
    } finally {
      setLoading(false)
    }
  }, [gradeBookId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando visados…
      </p>
    )
  }

  if (error) {
    return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
  }

  const closed = periods.filter((p) => p.status === 'CLOSED')

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-gray-600">
        Sólo se visan períodos cerrados. Visar es atribución de Dirección; acá ves en qué estado
        está cada uno y qué te observaron.
      </p>

      {closed.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
          Todavía no cerraste ningún período, así que no hay nada para visar.
        </p>
      ) : (
        <ul className="space-y-2">
          {closed.map((period) => {
            // La grilla trae los períodos de TODAS las libretas del ciclo: hay que cruzar por
            // libreta y período, no por nombre. Dos libretas comparten el nombre "Mayo", y
            // emparejar por ahí mostraría el visado —y las observaciones— de otro docente.
            const row = rows.find(
              (r) => r.gradeBookId === gradeBookId && r.period.id === period.periodId,
            )
            return (
              <li key={period.periodId} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{period.name}</span>
                  <Badge status={row?.overallStatus ?? 'PENDING'} />
                </div>
                {row && (
                  <ul className="mt-2 space-y-1">
                    {row.sections
                      .filter((s) => s.section !== 'ALL')
                      .map((s) => (
                        <li key={s.section} className="flex flex-wrap items-baseline gap-2 text-xs">
                          <span className="w-28 text-gray-600">{SECTION_LABELS[s.section] ?? s.section}</span>
                          <Badge status={s.status} />
                          {s.observations && <span className="text-gray-700">{s.observations}</span>}
                        </li>
                      ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
