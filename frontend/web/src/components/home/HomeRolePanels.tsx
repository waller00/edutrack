'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Calendar, ChevronRight, ClipboardList, Clock, Filter, Loader2, LogIn, LogOut, MapPin, User } from 'lucide-react'
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
  notes?: string | null
  incidentType?: string
  user?: { id: string; name?: string | null; email: string; role?: string }
  event?: { id: string; title: string; type: string } | null
}

type AttendanceFeedResponse = {
  total: number
  data: AttendanceFeedRow[]
}

type AdminEventsResponse = {
  total: number
  data: AssignedEventRow[]
}

type TimelineItem = {
  id: string
  at: string
  tone: 'entry' | 'exit' | 'incident' | 'event'
  title: string
  person: string
  eventType?: string
  location?: string
  status: string
  statusClass: string
  summary: string
  coveredEventKeys?: string[]
}

type AttendanceTimelineStatus =
  | 'REGISTERED'
  | 'PRESENT'
  | 'LATE'
  | 'PENDING'
  | 'FREE'
  | 'SUSPENDED'
  | 'SUBSTITUTED'
  | 'OUT_OF_SCHEDULE'
  | 'UNIDENTIFIED'
  | 'JUSTIFIED'
  | 'EARLY_EXIT'

type AttendanceTimelineType =
  | 'BIOMETRIC_ENTRY'
  | 'BIOMETRIC_EXIT'
  | 'CLASS_ATTENDANCE'
  | 'LATE_ARRIVAL'
  | 'PENDING_ABSENCE'
  | 'FREE_BRIDGE'
  | 'SUSPENDED_CLASS'
  | 'SUBSTITUTION'
  | 'OUT_OF_SCHEDULE_PUNCH'
  | 'UNIDENTIFIED_PUNCH'
  | 'JUSTIFICATION'
  | 'EARLY_EXIT'

type AttendanceTimelineApiItem = {
  id: string
  time: string
  type: AttendanceTimelineType
  status: AttendanceTimelineStatus
  statusLabel: string
  title: string
  detail?: string | null
  teacher?: { id: string; name: string; email?: string | null } | null
  group?: { id: string; name: string } | null
  event?: { id: string; title: string } | null
}

type AttendanceTimelineResponse = {
  date: string
  summary: {
    expectedTeachers: number
    presentTeachers: number
    lateArrivals: number
    pendingAbsences: number
    suspendedClasses: number
    outOfSchedulePunches: number
    unidentifiedPunches: number
  }
  items: AttendanceTimelineApiItem[]
  filters: {
    teachers: { id: string; name: string; email?: string | null }[]
    groups: { id: string; name: string }[]
    statuses: { value: AttendanceTimelineStatus; label: string }[]
    types: { value: AttendanceTimelineType; label: string }[]
  }
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
  if (row.status === 'LATE' && row.notes?.toLowerCase().includes('llegada muy tarde')) return 'Llegada muy tarde'
  return labelAttendanceStatus(row.status)
}

function badgeClassForStatus(status: string): string {
  if (status === 'LATE') return 'bg-amber-100 text-amber-900 ring-1 ring-amber-200/60'
  if (status === 'ABSENT_NOT_JUSTIFIED') return 'bg-red-100 text-red-800 ring-1 ring-red-200/60'
  if (status === 'ABSENT_JUSTIFIED') return 'bg-slate-100 text-slate-800 ring-1 ring-slate-200/60'
  if (status === 'PRESENT') return 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200/60'
  if (status === 'EXIT' || status === 'EARLY_EXIT') return 'bg-sky-100 text-sky-900 ring-1 ring-sky-200/60'
  if (status === 'PENDING') return 'bg-red-100 text-red-800 ring-1 ring-red-200/60'
  if (status === 'FREE') return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200/60'
  if (status === 'SUSPENDED') return 'bg-violet-100 text-violet-900 ring-1 ring-violet-200/60'
  if (status === 'SUBSTITUTED') return 'bg-indigo-100 text-indigo-900 ring-1 ring-indigo-200/60'
  if (status === 'OUT_OF_SCHEDULE') return 'bg-orange-100 text-orange-900 ring-1 ring-orange-200/60'
  if (status === 'UNIDENTIFIED') return 'bg-rose-100 text-rose-900 ring-1 ring-rose-200/60'
  if (status === 'JUSTIFIED') return 'bg-blue-100 text-blue-900 ring-1 ring-blue-200/60'
  return 'bg-gray-100 text-gray-800 ring-1 ring-gray-200/50'
}

function todayInputValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montevideo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function iconToneForTimelineType(type: AttendanceTimelineType) {
  if (type === 'BIOMETRIC_ENTRY') return 'border-emerald-200 text-emerald-700'
  if (type === 'BIOMETRIC_EXIT') return 'border-sky-200 text-sky-700'
  if (type === 'LATE_ARRIVAL') return 'border-amber-200 text-amber-700'
  if (type === 'PENDING_ABSENCE' || type === 'UNIDENTIFIED_PUNCH') return 'border-red-200 text-red-700'
  if (type === 'OUT_OF_SCHEDULE_PUNCH') return 'border-orange-200 text-orange-700'
  if (type === 'SUSPENDED_CLASS') return 'border-violet-200 text-violet-700'
  if (type === 'SUBSTITUTION') return 'border-indigo-200 text-indigo-700'
  return 'border-slate-200 text-slate-600'
}

function iconForTimelineType(type: AttendanceTimelineType) {
  if (type === 'BIOMETRIC_ENTRY') return <LogIn className="h-[18px] w-[18px]" aria-hidden />
  if (type === 'BIOMETRIC_EXIT' || type === 'EARLY_EXIT') return <LogOut className="h-[18px] w-[18px]" aria-hidden />
  if (type === 'PENDING_ABSENCE' || type === 'UNIDENTIFIED_PUNCH' || type === 'OUT_OF_SCHEDULE_PUNCH') {
    return <AlertTriangle className="h-[18px] w-[18px]" aria-hidden />
  }
  if (type === 'FREE_BRIDGE') return <Clock className="h-[18px] w-[18px]" aria-hidden />
  return <Calendar className="h-[18px] w-[18px]" aria-hidden />
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

function attendanceDayGroupKey(row: AttendanceFeedRow): string {
  const dateKey = (row.date || row.time).slice(0, 10)
  return `${row.user?.id ?? 'user'}:${dateKey}`
}

type AttendanceTimelinePair = {
  key: string
  source: AttendanceFeedRow
  entry?: AttendanceFeedRow
  exit?: AttendanceFeedRow
  incident?: AttendanceFeedRow
}

function summarizeAttendanceTimelineEvent(pair: Pick<AttendanceTimelinePair, 'entry' | 'exit' | 'incident' | 'source'>) {
  const incidentEvent = pair.incident?.event
  if (incidentEvent) return { title: incidentEvent.title, type: incidentEvent.type }

  const entryEvent = pair.entry?.event
  const exitEvent = pair.exit?.event
  const first = entryEvent ?? exitEvent ?? pair.source.event
  const second = entryEvent && exitEvent && entryEvent.id !== exitEvent.id ? exitEvent : null

  if (!first) return { title: pair.source.title || 'Actividad sin evento', type: pair.source.event?.type }

  return {
    title: second ? `${first.title} → ${second.title}` : first.title,
    type: second && first.type !== second.type ? `${first.type} / ${second.type}` : first.type,
  }
}

function timelineEventKey(eventId: string, when: string): string {
  return `${eventId}:${when.slice(0, 10)}`
}

function coveredEventKeysForPair(pair: Pick<AttendanceTimelinePair, 'entry' | 'exit' | 'incident' | 'source'>): string[] {
  const rows = [pair.entry, pair.exit, pair.incident, pair.source].filter(Boolean) as AttendanceFeedRow[]
  return Array.from(
    new Set(
      rows
        .filter((row) => row.event?.id)
        .map((row) => timelineEventKey(row.event!.id, row.date || row.time)),
    ),
  )
}

function buildAttendanceTimelineItems(rows: AttendanceFeedRow[]): TimelineItem[] {
  const grouped = new Map<string, AttendanceFeedRow[]>()
  const incidentPairs: AttendanceTimelinePair[] = []

  for (const row of rows) {
    if (row.type === 'INCIDENT' || row.kind === 'INCIDENT') {
      incidentPairs.push({ key: row.id, source: row, incident: row })
      continue
    }

    const key = attendanceDayGroupKey(row)
    const group = grouped.get(key) ?? []
    group.push(row)
    grouped.set(key, group)
  }

  const pairs = [...incidentPairs]
  for (const [key, group] of grouped) {
    const dayPairs: AttendanceTimelinePair[] = []
    const openPairs: AttendanceTimelinePair[] = []
    const ordered = [...group].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

    for (const row of ordered) {
      if (row.type === 'CHECK_IN') {
        const pair: AttendanceTimelinePair = {
          key: `${key}:in:${row.id}`,
          source: row,
          entry: row,
        }
        dayPairs.push(pair)
        openPairs.push(pair)
        continue
      }

      const rowTime = new Date(row.time).getTime()
      const openPair = openPairs.find((pair) => pair.entry && !pair.exit && new Date(pair.entry.time).getTime() <= rowTime)
      if (openPair) {
        openPair.exit = row
        openPair.source = row
        continue
      }

      dayPairs.push({
        key: `${key}:out:${row.id}`,
        source: row,
        exit: row,
      })
    }

    pairs.push(...dayPairs)
  }

  return pairs.map((pair) => {
    const { entry, exit, incident } = pair
    const source = incident ?? exit ?? entry ?? pair.source
    const person = source.user?.name || source.user?.email || 'Usuario'
    const eventSummary = summarizeAttendanceTimelineEvent(pair)
    const parts = [
      entry ? `Entró ${formatTimeInUruguay(entry.time)}` : null,
      exit ? `Salió ${formatTimeInUruguay(exit.time)}` : null,
    ].filter(Boolean)

    if (incident) {
      return {
        id: `attendance:${pair.key}`,
        at: source.time,
        tone: 'incident',
        title: eventSummary.title,
        person,
        eventType: eventSummary.type,
        status: 'Falta',
        statusClass: badgeClassForStatus('ABSENT_NOT_JUSTIFIED'),
        summary: source.description || source.notes || 'No se registró asistencia para el evento.',
        coveredEventKeys: coveredEventKeysForPair(pair),
      }
    }

    const status =
      exit?.status === 'EARLY_EXIT'
        ? 'Salida anticipada'
        : exit
          ? 'Finalizado'
          : entry?.status === 'LATE'
            ? labelAttendanceFeedRow(entry)
            : 'En curso'

    return {
      id: `attendance:${pair.key}`,
      at: exit?.time || entry?.time || source.time,
      tone: exit ? 'exit' : 'entry',
      title: eventSummary.title,
      person,
      eventType: eventSummary.type,
      status,
      statusClass: badgeClassForStatus(exit?.status || entry?.status || source.status),
      summary: parts.length > 0 ? parts.join(' · ') : labelAttendanceFeedRow(source),
      coveredEventKeys: coveredEventKeysForPair(pair),
    }
  })
}

function buildEventTimelineItems(events: AssignedEventRow[], attendanceItems: TimelineItem[]): TimelineItem[] {
  const coveredEventKeys = new Set(attendanceItems.flatMap((item) => item.coveredEventKeys ?? []))
  return events
    .filter((event) => event.status === 'SCHEDULED' || event.status === 'IN_PROGRESS')
    .filter((event) => !coveredEventKeys.has(timelineEventKey(event.id, event.startTime || event.startDate)))
    .map((event) => ({
      id: `event:${event.id}`,
      at: event.startTime || event.startDate,
      tone: 'event' as const,
      title: event.title,
      person: event.assignedUser?.name || event.assignedUser?.email || 'Sin persona asignada',
      eventType: event.type,
      location: event.location,
      status: getAssignedEventStatusLabel(event.status),
      statusClass: getAssignedEventStatusColor(event.status),
      summary: `${formatTimeInUruguay(event.startTime || event.startDate)}${event.endTime ? ` - ${formatTimeInUruguay(event.endTime)}` : ''}`,
    }))
}

export function HomeAdminTimeline() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AttendanceTimelineResponse | null>(null)
  const [filters, setFilters] = useState({
    date: todayInputValue(),
    teacherId: '',
    groupId: '',
    status: '',
    type: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ date: filters.date })
      if (filters.teacherId) params.set('teacherId', filters.teacherId)
      if (filters.groupId) params.set('groupId', filters.groupId)
      if (filters.status) params.set('status', filters.status)
      if (filters.type) params.set('type', filters.type)
      const res = await api<AttendanceTimelineResponse>(`/analytics/attendance-timeline?${params.toString()}`)
      setData(res)
    } catch {
      setError('No se pudo cargar la cronología del día.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    void load()
  }, [load])

  const summaryCards = data
    ? [
        ['Docentes esperados hoy', data.summary.expectedTeachers],
        ['Docentes presentes', data.summary.presentTeachers],
        ['Llegadas tarde', data.summary.lateArrivals],
        ['Ausencias pendientes', data.summary.pendingAbsences],
        ['Clases suspendidas', data.summary.suspendedClasses],
        ['Fuera de horario', data.summary.outOfSchedulePunches],
        ['No identificadas', data.summary.unidentifiedPunches],
      ]
    : []

  const action = (
    <div className="flex flex-wrap gap-2">
      <a
        href="/admin/attendance"
        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3.5 py-2 text-sm font-medium text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50/80"
      >
        Asistencias
        <ChevronRight className="h-4 w-4 opacity-80" aria-hidden />
      </a>
      <a
        href="/admin/events"
        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3.5 py-2 text-sm font-medium text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50/80"
      >
        Eventos
        <ChevronRight className="h-4 w-4 opacity-80" aria-hidden />
      </a>
    </div>
  )

  return (
    <HomePanelShell
      title="Cronología de asistencia"
      subtitle="Resumen del día con marcaciones biométricas, bloques docentes, incidencias y suplencias."
      icon={<Clock className="h-6 w-6" strokeWidth={2} aria-hidden />}
      action={action}
    >
      <div className="space-y-4 p-4 sm:p-5">
        {data ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {summaryCards.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-100 bg-white px-3 py-3 shadow-sm">
                <div className="text-xl font-bold tabular-nums text-slate-900">{value}</div>
                <div className="mt-1 text-[11px] font-medium leading-tight text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Filter className="h-4 w-4" aria-hidden />
            Filtros
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <input
              type="date"
              value={filters.date}
              onChange={(e) => setFilters((prev) => ({ ...prev, date: e.target.value || todayInputValue() }))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              aria-label="Fecha"
            />
            <select
              value={filters.teacherId}
              onChange={(e) => setFilters((prev) => ({ ...prev, teacherId: e.target.value }))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              aria-label="Docente"
            >
              <option value="">Todos los docentes</option>
              {(data?.filters.teachers ?? []).map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
            </select>
            <select
              value={filters.groupId}
              onChange={(e) => setFilters((prev) => ({ ...prev, groupId: e.target.value }))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              aria-label="Grupo"
            >
              <option value="">Todos los grupos</option>
              {(data?.filters.groups ?? []).map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <select
              value={filters.status}
              onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              aria-label="Estado"
            >
              <option value="">Todos los estados</option>
              {(data?.filters.statuses ?? []).map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
            <select
              value={filters.type}
              onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              aria-label="Tipo de evento"
            >
              <option value="">Todos los tipos</option>
              {(data?.filters.types ?? []).map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
            <Loader2 className="h-9 w-9 animate-spin text-emerald-600" aria-hidden />
            <span className="text-sm">Cargando cronología…</span>
          </div>
        )}
        {!loading && error && <EmptyState message={error} />}
        {!loading && !error && (data?.items.length ?? 0) === 0 && (
          <EmptyState message="No hay eventos de asistencia para mostrar con esos filtros." />
        )}
        {!loading && !error && data && data.items.length > 0 && (
          <ol className="relative space-y-3 before:absolute before:bottom-3 before:left-5 before:top-3 before:w-px before:bg-emerald-100" role="list">
            {data.items.map((item) => (
              <li key={item.id} className="relative flex gap-3">
                <div
                  className={`z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-white shadow-sm ${iconToneForTimelineType(item.type)}`}
                  title={item.statusLabel}
                >
                  {iconForTimelineType(item.type)}
                </div>
                <div className="min-w-0 flex-1 rounded-xl border border-slate-100 bg-white/90 px-4 py-3.5 shadow-sm transition hover:border-emerald-200/80 hover:bg-emerald-50/25">
                  <div className="mb-2 flex flex-wrap gap-2 text-xs">
                    {item.type === 'SUBSTITUTION' ? (
                      <Link href="/admin/events" className="font-medium text-indigo-700 hover:underline">
                        Ver eventos
                      </Link>
                    ) : null}
                    {item.status === 'PENDING' || item.type === 'PENDING_ABSENCE' ? (
                      <Link href="/admin/attendance" className="font-medium text-emerald-700 hover:underline">
                        Gestionar asistencias
                      </Link>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 break-words text-sm font-semibold text-slate-900">{item.title}</h3>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClassForStatus(item.status)}`}>
                          {item.statusLabel}
                        </span>
                        {item.group ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                            {item.group.name}
                          </span>
                        ) : null}
                      </div>
                      {item.teacher ? (
                        <p className="truncate text-sm text-slate-600">
                          <span className="text-slate-400">Docente · </span>
                          {item.teacher.name}
                        </p>
                      ) : null}
                      {item.detail ? (
                        <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-slate-500">
                          <span className="truncate">{item.detail}</span>
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 rounded-lg bg-slate-50 px-3 py-2 text-left ring-1 ring-slate-100 sm:text-right">
                      <div className="text-sm font-semibold tabular-nums text-slate-800">{item.time}</div>
                      <div className="mt-1 text-xs text-slate-600">{item.event?.title || 'Resumen'}</div>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </HomePanelShell>
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
        pageSize: '8',
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

export function HomeAdminUpcomingEvents() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<AssignedEventRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const now = new Date()
      const to = new Date(now)
      to.setDate(to.getDate() + 14)
      const params = new URLSearchParams({
        startDate: now.toISOString(),
        endDate: to.toISOString(),
        page: '1',
        pageSize: '8',
        status: 'SCHEDULED',
      })
      const res = await api<AdminEventsResponse>(`/events/all?${params.toString()}`)
      setEvents(res.data ?? [])
    } catch {
      setError('No se pudieron cargar los próximos eventos.')
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = events
    .filter((e) => e.status === 'SCHEDULED' || e.status === 'IN_PROGRESS')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'IN_PROGRESS' ? -1 : 1
      const aTime = new Date(a.startTime || a.startDate).getTime()
      const bTime = new Date(b.startTime || b.startDate).getTime()
      return aTime - bTime
    })
    .slice(0, 6)

  const action = (
    <a
      href="/admin/events"
      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-medium text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50/80"
    >
      Gestionar eventos
      <ChevronRight className="h-4 w-4 opacity-80" aria-hidden />
    </a>
  )

  return (
    <HomePanelShell
      title="Próximos eventos"
      subtitle="Agenda institucional cercana: clases, turnos y actividades programadas para los próximos días."
      icon={<Calendar className="h-6 w-6" strokeWidth={2} aria-hidden />}
      action={action}
    >
      <div className="p-4 sm:p-5">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
            <Loader2 className="h-9 w-9 animate-spin text-emerald-600" aria-hidden />
            <span className="text-sm">Cargando próximos eventos…</span>
          </div>
        )}
        {!loading && error && <EmptyState message={error} />}
        {!loading && !error && visible.length === 0 && (
          <EmptyState message="No hay eventos próximos en los próximos días. Cuando se programe actividad, aparecerá aquí." />
        )}
        {!loading && !error && visible.length > 0 && (
          <ul className="grid gap-2 2xl:grid-cols-2" role="list">
            {visible.map((event) => (
              <li
                key={event.id}
                className="rounded-xl border border-slate-100 bg-white/90 px-4 py-3.5 shadow-sm transition hover:border-emerald-200/80 hover:bg-emerald-50/25"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <h3 className="truncate text-sm font-semibold text-slate-900">{event.title}</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${getAssignedEventStatusColor(event.status)}`}>
                        {getAssignedEventStatusLabel(event.status)}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        {getEventTypeLabel(event.type)}
                      </span>
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {event.assignedUser?.name || event.assignedUser?.email ? (
                        <>
                          <span className="text-slate-400">Asignado a · </span>
                          {event.assignedUser.name || event.assignedUser.email}
                        </>
                      ) : (
                        <span className="text-slate-400">Sin persona asignada</span>
                      )}
                    </p>
                    {event.location ? (
                      <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-slate-500">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                        <span className="truncate">{event.location}</span>
                      </p>
                    ) : null}
                  </div>
                  <div className="shrink-0 rounded-lg bg-slate-50 px-3 py-2 text-right ring-1 ring-slate-100">
                    <div className="text-sm font-semibold tabular-nums text-slate-800">{formatDateInUruguay(event.startDate)}</div>
                    {event.startTime ? (
                      <div className="mt-1 text-xs tabular-nums text-slate-600">
                        {formatTimeInUruguay(event.startTime)}
                        {event.endTime ? ` - ${formatTimeInUruguay(event.endTime)}` : ''}
                      </div>
                    ) : null}
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
