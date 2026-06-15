'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { api } from '@/lib/api/client'
import { formatValidationErrorFromApi } from '@/lib/api/validation-message'
import AttendanceHeatmap from '@/components/admin/AttendanceHeatmap'
import type { AttendanceSummaryPerson, AttendanceSummaryResponse } from '@/lib/attendance/summary'

type Props = Readonly<{
  userId: string
  userName: string
  from: string
  to: string
  /** Query string del ciclo lectivo activo (puede venir vacío). */
  schoolYearQuery?: string
  onClose: () => void
  onJustified?: () => void
}>

function Kpi({ label, value, tone }: Readonly<{ label: string; value: string | number; tone?: string }>) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-bold ${tone ?? 'text-slate-900'}`}>{value}</div>
    </div>
  )
}

function JustifyRangeForm({
  range,
  reason,
  includeLate,
  saving,
  onReason,
  onIncludeLate,
  onSubmit,
  onCancel,
}: Readonly<{
  range: { from: string; to: string }
  reason: string
  includeLate: boolean
  saving: boolean
  onReason: (value: string) => void
  onIncludeLate: (value: boolean) => void
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
}>) {
  return (
    <form onSubmit={onSubmit} className="mb-3 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
      <p className="text-xs text-emerald-900">
        Se justificarán todas las faltas sin justificar de {range.from} a {range.to}.
      </p>
      <input
        value={reason}
        onChange={(e) => onReason(e.target.value)}
        required
        placeholder="Motivo (ej. licencia médica)"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <label className="flex items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={includeLate} onChange={(e) => onIncludeLate(e.target.checked)} />
        <span>Incluir tardanzas</span>
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary text-sm">
          Cancelar
        </button>
        <button type="submit" disabled={saving || !reason.trim()} className="btn-primary text-sm">
          {saving ? 'Justificando…' : 'Confirmar'}
        </button>
      </div>
    </form>
  )
}

export default function PersonAttendanceDrawer({
  userId,
  userName,
  from,
  to,
  schoolYearQuery,
  onClose,
  onJustified,
}: Props) {
  const [portalReady, setPortalReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [person, setPerson] = useState<AttendanceSummaryPerson | null>(null)
  const [range, setRange] = useState<{ from: string; to: string }>({ from, to })
  const [error, setError] = useState<string | null>(null)

  const [showJustify, setShowJustify] = useState(false)
  const [reason, setReason] = useState('')
  const [includeLate, setIncludeLate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => setPortalReady(true), [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ userId })
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const base = `/attendance/summary?${params.toString()}`
      const url = schoolYearQuery ? `${base}&${schoolYearQuery}` : base
      const data = await api<AttendanceSummaryResponse>(url)
      setPerson(data.person ?? null)
      setRange({ from: data.from, to: data.to })
    } catch (err) {
      setError(formatValidationErrorFromApi(err))
      setPerson(null)
    } finally {
      setLoading(false)
    }
  }, [userId, from, to, schoolYearQuery])

  useEffect(() => {
    void load()
  }, [load])

  async function handleJustifyRange(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const res = await api<{ justified: number; created: number; total: number }>('/attendance/justify-range', {
        method: 'POST',
        body: JSON.stringify({
          userId,
          from: range.from,
          to: range.to,
          type: 'ABSENCE',
          reason: reason.trim(),
          includeLate,
        }),
      })
      setMessage(`✅ ${res.justified} marca(s) justificada(s)`)
      setShowJustify(false)
      setReason('')
      setIncludeLate(false)
      await load()
      onJustified?.()
    } catch (err) {
      setMessage(`❌ ${formatValidationErrorFromApi(err)}`)
    } finally {
      setSaving(false)
    }
  }

  if (!portalReady) return null

  const stats = person?.stats

  function renderContent() {
    if (loading) return <p className="text-sm text-slate-500">Cargando…</p>
    if (error) return <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
    if (!person || !stats) return <p className="text-sm text-slate-500">Sin actividad registrada en el período.</p>

    return (
      <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Kpi label="% Asistencia" value={`${stats.pctAsistencia}%`} tone="text-emerald-600" />
          <Kpi label="% Puntualidad" value={`${stats.pctPuntualidad}%`} tone="text-emerald-600" />
          <Kpi label="Horas trabajadas" value={stats.horasTrabajadas} />
          <Kpi label="Esperadas" value={stats.esperadas} />
          <Kpi label="Presente" value={stats.presente} tone="text-emerald-600" />
          <Kpi label="Tarde" value={stats.tarde} tone="text-amber-600" />
          <Kpi label="Falta sin just." value={stats.ausenteNoJustificado} tone="text-red-600" />
          <Kpi label="Falta justificada" value={stats.ausenteJustificado} tone="text-blue-600" />
          <Kpi label="Suplido" value={stats.suplido} tone="text-rose-600" />
        </div>

        <div className="rounded-lg border border-slate-200 p-3">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Mapa de asistencia</h3>
          <AttendanceHeatmap rows={person.rows} from={range.from} to={range.to} />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Detalle ({person.rows.length})</h3>
            <button
              type="button"
              onClick={() => setShowJustify((v) => !v)}
              disabled={stats.ausenteNoJustificado === 0 && !includeLate}
              className="btn-secondary text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Justificar rango
            </button>
          </div>

          {showJustify ? (
            <JustifyRangeForm
              range={range}
              reason={reason}
              includeLate={includeLate}
              saving={saving}
              onReason={setReason}
              onIncludeLate={setIncludeLate}
              onSubmit={handleJustifyRange}
              onCancel={() => setShowJustify(false)}
            />
          ) : null}

          {message ? <p className="mb-2 text-sm text-slate-700">{message}</p> : null}

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Evento</th>
                  <th className="px-3 py-2 text-left">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {person.rows.map((row, i) => (
                  <tr key={`${row.fecha}-${row.evento}-${i}`}>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{row.fecha}</td>
                    <td className="px-3 py-2 text-slate-700">{row.evento}</td>
                    <td className="px-3 py-2 text-slate-700">{row.estado}</td>
                  </tr>
                ))}
                {person.rows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-slate-400">
                      Sin registros
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[2147483646] flex justify-end bg-black/50">
      <button type="button" aria-label="Cerrar" className="flex-1 cursor-default" onClick={onClose} />
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{person?.nombre || userName}</h2>
            <p className="text-sm text-slate-500">
              {person?.rol ? `${person.rol} · ` : ''}
              Resumen {range.from} → {range.to}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Cerrar panel"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 space-y-5 px-5 py-4">{renderContent()}</div>
      </div>
    </div>,
    document.body,
  )
}
