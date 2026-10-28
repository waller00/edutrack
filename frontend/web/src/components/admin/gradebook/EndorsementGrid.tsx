'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import EndorsementBadge from '@/components/gradebook/EndorsementBadge'
import {
  ENDORSEMENT_SECTION_LABELS,
  readyToEndorse,
  REVIEW_SECTIONS,
  sectionState,
  type EndorsementAbilities,
  type EndorsementRow,
} from '@/lib/gradebook/endorsements'
import { groupParams, type GroupFilter } from '@/lib/gradebook/group-filter'
import EndorsementRowDetail from './EndorsementRowDetail'
import ScrollRegion from '@/components/common/ScrollRegion'

type Message = { kind: 'ok' | 'error'; text: string } | null

type BulkResult = { endorsed: number; skipped: Array<{ gradeBookPeriodId: string; code: string }> }

type Filters = { periodId: string; group: GroupFilter | null; pendingOnly: boolean }

export function endorsementGridPath({ periodId, group, pendingOnly }: Filters): string {
  const params = new URLSearchParams()
  if (pendingOnly) params.set('pending', 'true')
  if (periodId) params.set('periodId', periodId)
  for (const [key, value] of Object.entries(groupParams(group))) params.set(key, value)
  const qs = params.toString()
  return `/admin/gradebook/endorsements${qs ? `?${qs}` : ''}`
}

export function bulkMessage(result: BulkResult): string {
  const done = result.endorsed === 1 ? 'Se visó 1 libreta.' : `Se visaron ${result.endorsed} libretas.`
  const left = result.skipped.length
  if (left === 0) return done
  const rest = left === 1 ? 'Una no se visó porque ya no estaba lista' : `${left} no se visaron porque ya no estaban listas`
  return `${done} ${rest} (observada, visada o reabierta mientras tanto).`
}

function GridRow({
  row,
  expanded,
  abilities,
  busy,
  onToggle,
  onEndorse,
}: {
  row: EndorsementRow
  expanded: boolean
  abilities: EndorsementAbilities
  busy: boolean
  onToggle: () => void
  onEndorse: () => void
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <tr>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 text-left font-medium text-gray-900 hover:text-emerald-700"
        >
          <Chevron className="h-4 w-4 shrink-0" aria-hidden />
          {row.subject.name}
        </button>
        <div className="pl-5 text-xs text-gray-500">
          {row.courseName}
          {row.orientationName && ` — ${row.orientationName}`}
          {row.teacher?.name && ` · ${row.teacher.name}`}
          {' · '}
          <Link href={`/libreta/${row.gradeBookId}/cierre`} className="text-emerald-700 hover:underline">
            Abrir libreta
          </Link>
        </div>
      </td>
      <td className="px-3 py-2 text-gray-700">
        {row.period.name}
        {row.closedLate && <span className="ml-1 text-xs text-amber-700">· cerrado fuera de plazo</span>}
        {row.reclosedAfterObservation && (
          <span className="mt-0.5 block text-xs text-blue-800">↻ Volvió a cerrarse tras la observación</span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {REVIEW_SECTIONS.map((section) => {
            const state = sectionState(row, section)
            return (
              <EndorsementBadge
                key={section}
                status={state.status}
                title={`${ENDORSEMENT_SECTION_LABELS[section]}${state.observations ? `: ${state.observations}` : ''}`}
              />
            )
          })}
        </div>
      </td>
      <td className="px-3 py-2">
        <EndorsementBadge status={row.overallStatus} />
      </td>
      <td className="px-3 py-2 text-xs text-gray-600">
        {row.pendingAgeDays == null ? '—' : `${row.pendingAgeDays} día(s)`}
      </td>
      <td className="px-3 py-2">
        {abilities.canEndorse && row.overallStatus !== 'ENDORSED' && (
          <button
            type="button"
            disabled={busy || !row.canFinalize}
            title={
              row.canFinalize
                ? undefined
                : `Hay secciones observadas sin corregir: ${row.blockingSections.map((s) => ENDORSEMENT_SECTION_LABELS[s]).join(', ')}`
            }
            onClick={onEndorse}
            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            Visar
          </button>
        )}
      </td>
    </tr>
  )
}

type Props = {
  rows: readonly EndorsementRow[]
  loading: boolean
  error: string | null
  abilities: EndorsementAbilities
  /** La reunión elegida arriba; con "Todas las reuniones" la grilla muestra todas, sin lote. */
  periodId: string
  periodName: string
  allMeetings: boolean
  onAllMeetingsChange: (value: boolean) => void
  pendingOnly: boolean
  onPendingOnlyChange: (value: boolean) => void
  /** Después de observar, corregir, reabrir o visar: la pantalla vuelve a pedir lo que cambió. */
  onChanged: () => Promise<void>
}

/**
 * El paso Visado de "Control y visado de libretas" (RF-080 a RF-083).
 *
 * Cada fila es una libreta en una reunión cerrada. Abriéndola se observa por sección, se da por
 * corregido, se reabre el período y se ve el historial; Dirección visa de a una o, con una reunión
 * elegida, todo lo que ya está listo. Cada botón aparece sólo para quien tiene la atribución: el
 * backend lo exige igual, pero mostrarle "Visar" a adscripción era invitarla a un 403.
 */
export default function EndorsementGrid({
  rows,
  loading,
  error,
  abilities,
  periodId,
  periodName,
  allMeetings,
  onAllMeetingsChange,
  pendingOnly,
  onPendingOnlyChange,
  onChanged,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  const ready = readyToEndorse(rows)
  const shownMessage: Message = error ? { kind: 'error', text: error } : message

  async function afterChange(text: string) {
    setMessage({ kind: 'ok', text })
    await onChanged()
  }

  async function endorse(row: EndorsementRow) {
    setBusy(true)
    setMessage(null)
    try {
      await api('/admin/gradebook/endorsements', {
        method: 'POST',
        body: JSON.stringify({ gradeBookPeriodId: row.gradeBookPeriodId, section: 'ALL', status: 'ENDORSED' }),
      })
      await afterChange(`Se visó ${row.subject.name} (${row.period.name}).`)
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo visar' })
    } finally {
      setBusy(false)
    }
  }

  async function endorseAll() {
    const count = ready.length
    if (!globalThis.confirm(`¿Visar ${count} libreta(s) de ${periodName}? Sólo las cerradas y sin observaciones.`)) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await api<BulkResult>('/admin/gradebook/endorsements/bulk', {
        method: 'POST',
        body: JSON.stringify({ gradeBookPeriodIds: ready.map((row) => row.gradeBookPeriodId) }),
      })
      await afterChange(bulkMessage(result))
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo visar en lote' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={pendingOnly} onChange={(e) => onPendingOnlyChange(e.target.checked)} />
          Sólo pendientes de visar
        </label>
        {/* Lo que quedó sin visar de reuniones anteriores, con su antigüedad para priorizar. */}
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={allMeetings} onChange={(e) => onAllMeetingsChange(e.target.checked)} />
          Todas las reuniones
        </label>
        {abilities.canEndorse && !allMeetings && periodId && ready.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void endorseAll()}
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Visar las {ready.length} listas
          </button>
        )}
      </div>

      {shownMessage && (
        <p
          role={shownMessage.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-sm ${shownMessage.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}
        >
          {shownMessage.text}
        </p>
      )}

      {loading && (
        <p className="flex items-center gap-2 py-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando libretas cerradas…
        </p>
      )}

      {!loading && rows.length === 0 && (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
          No hay libretas con períodos cerrados esperando visado. Un período abierto no aparece acá:
          todavía no hay nada firme que visar.
        </p>
      )}

      {!loading && rows.length > 0 && (
        <ScrollRegion label="Visado de libretas" className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Libreta</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Período</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Secciones</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Visado</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Pendiente</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <Fragment key={row.gradeBookPeriodId}>
                  <GridRow
                    row={row}
                    expanded={expanded === row.gradeBookPeriodId}
                    abilities={abilities}
                    busy={busy}
                    onToggle={() => setExpanded((id) => (id === row.gradeBookPeriodId ? null : row.gradeBookPeriodId))}
                    onEndorse={() => void endorse(row)}
                  />
                  {expanded === row.gradeBookPeriodId && (
                    <tr>
                      <td colSpan={6} className="p-0">
                        <EndorsementRowDetail row={row} abilities={abilities} onChanged={afterChange} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}

      <p className="text-xs text-gray-500">
        El historial de visado es <strong>append-only</strong>: una observación posterior no borra el
        visado anterior, lo sucede. Una sección ya visada por Dirección sólo puede modificarla Dirección.
      </p>
    </div>
  )
}
