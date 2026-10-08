'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useLibreta } from '@/contexts/LibretaContext'
import EndorsementBadge from '@/components/gradebook/EndorsementBadge'
import {
  ENDORSEMENT_SECTION_LABELS,
  REVIEW_SECTIONS,
  sectionState,
  type EndorsementHistoryEntry,
  type EndorsementRow,
} from '@/lib/gradebook/endorsements'

type Row = EndorsementRow & { reopenReason: string | null; history: EndorsementHistoryEntry[] }

/**
 * Estado de visado de la libreta, **visto desde el docente**: qué le observaron y qué ya está
 * visado. No se actúa desde acá — visar es de Dirección y la grilla vive en supervisión.
 *
 * Lee `/gradebook/:id/endorsements`, que es de esta libreta y respeta su acceso. Antes leía la
 * grilla de supervisión, que exige alcance total: al docente le daba 403 y veía todo "Pendiente"
 * aunque le hubieran observado algo.
 */
export default function VisadosSection() {
  const { gradeBookId } = useLibreta()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ data: Row[] }>(`/gradebook/${gradeBookId}/endorsements`)
      setRows(res.data)
      setError(null)
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

  // Lo cerrado, y lo que se reabrió para corregir: tiene que seguir mostrando qué se observó.
  const visible = rows.filter((row) => row.periodStatus === 'CLOSED' || row.history.length > 0)

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-gray-600">
        Sólo se visan las reuniones cerradas. Visar es atribución de Dirección; acá ves en qué estado
        está cada una y qué te observaron. Si hay algo para corregir, administración reabre el período.
      </p>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
          Todavía no cerraste ninguna reunión, así que no hay nada para visar.
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((row) => (
            <li key={row.gradeBookPeriodId} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-900">{row.period.name}</span>
                <EndorsementBadge status={row.overallStatus} />
              </div>
              {row.periodStatus === 'REOPENED' && (
                <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                  Reabierto para corregir{row.reopenReason ? `: ${row.reopenReason}` : ''}. Cuando termines,
                  volvé a cerrarlo.
                </p>
              )}
              <ul className="mt-2 space-y-1">
                {REVIEW_SECTIONS.map((section) => {
                  const state = sectionState(row, section)
                  return (
                    <li key={section} className="flex flex-wrap items-baseline gap-2 text-xs">
                      <span className="w-28 text-gray-600">{ENDORSEMENT_SECTION_LABELS[section]}</span>
                      <EndorsementBadge status={state.status} />
                      {state.observations && <span className="text-gray-700">{state.observations}</span>}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
