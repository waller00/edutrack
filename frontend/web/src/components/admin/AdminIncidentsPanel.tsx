'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api/client'
import { formatValidationErrorFromApi } from '@/lib/api/validation-message'
import {
  INCIDENT_STATUS_LABELS,
  INCIDENT_TYPE_LABELS,
  type AttendanceIncidentRow,
  type IncidentListResponse,
} from '@/lib/attendance/incidents-types'
import { formatDateInUruguay, formatTimeInUruguay } from '@/lib/forms/datetime-uy'

type Props = {
  onMessage?: (msg: string) => void
}

export default function AdminIncidentsPanel({ onMessage }: Props) {
  const [statusFilter, setStatusFilter] = useState<'OPEN' | ''>('OPEN')
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [rows, setRows] = useState<AttendanceIncidentRow[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({ pageSize: '50' })
      if (statusFilter) q.set('status', statusFilter)
      const res = await api<IncidentListResponse>(`/attendance-incidents?${q}`)
      setRows(res.data)
      setTotal(res.total)
    } catch (err) {
      setError(formatValidationErrorFromApi(err))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  async function scanNow() {
    setScanning(true)
    try {
      const res = await api<{ opened?: number; resolved?: number }>('/attendance-incidents/scan-now', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      onMessage?.(
        `Escaneo completado: ${res.opened ?? 0} incidencias nuevas, ${res.resolved ?? 0} resueltas automáticamente.`,
      )
      await load()
    } catch (err) {
      onMessage?.(formatValidationErrorFromApi(err))
    } finally {
      setScanning(false)
    }
  }

  async function resolve(id: string) {
    try {
      await api(`/attendance-incidents/${id}/resolve`, { method: 'PATCH', body: JSON.stringify({}) })
      onMessage?.('Incidencia resuelta')
      await load()
    } catch (err) {
      onMessage?.(formatValidationErrorFromApi(err))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />
            <span>
              {total} incidencia{total === 1 ? '' : 's'}
              {statusFilter === 'OPEN' ? ' abiertas' : ''}
            </span>
          </div>
          <span className="text-xs text-slate-500">
            Ausencias docentes sin justificar. Tardanzas y salidas anticipadas se ven en la grilla de
            asistencia (estado de la marcación), no aquí.
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'OPEN' | '')}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            aria-label="Filtrar por estado"
          >
            <option value="OPEN">Solo abiertas</option>
            <option value="">Todas</option>
          </select>
          <button type="button" onClick={() => void load()} className="btn-secondary text-sm">
            Actualizar
          </button>
          <button
            type="button"
            onClick={() => void scanNow()}
            disabled={scanning}
            className="btn-secondary inline-flex items-center gap-1.5 text-sm"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Escanear ahora
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12 text-slate-500">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 py-12 text-center text-sm text-slate-500">
          No hay incidencias con estos filtros.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Detectada</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Docente</th>
                <th className="px-4 py-3">Evento</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatDateInUruguay(row.detectedAt)}{' '}
                    <span className="text-slate-500">{formatTimeInUruguay(row.detectedAt)}</span>
                  </td>
                  <td className="px-4 py-3">{INCIDENT_TYPE_LABELS[row.type]}</td>
                  <td className="px-4 py-3">{row.user?.name || row.user?.email || '—'}</td>
                  <td className="px-4 py-3">
                    {row.event ? (
                      <Link href="/admin/events" className="text-emerald-700 hover:underline">
                        {row.event.title}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.status === 'OPEN' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {INCIDENT_STATUS_LABELS[row.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {row.status === 'OPEN' ? (
                      <button
                        type="button"
                        onClick={() => void resolve(row.id)}
                        className="text-sm font-medium text-emerald-700 hover:underline"
                      >
                        Resolver
                      </button>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
