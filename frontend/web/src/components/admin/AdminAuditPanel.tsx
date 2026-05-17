'use client'

import { api } from '@/lib/api/client'
import { auditMetadataDisplay } from '@/lib/admin/audit-detail-es'
import { ClipboardList, Filter, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

type AuditRow = {
  id: string
  occurredAt: string
  action: string
  actionLabel: string
  actorUserId: string | null
  actorName: string | null
  actorEmail: string | null
  actorIp: string | null
  userAgent: string | null
  source: string
  entityType: string | null
  entityId: string | null
  metadata: unknown
}

type ActionCat = { code: string; label: string }

type ListResponse = {
  total: number
  page: number
  pageSize: number
  actionCatalog: ActionCat[]
  data: AuditRow[]
}

function formatWhen(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'medium' })
  } catch {
    return iso
  }
}

function shortId(id: string | null | undefined): string {
  if (!id) return ''
  const t = id.trim()
  if (t.length <= 16) return t
  return `${t.slice(0, 8)}…${t.slice(-4)}`
}

const shellCard =
  'rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm'

export default function AdminAuditPanel({ compact = false }: { compact?: boolean } = {}) {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [catalog, setCatalog] = useState<ActionCat[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(25)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState('')
  const [actorUserId, setActorUserId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams()
      q.set('page', String(page))
      q.set('pageSize', String(pageSize))
      if (action) q.set('action', action)
      if (actorUserId.trim()) q.set('actorUserId', actorUserId.trim())
      if (from) q.set('from', new Date(`${from}T00:00:00.000Z`).toISOString())
      if (to) q.set('to', new Date(`${to}T23:59:59.999Z`).toISOString())
      const r = await api<ListResponse>(`/admin/audit-logs?${q.toString()}`)
      setRows(r.data)
      setCatalog(r.actionCatalog)
      setTotal(r.total)
    } catch {
      setError('No se pudo cargar el registro de auditoría.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, action, actorUserId, from, to])

  useEffect(() => {
    void load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const containerClass = compact ? 'space-y-5' : 'mx-auto max-w-6xl p-6 space-y-6'

  const labelCls = 'block text-xs font-medium uppercase tracking-wide text-gray-500'

  return (
    <div className={containerClass}>
      <section
        className={
          compact
            ? 'rounded-xl border border-emerald-100 bg-gradient-to-br from-white via-white to-emerald-50/40 p-5 shadow-sm'
            : 'rounded-xl border border-emerald-100 bg-gradient-to-br from-white via-white to-emerald-50/30 p-6 shadow-sm'
        }
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
          <span
            className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-emerald-100 ${
              compact ? 'h-11 w-11' : 'h-14 w-14'
            }`}
          >
            <ClipboardList
              className={compact ? 'h-5 w-5 text-emerald-700' : 'h-7 w-7 text-emerald-700'}
              aria-hidden
            />
          </span>
          <div className="min-w-0 flex-1">
            {compact ? (
              <h2 className="text-lg font-semibold tracking-tight text-gray-900">Auditoría de actividades</h2>
            ) : (
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Auditoría de actividades</h1>
            )}
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-gray-600">
              Registro de solo lectura de acciones relevantes: autenticación, cambios administrativos, licencias y
              parámetros del sistema.
            </p>
          </div>
        </div>
      </section>

      <section className={`${shellCard} space-y-5`}>
        <div className="flex flex-col gap-4 border-b border-gray-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Filter className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Filtros</h3>
              <p className="text-xs text-gray-500">Acotá por tipo de acción, actor o rango de fechas.</p>
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary inline-flex shrink-0 items-center justify-center gap-2 text-sm disabled:opacity-50"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
            {loading ? 'Actualizando…' : 'Aplicar y recargar'}
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block space-y-2">
            <span className={labelCls}>Tipo de acción</span>
            <select
              className="input-modern w-full text-sm"
              value={action}
              onChange={(e) => {
                setPage(1)
                setAction(e.target.value)
              }}
            >
              <option value="">Todas</option>
              {catalog.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-2">
            <span className={labelCls}>UUID del actor</span>
            <input
              className="input-modern w-full font-mono text-xs"
              placeholder="Opcional"
              value={actorUserId}
              onChange={(e) => {
                setPage(1)
                setActorUserId(e.target.value)
              }}
            />
          </label>
          <label className="block space-y-2">
            <span className={labelCls}>Desde</span>
            <input
              type="date"
              className="input-modern w-full text-sm"
              value={from}
              onChange={(e) => {
                setPage(1)
                setFrom(e.target.value)
              }}
            />
            <span className="text-[11px] text-gray-400">Fecha local, inicio del día</span>
          </label>
          <label className="block space-y-2">
            <span className={labelCls}>Hasta</span>
            <input
              type="date"
              className="input-modern w-full text-sm"
              value={to}
              onChange={(e) => {
                setPage(1)
                setTo(e.target.value)
              }}
            />
            <span className="text-[11px] text-gray-400">Fecha local, fin del día</span>
          </label>
        </div>
      </section>

      {error && (
        <div
          className="rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </div>
      )}

      <section className={`${shellCard} overflow-hidden p-0`}>
        <div className="border-b border-gray-100 bg-slate-50/90 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-gray-900">Eventos registrados</h3>
          <p className="text-xs text-gray-500">Ordenados del más reciente al más antiguo.</p>
        </div>

        <div className="overflow-x-auto px-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-500">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600/70" aria-hidden />
              <p className="text-sm">Cargando eventos…</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="mx-4 my-10 rounded-lg border border-dashed border-gray-200 bg-slate-50/50 px-6 py-12 text-center">
              <p className="text-sm font-medium text-gray-700">No hay eventos para mostrar</p>
              <p className="mt-1 text-xs text-gray-500">Probá ampliar fechas o quitar filtros.</p>
            </div>
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-white">
                  <th className="whitespace-nowrap px-4 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Cuándo
                  </th>
                  <th className="px-4 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-500">Acción</th>
                  <th className="px-4 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-500">Actor</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    IP
                  </th>
                  <th className="px-4 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-500">Entidad</th>
                  <th className="min-w-[220px] px-4 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Detalle
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => {
                  const detail = auditMetadataDisplay(r.action, r.metadata)
                  return (
                  <tr
                    key={r.id}
                    className={`align-top transition-colors ${
                      i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'
                    } hover:bg-emerald-50/25`}
                  >
                    <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-gray-800">{formatWhen(r.occurredAt)}</td>
                    <td className="px-4 py-3.5">
                      <div className="font-medium leading-snug text-gray-900">{r.actionLabel}</div>
                      <div className="mt-0.5 font-mono text-[11px] font-medium uppercase tracking-wide text-gray-400">
                        {r.action}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-gray-800">
                      {r.actorName ? (
                        <div className="min-w-0 truncate font-medium" title={r.actorEmail || undefined}>
                          {r.actorName}
                        </div>
                      ) : r.actorEmail ? (
                        <span className="text-gray-600" title={r.actorEmail}>
                          {r.actorEmail}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs text-gray-600">{r.actorIp || '—'}</td>
                    <td className="px-4 py-3.5 text-gray-700">
                      {r.entityType || r.entityId ? (
                        <div className="min-w-0 max-w-[200px]">
                          <div className="truncate text-sm">{r.entityType || '—'}</div>
                          {r.entityId ? (
                            <div
                              className="mt-0.5 truncate font-mono text-[11px] text-gray-400"
                              title={r.entityId}
                            >
                              {shortId(r.entityId)}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {detail.lines.length === 0 && !detail.technicalJson ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <div className="max-w-md space-y-2">
                          {detail.lines.length > 0 ? (
                            <ul className="list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-gray-800 marker:text-emerald-600">
                              {detail.lines.map((line, idx) => (
                                <li key={idx}>{line}</li>
                              ))}
                            </ul>
                          ) : null}
                          {detail.technicalJson ? (
                            <details className="group text-xs">
                              <summary className="cursor-pointer list-none text-emerald-700 hover:text-emerald-800 [&::-webkit-details-marker]:hidden">
                                <span className="border-b border-dotted border-emerald-300 group-open:border-transparent">
                                  Datos técnicos (JSON)
                                </span>
                              </summary>
                              <pre className="mt-2 max-h-36 overflow-auto rounded-md border border-gray-100 bg-slate-50 px-2 py-1.5 font-mono text-[10px] leading-snug text-gray-600 break-all whitespace-pre-wrap">
                                {detail.technicalJson}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {total > 0 && !loading && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-slate-50/50 px-5 py-4 text-sm text-gray-600">
            <span className="tabular-nums">
              <span className="font-medium text-gray-800">{total}</span> evento{total === 1 ? '' : 's'} · página{' '}
              <span className="font-medium text-gray-800">
                {page} / {totalPages}
              </span>
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-45"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </button>
              <button
                type="button"
                className="btn-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-45"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
