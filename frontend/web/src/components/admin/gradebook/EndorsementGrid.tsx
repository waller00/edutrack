'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Loader2, MessageSquareWarning } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'

type Section = 'GRADES' | 'CLOSURE' | 'JUDGEMENTS' | 'ALL'
type Status = 'PENDING' | 'OBSERVED' | 'CORRECTED' | 'ENDORSED'

type SectionState = { section: Section; status: Status; occurredAt: string | null; observations: string | null }

type Row = {
  gradeBookPeriodId: string
  period: { name: string }
  subject: { name: string }
  teacher: { name: string | null } | null
  courseName: string
  orientationName: string | null
  closedAt: string | null
  closedLate: boolean
  sections: SectionState[]
  overallStatus: Status
  lastChangeAt: string
  pendingAgeDays: number | null
  blockingSections: Section[]
  canFinalize: boolean
}

const SECTION_LABELS: Record<Section, string> = {
  GRADES: 'Calificaciones',
  CLOSURE: 'Cierre',
  JUDGEMENTS: 'Juicios',
  ALL: 'Período',
}

const STATUS_LABELS: Record<Status, string> = {
  PENDING: 'Pendiente',
  OBSERVED: 'Observado',
  CORRECTED: 'Corregido',
  ENDORSED: 'Visado',
}

/** Texto y símbolo además del color: el estado no se lee sólo por el fondo (RNF 7.2). */
const STATUS_STYLES: Record<Status, { className: string; symbol: string }> = {
  PENDING: { className: 'border-gray-200 bg-gray-50 text-gray-700', symbol: '·' },
  OBSERVED: { className: 'border-amber-200 bg-amber-50 text-amber-900', symbol: '▲' },
  CORRECTED: { className: 'border-blue-200 bg-blue-50 text-blue-900', symbol: '↻' },
  ENDORSED: { className: 'border-emerald-200 bg-emerald-50 text-emerald-800', symbol: '✓' },
}

function StatusBadge({ status, title }: { status: Status; title?: string }) {
  const style = STATUS_STYLES[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${style.className}`} title={title}>
      <span aria-hidden>{style.symbol}</span>
      {STATUS_LABELS[status]}
    </span>
  )
}

export default function EndorsementGrid() {
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const [rows, setRows] = useState<Row[]>([])
  const [pendingOnly, setPendingOnly] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const path = `/admin/gradebook/endorsements${pendingOnly ? '?pending=true' : ''}`
      const res = await api<{ data: Row[] }>(withSchoolYear(path, query))
      setRows(res.data)
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo cargar la grilla' })
    } finally {
      setLoading(false)
    }
  }, [query, pendingOnly])

  useEffect(() => {
    void load()
  }, [load])

  async function act(row: Row, section: Section, status: Status) {
    const observations =
      status === 'OBSERVED' ? globalThis.prompt('¿Qué hay que corregir?')?.trim() : undefined
    if (status === 'OBSERVED' && !observations) return

    setBusy(row.gradeBookPeriodId)
    setMessage(null)
    try {
      await api('/admin/gradebook/endorsements', {
        method: 'POST',
        body: JSON.stringify({
          gradeBookPeriodId: row.gradeBookPeriodId,
          section,
          status,
          ...(observations ? { observations } : {}),
        }),
      })
      setMessage({ kind: 'ok', text: status === 'ENDORSED' ? 'Período visado.' : 'Observación registrada.' })
      await load()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo registrar' })
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando libretas cerradas…
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />
          Sólo pendientes de visar
        </label>
      </div>

      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-sm ${message.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}
        >
          {message.text}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
          No hay libretas con períodos cerrados esperando visado. Un período abierto no aparece acá:
          todavía no hay nada firme que visar.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
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
                <tr key={row.gradeBookPeriodId}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900">{row.subject.name}</div>
                    <div className="text-xs text-gray-500">
                      {row.courseName}
                      {row.orientationName && ` — ${row.orientationName}`}
                      {row.teacher?.name && ` · ${row.teacher.name}`}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {row.period.name}
                    {row.closedLate && (
                      <span className="ml-1 text-xs text-amber-700">· cerrado fuera de plazo</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {row.sections
                        .filter((s) => s.section !== 'ALL')
                        .map((s) => (
                          <StatusBadge
                            key={s.section}
                            status={s.status}
                            title={`${SECTION_LABELS[s.section]}${s.observations ? `: ${s.observations}` : ''}`}
                          />
                        ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={row.overallStatus} />
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {row.pendingAgeDays == null ? '—' : `${row.pendingAgeDays} día(s)`}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={busy === row.gradeBookPeriodId}
                        onClick={() => void act(row, 'GRADES', 'OBSERVED')}
                        className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <MessageSquareWarning className="h-3.5 w-3.5" aria-hidden />
                        Observar
                      </button>
                      <button
                        type="button"
                        disabled={busy === row.gradeBookPeriodId || !row.canFinalize || row.overallStatus === 'ENDORSED'}
                        title={
                          row.canFinalize
                            ? undefined
                            : `Hay secciones observadas sin corregir: ${row.blockingSections.map((s) => SECTION_LABELS[s]).join(', ')}`
                        }
                        onClick={() => void act(row, 'ALL', 'ENDORSED')}
                        className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                        Visar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-500">
        El historial de visado es <strong>append-only</strong>: una observación posterior no borra el
        visado anterior, lo sucede. Una sección ya visada por Dirección sólo puede modificarla Dirección.
      </p>
    </div>
  )
}
