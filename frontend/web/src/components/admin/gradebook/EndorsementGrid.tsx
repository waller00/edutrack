'use client'

import Link from 'next/link'
import { ArrowRight, Loader2 } from 'lucide-react'
import { observedLabels, reviewState, visadoHref, type EndorsementRow } from '@/lib/gradebook/endorsements'
import { groupParams, type GroupFilter } from '@/lib/gradebook/group-filter'
import ScrollRegion from '@/components/common/ScrollRegion'

type Filters = { periodId: string; group: GroupFilter | null; pendingOnly: boolean }

export function endorsementGridPath({ periodId, group, pendingOnly }: Filters): string {
  const params = new URLSearchParams()
  if (pendingOnly) params.set('pending', 'true')
  if (periodId) params.set('periodId', periodId)
  for (const [key, value] of Object.entries(groupParams(group))) params.set(key, value)
  const qs = params.toString()
  return `/admin/gradebook/endorsements${qs ? `?${qs}` : ''}`
}

function GridRow({ row, group }: { row: EndorsementRow; group: GroupFilter | null }) {
  const state = reviewState(row)
  const observed = state.kind === 'OBSERVED' || state.kind === 'RECLOSED' ? observedLabels(row) : ''
  const endorsed = state.kind === 'ENDORSED'
  return (
    <tr>
      <td className="px-3 py-2">
        <span className="font-medium text-gray-900">{row.subject.name}</span>
        <span className="block text-xs text-gray-500">
          {row.courseName}
          {row.orientationName && ` — ${row.orientationName}`}
          {row.teacher?.name && ` · ${row.teacher.name}`}
        </span>
      </td>
      <td className="px-3 py-2 text-gray-700">
        {row.period.name}
        {row.closedLate && <span className="block text-xs text-amber-800">▲ Cerrado fuera de plazo</span>}
      </td>
      <td className="px-3 py-2">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${state.className}`}>
          <span aria-hidden>{state.symbol}</span>
          {state.label}
        </span>
        {observed && <span className="mt-0.5 block text-xs text-gray-600">Observado: {observed}</span>}
      </td>
      <td className="px-3 py-2 text-xs text-gray-600">
        {row.pendingAgeDays == null ? '—' : `${row.pendingAgeDays} día(s)`}
      </td>
      <td className="px-3 py-2 text-right">
        <Link
          href={visadoHref(row.gradeBookId, row.period.id, group)}
          aria-label={`${endorsed ? 'Ver' : 'Revisar'} ${row.subject.name} (${row.period.name})`}
          className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium ${
            endorsed
              ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
              : 'bg-emerald-600 text-white hover:bg-emerald-700'
          }`}
        >
          {endorsed ? 'Ver' : 'Revisar'}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </td>
    </tr>
  )
}

type Props = {
  rows: readonly EndorsementRow[]
  loading: boolean
  error: string | null
  /** El grupo elegido arriba: viaja a la revisión para que "Siguiente" recorra esta misma lista. */
  group: GroupFilter | null
  allMeetings: boolean
  onAllMeetingsChange: (value: boolean) => void
  pendingOnly: boolean
  onPendingOnlyChange: (value: boolean) => void
}

/**
 * El paso Visado de "Control y visado de libretas" (RF-080 a RF-083): la bandeja de lo que
 * cerraron los docentes, con su estado en palabras.
 *
 * Desde acá no se visa: "Revisar" abre la libreta en esa reunión, donde se ve lo que cerró el
 * docente y recién ahí se visa o se observa. Visar desde la fila —o en lote— era dar por buena una
 * libreta sin haberla mirado.
 */
export default function EndorsementGrid({
  rows,
  loading,
  error,
  group,
  allMeetings,
  onAllMeetingsChange,
  pendingOnly,
  onPendingOnlyChange,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={pendingOnly} onChange={(e) => onPendingOnlyChange(e.target.checked)} />
          {' '}Sólo pendientes de visar
        </label>
        {/* Lo que quedó sin visar de reuniones anteriores, con su antigüedad para priorizar. */}
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={allMeetings} onChange={(e) => onAllMeetingsChange(e.target.checked)} />
          {' '}Todas las reuniones
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {loading && (
        <p className="flex items-center gap-2 py-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando libretas cerradas…
        </p>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
          No hay libretas con períodos cerrados esperando visado. Un período abierto no aparece acá:
          todavía no hay nada firme que visar.
        </p>
      )}

      {!loading && rows.length > 0 && (
        <ScrollRegion
          label="Libretas para revisar"
          tour="control.review"
          className="overflow-x-auto rounded-xl border border-gray-200 bg-white"
        >
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Libreta</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Reunión</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Estado</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Pendiente</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  <span className="sr-only">Revisar</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <GridRow key={row.gradeBookPeriodId} row={row} group={group} />
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </div>
  )
}
