'use client'

import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Calendar, ChevronRight, ClipboardList, Clock, Loader2, LogIn, LogOut, User } from 'lucide-react'
import { api } from '@/lib/api/client'
import type { AssignedEventRow } from '@/components/personal/MyAssignedEventsPage'
import {
  getEventTypeLabel,
  getAssignedEventStatusLabel,
  getAssignedEventStatusColor,
} from '@/lib/events/assigned-event-display'
import { formatDateInUruguay, formatTimeInUruguay } from '@/lib/forms/datetime-uy'

type AttendanceFeedRow = {
  id: string
  type: 'CHECK_IN' | 'CHECK_OUT' | 'INCIDENT'
  status: string
  date: string
  time: string
  kind?: 'INCIDENT'
  title?: string
  description?: string | null
  incidentType?: string
  user?: { id: string; name?: string | null; email: string; role?: string }
  event?: { id: string; title: string; type: string } | null
}

type AttendanceFeedResponse = {
  total: number
  data: AttendanceFeedRow[]
}

function labelAttendanceStatus(status: string): string {
  const m: Record<string, string> = {
    PRESENT: 'Presente',
    LATE: 'Tarde',
    ABSENT_NOT_JUSTIFIED: 'Ausente',
    ABSENT_JUSTIFIED: 'Ausente justif.',
    EXIT: 'Salida',
    EARLY_EXIT: 'Salida anticipada',
  }
  return m[status] ?? status
}

function labelAttendanceFeedRow(row: AttendanceFeedRow): string {
  if (row.kind === 'INCIDENT' || row.type === 'INCIDENT') return 'Falta'
  return labelAttendanceStatus(row.status)
}

function badgeClassForStatus(status: string): string {
  if (status === 'LATE') return 'bg-amber-100 text-amber-900 ring-1 ring-amber-200/60'
  if (status === 'ABSENT_NOT_JUSTIFIED') return 'bg-red-100 text-red-800 ring-1 ring-red-200/60'
  if (status === 'ABSENT_JUSTIFIED') return 'bg-slate-100 text-slate-800 ring-1 ring-slate-200/60'
  if (status === 'PRESENT') return 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200/60'
  if (status === 'EXIT' || status === 'EARLY_EXIT') return 'bg-sky-100 text-sky-900 ring-1 ring-sky-200/60'
  return 'bg-gray-100 text-gray-800 ring-1 ring-gray-200/50'
}

function HomePanelShell({
  title,
  subtitle,
  icon,
  action,
  children,
}: {
  title: string
  subtitle: string
  icon: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-emerald-100/70 bg-white shadow-md shadow-emerald-950/[0.04] ring-1 ring-slate-950/[0.04]">
      <div className="relative border-b border-emerald-100/80 bg-gradient-to-br from-emerald-50/90 via-white to-white px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-600/30">
              {icon}
            </div>
            <div className="min-w-0 space-y-1">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">{title}</h2>
              <p className="max-w-xl text-sm leading-relaxed text-slate-600">{subtitle}</p>
            </div>
          </div>
          {action ? <div className="shrink-0 sm:pt-0.5">{action}</div> : null}
        </div>
      </div>
      <div className="bg-gradient-to-b from-slate-50/40 to-white">{children}</div>
    </section>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="mx-4 my-6 rounded-xl border border-dashed border-slate-200 bg-white/80 px-6 py-12 text-center">
      <p className="text-sm leading-relaxed text-slate-500">{message}</p>
    </div>
  )
}

export function HomeAdminAttendanceFeed() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<AttendanceFeedRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const end = new Date()
      const start = new Date()
      start.setDate(start.getDate() - 10)
      const params = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        page: '1',
        pageSize: '24',
        includeIncidents: 'true',
      })
      const res = await api<AttendanceFeedResponse>(`/attendance/all?${params.toString()}`)
      setRows(res.data ?? [])
    } catch {
      setError('No se pudo cargar el resumen de asistencias.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const action = (
    <a
      href="/admin/attendance"
      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-medium text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50/80"
    >
      Gestión completa
      <ChevronRight className="h-4 w-4 opacity-80" aria-hidden />
    </a>
  )

  return (
    <HomePanelShell
      title="Actividad de asistencias"
      subtitle="Últimos registros del personal (entradas y salidas vinculadas a eventos), ordenados por fecha."
      icon={<ClipboardList className="h-6 w-6" strokeWidth={2} aria-hidden />}
      action={action}
    >
      <div className="p-4 sm:p-5">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
            <Loader2 className="h-9 w-9 animate-spin text-emerald-600" aria-hidden />
            <span className="text-sm">Cargando marcaciones…</span>
          </div>
        )}
        {!loading && error && <EmptyState message={error} />}
        {!loading && !error && rows.length === 0 && (
          <EmptyState message="No hay marcaciones en los últimos días. Cuando el equipo registre asistencias, aparecerán aquí." />
        )}
        {!loading && !error && rows.length > 0 && (
          <ul className="space-y-2" role="list">
            {rows.map((r) => (
              <li
                key={r.id}
                className="group flex flex-col gap-3 rounded-xl border border-slate-100 bg-white/90 px-4 py-3.5 shadow-sm transition hover:border-emerald-200/80 hover:bg-emerald-50/25 sm:flex-row sm:items-center sm:gap-4"
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                    r.type === 'CHECK_IN'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : r.type === 'INCIDENT'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                  }`}
                  title={r.type === 'CHECK_IN' ? 'Entrada' : r.type === 'INCIDENT' ? 'Falta' : 'Salida'}
                >
                  {r.type === 'CHECK_IN' ? (
                    <LogIn className="h-[18px] w-[18px]" aria-hidden />
                  ) : r.type === 'INCIDENT' ? (
                    <AlertTriangle className="h-[18px] w-[18px]" aria-hidden />
                  ) : (
                    <LogOut className="h-[18px] w-[18px]" aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{r.user?.name || r.user?.email || 'Usuario'}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClassForStatus(r.status)}`}>
                      {labelAttendanceFeedRow(r)}
                    </span>
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      {r.type === 'CHECK_IN' ? 'Entrada' : r.type === 'INCIDENT' ? 'Incidencia' : 'Salida'}
                    </span>
                  </div>
                  <p className="truncate text-sm text-slate-600">
                    {r.type === 'INCIDENT' ? (
                      <span>
                        <span className="text-slate-400">Evento · </span>
                        {r.event?.title || r.title || 'Docente no presente en aula'}
                      </span>
                    ) : r.event?.title ? (
                      <span>
                        <span className="text-slate-400">Evento · </span>
                        {r.event.title}
                      </span>
                    ) : (
                      <span className="text-slate-400">Sin evento vinculado</span>
                    )}
                  </p>
                </div>
                <div className="shrink-0 border-t border-slate-100 pt-2 text-left sm:border-0 sm:pt-0 sm:text-right">
                  <div className="text-sm font-semibold tabular-nums text-slate-800">{formatDateInUruguay(r.date)}</div>
                  <div className="text-xs tabular-nums text-slate-500">{formatTimeInUruguay(r.time)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </HomePanelShell>
  )
}

export function HomeUpcomingSchedule({ role, userId }: { role: 'TEACHER' | 'STAFF'; userId?: string }) {
  const [events, setEvents] = useState<AssignedEventRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!userId) {
      setEvents([])
      setLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const now = new Date()
        const to = new Date(now)
        to.setDate(to.getDate() + 14)
        const params = new URLSearchParams({
          startDate: now.toISOString(),
          endDate: to.toISOString(),
        })
        const data = await api<AssignedEventRow[]>(`/events/my-events?${params.toString()}`)
        if (!cancelled) setEvents(data)
      } catch (e) {
        console.error(e)
        if (!cancelled) setEvents([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [userId])

  const visible = events
    .filter((e) => e.status === 'SCHEDULED' || e.status === 'IN_PROGRESS')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'IN_PROGRESS' ? -1 : 1
      return new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    })
    .slice(0, 12)

  const eventsHref = role === 'TEACHER' ? '/teacher/events' : '/staff/events'

  const action = (
    <a
      href={eventsHref}
      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-emerald-600/25 transition hover:bg-emerald-700"
    >
      Ver agenda completa
      <ChevronRight className="h-4 w-4 opacity-90" aria-hidden />
    </a>
  )

  return (
    <HomePanelShell
      title="Próximos turnos"
      subtitle="Lo que tenés programado en las próximas dos semanas (año lectivo activo). En curso aparece primero."
      icon={<Calendar className="h-6 w-6" strokeWidth={2} aria-hidden />}
      action={action}
    >
      <div className="p-4 sm:p-5">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
            <Loader2 className="h-9 w-9 animate-spin text-emerald-600" aria-hidden />
            <span className="text-sm">Cargando tu agenda…</span>
          </div>
        )}
        {!loading && visible.length === 0 && (
          <EmptyState message="No hay turnos próximos en esta ventana. Podés revisar la vista completa en «Mis eventos» desde el menú." />
        )}
        {!loading && visible.length > 0 && (
          <ul className="space-y-0" role="list">
            {visible.map((event, index) => (
              <li key={event.id} className="flex gap-4 pb-5 last:pb-0">
                <div className="flex w-11 shrink-0 flex-col items-center">
                  <div
                    className={`relative z-10 mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-white shadow-md ${
                      event.status === 'IN_PROGRESS' ? 'bg-amber-500 ring-2 ring-amber-200/80' : 'bg-emerald-500 ring-2 ring-emerald-200/80'
                    }`}
                    aria-hidden
                  />
                  {index < visible.length - 1 ? (
                    <div className="mt-1 h-12 w-px shrink-0 bg-gradient-to-b from-emerald-300/90 to-emerald-100/30" aria-hidden />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="rounded-xl border border-slate-100/90 bg-white/95 px-4 py-3.5 shadow-sm ring-1 ring-slate-950/[0.02] transition hover:border-emerald-200/90 hover:shadow-md">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1.5">
                        <h3 className="text-[15px] font-semibold leading-snug text-slate-900">{event.title}</h3>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${getAssignedEventStatusColor(event.status)}`}
                          >
                            {getAssignedEventStatusLabel(event.status)}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                            {getEventTypeLabel(event.type)}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 rounded-lg bg-slate-50 px-3 py-2 text-right ring-1 ring-slate-100">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Fecha</div>
                        <div className="text-sm font-semibold tabular-nums text-slate-800">{formatDateInUruguay(event.startDate)}</div>
                        {event.startTime ? (
                          <div className="mt-1 flex items-center justify-end gap-1 text-xs tabular-nums text-slate-600">
                            <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                            <span>
                              {formatTimeInUruguay(event.startTime)}
                              {event.endTime ? (
                                <>
                                  {' '}
                                  – {formatTimeInUruguay(event.endTime)}
                                </>
                              ) : null}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </HomePanelShell>
  )
}

export function HomeGenericHint() {
  return (
    <HomePanelShell
      title="Panel de inicio"
      subtitle="Desde el menú lateral accedés a cada módulo. Acá solo mostramos resúmenes cuando aplican a tu rol."
      icon={<User className="h-6 w-6" strokeWidth={2} aria-hidden />}
    >
      <div className="px-5 py-10 sm:px-6">
        <p className="mx-auto max-w-md text-center text-sm leading-relaxed text-slate-600">
          Si tenés alertas arriba (email, perfil o aprobación), resolvelas primero. Después podés usar el menú para navegar.
        </p>
      </div>
    </HomePanelShell>
  )
}
