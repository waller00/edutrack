'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { formatDateInUruguay, formatTimeInUruguay } from '@/lib/forms/datetime-uy'
import PaginationControls from '@/components/common/PaginationControls'
import DateRangeFields from '@/components/forms/DateRangeFields'

type PendingRow = {
  eventId: string
  ymd: string
  startAt: string
  endAt: string
  title: string
  subject: string | null
  course: string | null
  orientation: string | null
  teacher: { id: string; name: string | null; username: string | null } | null
  daysLate: number
  sessionId: string | null
}

type PendingResponse = {
  total: number
  page: number
  pageSize: number
  rangeClamped: boolean
  from: string
  to: string
  data: PendingRow[]
}

function daysAgoYmd(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const offset = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - offset).toISOString().slice(0, 10)
}

export default function PendingRollCallsPanel() {
  const syCtx = useOptionalAdminSchoolYear()
  const schoolYearQuery = syCtx?.schoolYearQuery ?? ''
  const [from, setFrom] = useState(() => daysAgoYmd(14))
  const [to, setTo] = useState(() => daysAgoYmd(0))
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<PendingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      const path = `/admin/student-attendance/pending?from=${from}&to=${to}&page=${page}&pageSize=20`
      setResult(await api<PendingResponse>(withSchoolYear(path, schoolYearQuery)))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudieron cargar las listas sin pasar')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [from, to, page, schoolYearQuery])

  useEffect(() => {
    void load()
  }, [load])

  const rows = result?.data ?? []

  return (
    <section className="card space-y-4">
      <div className="card-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Listas sin pasar</h2>
          <p className="text-sm text-gray-600">
            Clases que ya terminaron y todavía no tienen pase de lista. No se generan faltas automáticas.
          </p>
        </div>
        {result ? (
          <div className="text-right">
            <div className="text-2xl font-bold text-emerald-600">{result.total}</div>
            <div className="text-xs text-gray-600">pendientes</div>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:max-w-lg">
        <DateRangeFields
          startDate={from}
        endDate={to}
          onStartDateChange={(value) => {
            setFrom(value)
            setPage(1)
          }}
          onEndDateChange={(value) => {
            setTo(value)
            setPage(1)
          }}
        />
      </div>

      {result?.rangeClamped ? (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          El rango se acotó a {result.from} – {result.to} para no expandir horarios de todo el año.
        </p>
      ) : null}

      {msg ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{msg}</p> : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando…
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">
          No hay listas pendientes en el período. 🎉
        </p>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                <th className="px-3 py-2 text-left font-semibold">Clase</th>
                <th className="px-3 py-2 text-left font-semibold">Grupo</th>
                <th className="px-3 py-2 text-left font-semibold">Docente</th>
                <th className="px-3 py-2 text-right font-semibold">Atraso</th>
                <th className="px-3 py-2 text-right font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={`${row.eventId}-${row.ymd}`} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-2 text-gray-900">
                    {formatDateInUruguay(row.startAt)}
                    <span className="block text-xs text-gray-500">
                      {formatTimeInUruguay(row.startAt)}–{formatTimeInUruguay(row.endAt)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-900">{row.subject ?? row.title}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {[row.course, row.orientation].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{row.teacher?.name ?? row.teacher?.username ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.daysLate >= 7 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {row.daysLate === 0 ? 'Hoy' : `${row.daysLate} d`}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/me/roll-call/${row.eventId}/${row.ymd}`}
                      className="text-sm font-medium text-emerald-700 hover:underline"
                    >
                      Pasar lista
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result ? (
        <PaginationControls page={result.page} total={result.total} pageSize={result.pageSize} onPageChange={setPage} />
      ) : null}
    </section>
  )
}
