'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, ClipboardList, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { formatTimeInUruguay } from '@/lib/forms/datetime-uy'
import { getSessionStatusChipClass, getSessionStatusLabel, type SessionStatus } from '@/lib/rollcall/rollcall-status'
import type { BlockedReason } from '@/lib/rollcall/rollcall-window'

type ClassRow = {
  eventId: string
  ymd: string
  title: string
  subject: string | null
  course: string | null
  orientation: string | null
  startAt: string
  endAt: string
  isSubstitution: boolean
  nonWorkingDay: string | null
  rollCall: {
    sessionId: string | null
    status: SessionStatus
    takenAt: string | null
    rosterSize: number | null
    canEdit: boolean
    blockedReason: BlockedReason
    editableUntil: string | null
  }
}

function todayYmd(): string {
  // El input date trabaja en hora local, que en el aula es la institucional.
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

export default function RollCallTodayList() {
  const [date, setDate] = useState(todayYmd)
  const [rows, setRows] = useState<ClassRow[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      setRows(await api<ClassRow[]>(`/student-attendance/my-classes?date=${date}`))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudieron cargar tus clases')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
          <ClipboardList className="h-7 w-7 text-emerald-600" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Pase de lista</h1>
          <p className="text-sm text-gray-600">Marcá la asistencia de tus estudiantes clase por clase.</p>
        </div>
      </header>

      <label className="block max-w-xs">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Día</span>
        <div className="relative">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
          <input
            type="date"
            className="input-field w-full pl-9 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </label>

      {msg ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{msg}</p> : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando clases…
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          No tenés clases ese día.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={`${row.eventId}-${row.ymd}`}>
              <Link
                href={`/me/roll-call/${row.eventId}/${row.ymd}`}
                className="block rounded-lg border border-gray-200 bg-white p-4 transition hover:border-emerald-300 hover:bg-emerald-50/30"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{row.subject ?? row.title}</p>
                    <p className="truncate text-xs text-gray-500">
                      {[row.course, row.orientation].filter(Boolean).join(' · ') || 'Sin curso'} ·{' '}
                      {formatTimeInUruguay(row.startAt)}–{formatTimeInUruguay(row.endAt)}
                      {row.isSubstitution ? ' · Suplencia' : ''}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${getSessionStatusChipClass(
                      row.rollCall.status,
                      row.rollCall.canEdit,
                    )}`}
                  >
                    {getSessionStatusLabel(row.rollCall.status, row.rollCall.canEdit)}
                  </span>
                </div>
                {row.nonWorkingDay ? (
                  <p className="mt-2 text-xs text-amber-800">Día no laborable: {row.nonWorkingDay}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
