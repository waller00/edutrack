'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { api } from '@/lib/api/client'
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
 * Lo que Dirección le observó al docente en el visado, arriba de sus mensajes. Es lo que antes
 * vivía en la sección "Visados" del docente: visar no es suyo, pero lo que le observaron sí le
 * importa, porque es lo que tiene que corregir.
 *
 * Lee `/gradebook/:id/endorsements`, que es de esta libreta y respeta su acceso.
 */
export default function ObservacionesDireccion({ gradeBookId }: { gradeBookId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api<{ data: Row[] }>(`/gradebook/${gradeBookId}/endorsements`)
      setRows(res.data)
    } catch {
      // Sin el estado de visado los mensajes siguen sirviendo: no se bloquea la pantalla.
      setRows([])
    }
  }, [gradeBookId])

  useEffect(() => {
    void load()
  }, [load])

  if (!rows) return null

  const observed = rows.flatMap((row) =>
    REVIEW_SECTIONS.map((section) => ({ row, state: sectionState(row, section) })).filter(
      ({ state }) => state.status === 'OBSERVED',
    ),
  )
  const endorsed = rows.filter((row) => row.overallStatus === 'ENDORSED')
  if (observed.length === 0 && endorsed.length === 0) return null

  return (
    <section className="space-y-2" aria-labelledby="observaciones-direccion">
      <h2 id="observaciones-direccion" className="text-sm font-semibold text-gray-900">
        Visado de Dirección
      </h2>
      {observed.length > 0 && (
        <ul className="space-y-2">
          {observed.map(({ row, state }) => (
            <li
              key={`${row.gradeBookPeriodId}-${state.section}`}
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="font-medium">
                  Te observaron {ENDORSEMENT_SECTION_LABELS[state.section].toLowerCase()} · {row.period.name}
                </span>
                {state.observations && <span className="block whitespace-pre-wrap">{state.observations}</span>}
                {row.periodStatus === 'REOPENED' && (
                  <span className="mt-1 block text-xs">
                    El período está reabierto para que lo corrijas{row.reopenReason ? `: ${row.reopenReason}` : ''}.
                    Cuando termines, volvé a cerrarlo.
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {endorsed.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {endorsed.map((row) => (
            <li
              key={row.gradeBookPeriodId}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-900"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              {row.period.name}
              <EndorsementBadge status={row.overallStatus} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
