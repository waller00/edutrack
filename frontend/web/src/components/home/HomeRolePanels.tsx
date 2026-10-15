'use client'

import type { Dispatch, ReactNode, SetStateAction } from 'react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  Filter,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  User,
  UserCheck,
  UserX,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import type { AssignedEventRow } from '@/components/personal/MyAssignedEventsPage'
import DateField from '@/components/forms/DateField'
import {
  getEventTypeLabel,
  getAssignedEventStatusLabel,
  getAssignedEventStatusColor,
} from '@/lib/events/assigned-event-display'
import { formatDateInUruguay, formatTimeInUruguay } from '@/lib/forms/datetime-uy'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import { useNow } from '@/lib/hooks/useNow'
import {
  dayRollCallChipClass,
  dayRollCallLabel,
  dayRollCallPhase,
  dayRollCallTally,
  type DayRollCall,
} from '@/lib/rollcall/rollcall-phase'
import { rollCallHref } from '@/lib/rollcall/class-row'

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
  | 'SCHEDULED'
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
  endTime?: string | null
  type: AttendanceTimelineType
  status: AttendanceTimelineStatus
  statusLabel: string
  title: string
  detail?: string | null
  teacher?: { id: string; name: string; email?: string | null } | null
  group?: { id: string; name: string } | null
  event?: { id: string; title: string } | null
  /** Pase de lista de los alumnos en esa clase. */
  rollCall?: DayRollCall | null
}

type AttendanceTimelineResponse = {
  date: string
  summary: {
    expectedTeachers: number
    presentTeachers: number
    lateArrivals: number
    pendingAbsences: number
    expectedAbsences?: number
    substitutions?: number
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
    OUT_OF_SCHEDULE: 'Fuera de horario',
    SUBSTITUTED: 'Suplido',
    SCHEDULED: 'Programada',
    PENDING: 'Pendiente',
    FREE: 'Libre',
    SUSPENDED: 'Suspendido',
    UNIDENTIFIED: 'No identificado',
    JUSTIFIED: 'Justificado',
    REGISTERED: 'Registrado',
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
  if (status === 'SCHEDULED') return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200/60'
  if (status === 'EXIT' || status === 'EARLY_EXIT') return 'bg-sky-100 text-sky-900 ring-1 ring-sky-200/60'
  if (status === 'PENDING') return 'bg-red-100 text-red-800 ring-1 ring-red-200/60'
  if (status === 'FREE') return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200/60'
  if (status === 'SUSPENDED') return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200/60'
  if (status === 'SUBSTITUTED') return 'bg-indigo-100 text-indigo-900 ring-1 ring-indigo-200/60'
  if (status === 'OUT_OF_SCHEDULE') return 'bg-orange-100 text-orange-900 ring-1 ring-orange-200/60'
  if (status === 'UNIDENTIFIED') return 'bg-rose-100 text-rose-900 ring-1 ring-rose-200/60'
  if (status === 'JUSTIFIED') return 'bg-blue-100 text-blue-900 ring-1 ring-blue-200/60'
  if (status === 'REGISTERED') return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200/60'
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
  if (type === 'SUSPENDED_CLASS') return 'border-slate-200 text-slate-600'
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
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
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
      <div>{children}</div>
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

type CompactTimelineItem = AttendanceTimelineApiItem & {
  mergedCount?: number
  mergedEndTime?: string | null
}

const INCIDENT_TIMELINE_TYPES = new Set<AttendanceTimelineType>([
  'PENDING_ABSENCE',
  'LATE_ARRIVAL',
  'EARLY_EXIT',
  'OUT_OF_SCHEDULE_PUNCH',
  'UNIDENTIFIED_PUNCH',
  'SUBSTITUTION',
  'SUSPENDED_CLASS',
])

const CLASS_TIMELINE_TYPES = new Set<AttendanceTimelineType>([
  'CLASS_ATTENDANCE',
  'LATE_ARRIVAL',
  'PENDING_ABSENCE',
  'SUBSTITUTION',
  'SUSPENDED_CLASS',
])

function timelineMinutes(item: Pick<AttendanceTimelineApiItem, 'time'>) {
  const [hours, minutes] = item.time.split(':').map((value) => Number(value))
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.MAX_SAFE_INTEGER
  return hours * 60 + minutes
}

function timelineTeacherName(item: AttendanceTimelineApiItem) {
  return item.teacher?.name || item.teacher?.email || 'Docente'
}

function timelineClassName(item: AttendanceTimelineApiItem) {
  if (item.event?.title && item.group?.name) return `${item.event.title} ${item.group.name}`
  return item.event?.title || item.group?.name || item.title
}

function compactTimelineItems(items: AttendanceTimelineApiItem[]): CompactTimelineItem[] {
  const compacted: CompactTimelineItem[] = []
  const seen = new Map<string, CompactTimelineItem>()

  for (const item of items) {
    const classKey =
      item.type === 'CLASS_ATTENDANCE' && item.status === 'PRESENT'
        ? `class:${item.teacher?.id || 'teacher'}:${item.event?.id || item.title}:${item.group?.id || 'group'}:${item.status}`
        : null
    const biometricKey =
      item.type === 'BIOMETRIC_ENTRY' || item.type === 'BIOMETRIC_EXIT'
        ? `biometric:${item.type}:${item.teacher?.id || 'teacher'}:${item.time}:${item.status}`
        : null
    const key = classKey || biometricKey

    if (key && seen.has(key)) {
      const existing = seen.get(key)!
      existing.mergedCount = (existing.mergedCount || 1) + 1
      if (classKey) existing.mergedEndTime = item.endTime || item.time
      continue
    }

    const next = { ...item } as CompactTimelineItem
    if (key) seen.set(key, next)
    compacted.push(next)
  }

  return compacted
}

function timelineDisplayTime(item: CompactTimelineItem) {
  const end = item.mergedEndTime || item.endTime
  if (end && end !== item.time) return `${item.time} - ${end}`
  return item.time
}

function humanTimelineTitle(item: AttendanceTimelineApiItem) {
  const teacher = timelineTeacherName(item)
  const className = timelineClassName(item)

  if (item.type === 'BIOMETRIC_ENTRY') return `${teacher} registró entrada por huella`
  if (item.type === 'BIOMETRIC_EXIT') return `${teacher} registró salida por huella`
  if (item.type === 'LATE_ARRIVAL') return `${teacher} llegó tarde a ${className}`
  if (item.type === 'PENDING_ABSENCE') return `Falta del docente sin justificar: ${className}`
  if (item.type === 'EARLY_EXIT') return `${teacher} registró retiro anticipado`
  if (item.type === 'OUT_OF_SCHEDULE_PUNCH') return 'Se detectó una marcación fuera de horario'
  if (item.type === 'UNIDENTIFIED_PUNCH') return 'Se detectó una marcación no identificada'
  if (item.type === 'JUSTIFICATION') return `${teacher} tiene justificación registrada`
  if (item.type === 'SUBSTITUTION' && !item.title.toLowerCase().includes('cubre')) {
    return `${teacher} tiene ausencia prevista sin justificar en ${className}`
  }
  if (item.type === 'CLASS_ATTENDANCE' && item.status === 'PRESENT') return `${className} · docente presente`
  if (item.type === 'CLASS_ATTENDANCE' && item.status === 'SCHEDULED') return `${className} · programada`
  return item.title
}

/** Estado del pase de lista de la clase, con texto (RNF 7.2) y, si se puede, enlace a la lista. */
function ClassRollCallStatus({ rollCall, now, canOpen }: { rollCall: DayRollCall; now: Date; canOpen: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-sm text-slate-400">Estudiantes · </span>
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-medium ${dayRollCallChipClass(
          dayRollCallPhase(rollCall, now),
        )}`}
      >
        <ClipboardList className="h-3.5 w-3.5" aria-hidden />
        {dayRollCallLabel(rollCall, now)}
      </span>
      {canOpen ? (
        <Link href={rollCallHref(rollCall)} className="font-semibold text-emerald-700 hover:underline">
          Ver lista
        </Link>
      ) : null}
    </div>
  )
}

function isBridgeVisible(filters: { teacherId: string; type: string }, showFreeBlocks: boolean) {
  return showFreeBlocks || !!filters.teacherId || filters.type === 'FREE_BRIDGE'
}

type TimelineFilters = {
  date: string
  teacherId: string
  groupId: string
  status: string
  type: string
}

function HomeTimelineFilters({ data, filters, setFilters, showFreeBlocks, setShowFreeBlocks }: {
  data: AttendanceTimelineResponse
  filters: TimelineFilters
  setFilters: Dispatch<SetStateAction<TimelineFilters>>
  showFreeBlocks: boolean
  setShowFreeBlocks: Dispatch<SetStateAction<boolean>>
}) {
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-slate-100 px-4 py-3 sm:grid-cols-2 lg:grid-cols-5">
      <DateField
        value={filters.date}
        onChange={(v) => setFilters((prev) => ({ ...prev, date: v || todayInputValue() }))}
        className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        aria-label="Fecha"
      />
      <select
        value={filters.teacherId}
        onChange={(e) => setFilters((prev) => ({ ...prev, teacherId: e.target.value }))}
        className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        aria-label="Docente"
      >
        <option value="">Todos los docentes</option>
        {data.filters.teachers.map((teacher) => (
          <option key={teacher.id} value={teacher.id}>
            {teacher.name}
          </option>
        ))}
      </select>
      <select
        value={filters.groupId}
        onChange={(e) => setFilters((prev) => ({ ...prev, groupId: e.target.value }))}
        className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        aria-label="Grupo"
      >
        <option value="">Todos los grupos</option>
        {data.filters.groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>
      <select
        value={filters.status}
        onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
        className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        aria-label="Estado"
      >
        <option value="">Todos los estados</option>
        {data.filters.statuses.map((status) => (
          <option key={status.value} value={status.value}>
            {status.label}
          </option>
        ))}
      </select>
      <select
        value={filters.type}
        onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
        className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        aria-label="Movimiento"
      >
        <option value="">Todos los movimientos</option>
        {data.filters.types.map((type) => (
          <option key={type.value} value={type.value}>
            {type.label}
          </option>
        ))}
      </select>
      <label className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 lg:col-span-5">
        <input
          type="checkbox"
          checked={showFreeBlocks}
          onChange={(e) => setShowFreeBlocks(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        />
        Ver bloques libres
      </label>
      <button
        type="button"
        onClick={() => {
          setFilters({ date: todayInputValue(), teacherId: '', groupId: '', status: '', type: '' })
          setShowFreeBlocks(false)
        }}
        className="justify-self-start text-sm font-semibold text-emerald-700 hover:underline"
      >
        Restablecer filtros
      </button>
    </div>
  )
}

export function HomeAdminTimeline() {
  const me = useOptionalAuth()?.me ?? null
  const now = useNow(60_000)
  // La planilla de otro docente sólo la abre quien pasa lista con alcance total.
  const canReadAttendance = hasPermission(me, 'attendance.read', 'all')
  const canReadEvents = hasPermission(me, 'events.read', 'all')
  const canOpenRollCall = hasPermission(me, 'student-attendance.take', 'all')
  const requestId = useRef(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AttendanceTimelineResponse | null>(null)
  const [showFreeBlocks, setShowFreeBlocks] = useState(false)
  const [view, setView] = useState<'incidents' | 'classes' | 'activity'>('incidents')
  const [showAll, setShowAll] = useState(false)
  const [filters, setFilters] = useState({
    date: todayInputValue(),
    teacherId: '',
    groupId: '',
    status: '',
    type: '',
  })

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ date: filters.date })
      if (filters.teacherId) params.set('teacherId', filters.teacherId)
      if (filters.groupId) params.set('groupId', filters.groupId)
      if (filters.status) params.set('status', filters.status)
      if (filters.type) params.set('type', filters.type)
      const res = await api<AttendanceTimelineResponse>(`/analytics/attendance-timeline?${params.toString()}`)
      if (currentRequest === requestId.current) setData(res)
    } catch {
      if (currentRequest === requestId.current) setError('No se pudo cargar el resumen del día.')
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    void load()
    return () => { requestId.current += 1 }
  }, [load])

  const visibleRawItems = data
    ? data.items.filter((item) => item.type !== 'FREE_BRIDGE' || isBridgeVisible(filters, showFreeBlocks))
    : []
  // Orden operativo: lo más reciente del día primero (a administración le importa lo último que pasó).
  const compactItems = compactTimelineItems(visibleRawItems).sort((a, b) => timelineMinutes(b) - timelineMinutes(a))
  const incidentItems = compactItems.filter((item) => INCIDENT_TIMELINE_TYPES.has(item.type))
  const classItems = compactItems.filter((item) => CLASS_TIMELINE_TYPES.has(item.type))
  const activityItems = compactItems
    .filter((item) => item.type !== 'CLASS_ATTENDANCE' || item.status !== 'PRESENT' || (item.mergedCount || 1) <= 1 || item.event?.id)
  const selectedItems = view === 'incidents' ? incidentItems : view === 'classes' ? classItems : activityItems
  const rollCallTally = dayRollCallTally(classItems.map((item) => item.rollCall), now)
  const preview = (items: CompactTimelineItem[]) => showAll ? items : items.slice(0, 5)
  const hasFilters = !!(filters.date !== todayInputValue() || filters.teacherId || filters.groupId || filters.status || filters.type || showFreeBlocks)

  useEffect(() => {
    setShowAll(false)
  }, [view, filters, showFreeBlocks])
  const expectedAbsencesCount =
    data?.summary.expectedAbsences ??
    data?.summary.substitutions ??
    data?.items.filter((item) => item.type === 'SUBSTITUTION' && !item.title.toLowerCase().includes('cubre')).length ??
    0

  const primaryCards = data ? [
    { label: 'Ausencias pendientes', value: data.summary.pendingAbsences, icon: <UserX className="h-4 w-4 text-amber-700" aria-hidden /> },
    { label: 'Llegadas tarde', value: data.summary.lateArrivals, icon: <Clock className="h-4 w-4 text-amber-700" aria-hidden /> },
  ] : []
  const secondaryCards = data ? [
    { label: 'Ausencias previstas', value: expectedAbsencesCount },
    { label: 'Clases suspendidas', value: data.summary.suspendedClasses },
    { label: 'Fuera de horario', value: data.summary.outOfSchedulePunches },
    { label: 'No identificadas', value: data.summary.unidentifiedPunches },
  ] : []

  const action = (
    <div className="flex flex-wrap gap-2">
      {canReadAttendance && <a
        href="/admin/attendance"
        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3.5 py-2 text-sm font-medium text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50/80"
      >
        Asistencias
        <ChevronRight className="h-4 w-4 opacity-80" aria-hidden />
      </a>}
      {canReadEvents && <a
        href="/admin/events"
        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3.5 py-2 text-sm font-medium text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50/80"
      >
        Agenda
        <ChevronRight className="h-4 w-4 opacity-80" aria-hidden />
      </a>}
    </div>
  )

  return (
    <HomePanelShell
      title="Resumen del día"
      subtitle="Pendientes, clases y movimientos del día."
      icon={<ClipboardList className="h-6 w-6" strokeWidth={2} aria-hidden />}
      action={action}
    >
      <div className="space-y-5 p-4 sm:p-5">
        {data && !loading && !error ? (
          <section aria-labelledby="daily-summary-title" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 id="daily-summary-title" className="text-sm font-medium text-slate-600">
                Asistencia del personal
              </h3>
              <span className="text-xs font-medium tabular-nums text-slate-500">{formatDateInUruguay(`${data.date}T12:00:00-03:00`)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="col-span-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 sm:col-span-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-600">Docentes presentes</span>
                  <UserCheck className="h-4 w-4 text-emerald-600" aria-hidden />
                </div>
                <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">
                  {data.summary.presentTeachers}
                  <span className="ml-2 text-sm font-normal text-slate-500">de {data.summary.expectedTeachers} esperados</span>
                </p>
              </div>
              {primaryCards.map((card) => (
                <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-600">{card.label}</span>
                    {card.icon}
                  </div>
                  <div className={`mt-2 text-3xl font-semibold tabular-nums ${card.value > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{card.value}</div>
                </div>
              ))}
            </div>
            <details className="group rounded-lg border border-slate-100">
              <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-emerald-600">Más indicadores</summary>
              <dl className="grid gap-3 border-t border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-4">
                {secondaryCards.map((card) => (
                  <div key={card.label} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                    <dt className="text-xs text-slate-600">{card.label}</dt>
                    <dd className="text-sm font-semibold tabular-nums text-slate-900">{card.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </section>
        ) : null}

        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
            <Loader2 className="h-9 w-9 animate-spin text-emerald-600" aria-hidden />
            <span className="text-sm">Cargando inicio…</span>
          </div>
        )}
        {!loading && error && (
          <div role="alert" className="py-6 text-center">
            <p className="text-sm text-slate-600">{error}</p>
            <button type="button" onClick={() => void load()} className="btn-secondary mt-3 text-sm">Volver a intentar</button>
          </div>
        )}

        {data && (
          <details className="rounded-xl border border-slate-200">
            <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-emerald-600">
              <span className="ml-1 inline-flex items-center gap-2"><Filter className="h-4 w-4" aria-hidden />Filtrar resumen{hasFilters ? ' · Filtros activos' : ''}</span>
            </summary>
            <HomeTimelineFilters data={data} filters={filters} setFilters={setFilters} showFreeBlocks={showFreeBlocks} setShowFreeBlocks={setShowFreeBlocks} />
          </details>
        )}

        {!loading && !error && data ? (
          <div className="space-y-4">
            <div role="group" aria-label="Vista del resumen" className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
              {([
                { id: 'incidents', label: 'Pendientes', count: incidentItems.length },
                { id: 'classes', label: 'Clases', count: classItems.length },
                { id: 'activity', label: 'Actividad', count: activityItems.length },
              ] as const).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={view === option.id}
                  onClick={() => setView(option.id)}
                  className={`flex min-h-11 items-center justify-center gap-1 rounded-lg px-1 py-2 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 sm:gap-1.5 sm:px-2 sm:text-sm ${view === option.id ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-600 hover:bg-white/60'}`}
                >
                  {option.label}{' '}<span className="rounded-md bg-slate-100 px-1.5 text-xs tabular-nums text-slate-500">{option.count}</span>
                </button>
              ))}
            </div>
            {view === 'incidents' && (
              <section className="rounded-xl border border-slate-200 bg-white" aria-labelledby="today-incidents-title">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                  <div>
                    <h2 id="today-incidents-title" className="text-base font-semibold text-slate-900">
                      Necesita tu atención
                    </h2>
                    <p className="text-xs text-slate-500">Incidencias de la fecha seleccionada.</p>
                  </div>
                  <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-red-700 ring-1 ring-red-100">
                    {incidentItems.length}
                  </span>
                </div>
                {incidentItems.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden />
                    <p className="text-sm font-semibold text-slate-800">Sin incidencias para revisar</p>
                    <p className="text-sm text-slate-500">Podés consultar las clases o la actividad del día.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100" role="list">
                    {preview(incidentItems).map((item) => (
                      <li key={item.id} className="flex gap-3 px-4 py-3.5">
                        <div
                          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-white ${iconToneForTimelineType(item.type)}`}
                          title={item.statusLabel}
                        >
                          {iconForTimelineType(item.type)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="min-w-0 break-words text-sm font-semibold text-slate-900">
                              {item.type === 'PENDING_ABSENCE' ? `Falta del docente en ${timelineClassName(item)}` : humanTimelineTitle(item)}
                            </p>
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClassForStatus(item.status)}`}>
                              {item.statusLabel}
                            </span>
                          </div>
                          {item.type === 'PENDING_ABSENCE' && item.teacher && <p className="mt-1 text-sm text-slate-600">{timelineTeacherName(item)}</p>}
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                            <span className="font-medium tabular-nums text-slate-700">{timelineDisplayTime(item)}</span>
                            {item.group && item.type !== 'PENDING_ABSENCE' ? <span>{item.group.name}</span> : null}
                            {item.detail ? <span className="break-words">{item.detail}</span> : null}
                            {((item.type === 'SUBSTITUTION' || item.type === 'SUSPENDED_CLASS') ? canReadEvents : canReadAttendance) && <Link href={item.type === 'SUBSTITUTION' || item.type === 'SUSPENDED_CLASS' ? '/admin/events' : '/admin/attendance'} className="font-semibold text-emerald-700 hover:underline">Revisar<ChevronRight className="ml-0.5 inline h-3 w-3" aria-hidden /></Link>}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {view === 'classes' && (
              <section className="rounded-xl border border-slate-200 bg-white" aria-labelledby="today-classes-title">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                  <div>
                    <h2 id="today-classes-title" className="text-base font-semibold text-slate-900">
                      Clases del día
                    </h2>
                    <p className="text-xs text-slate-500">
                      Horario, docente y estado de cada clase.
                      {rollCallTally.opened > 0 ? (
                        <span className="ml-1 font-medium text-slate-700">
                          Listas pasadas: {rollCallTally.taken} de {rollCallTally.opened}.
                        </span>
                      ) : null}
                    </p>
                  </div>
                  {canReadEvents && <a href="/admin/events" className="text-xs font-semibold text-emerald-700 hover:underline">
                    Ver agenda
                  </a>}
                </div>
                {classItems.length === 0 ? (
                  <div className="px-4 py-8 text-sm text-slate-500">No hay clases para mostrar con estos filtros.</div>
                ) : (
                  <ul className="divide-y divide-slate-100" role="list">
                    {preview(classItems).map((item) => (
                      <li key={item.id} className="px-4 py-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <h3 className="break-words text-sm font-semibold text-slate-900">{timelineClassName(item)}</h3>
                            <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-slate-600">
                              <span className="min-w-0 truncate">
                                <span className="text-slate-400">Docente · </span>
                                {timelineTeacherName(item)}
                              </span>
                              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClassForStatus(item.status)}`}>
                                {item.statusLabel}
                              </span>
                            </p>
                            <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                              {item.group ? <span>{item.group.name}</span> : null}
                              {item.type === 'SUBSTITUTION' && item.status === 'SUBSTITUTED' ? <span>Cubierta por suplencia</span> : null}
                              {item.type === 'PENDING_ABSENCE' ? <span>Clase sin docente presente</span> : null}
                            </div>
                            {item.rollCall ? (
                              <ClassRollCallStatus rollCall={item.rollCall} now={now} canOpen={canOpenRollCall} />
                            ) : null}
                          </div>
                          <div className="shrink-0 rounded-lg bg-slate-50 px-3 py-2 text-right ring-1 ring-slate-100">
                            <div className="text-sm font-semibold tabular-nums text-slate-800">{timelineDisplayTime(item)}</div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        ) : null}

        {!loading && !error && data && view === 'activity' ? (
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="recent-activity-title">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 id="recent-activity-title" className="text-base font-semibold text-slate-900">
                  Actividad reciente
                </h2>
                <p className="text-xs text-slate-500">Cronología resumida del día.</p>
              </div>
            </div>

            {activityItems.length === 0 ? (
              <div className="px-4 py-8 text-sm text-slate-500">No hay actividad relevante para mostrar con esos filtros.</div>
            ) : (
              <ol className="divide-y divide-slate-100" role="list">
                {preview(activityItems).map((item) => (
                  <li key={item.id} className="flex gap-3 px-4 py-3.5">
                    <div
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-white ${iconToneForTimelineType(item.type)}`}
                      title={item.statusLabel}
                    >
                      {iconForTimelineType(item.type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 break-words text-sm font-semibold text-slate-900">{humanTimelineTitle(item)}</h3>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClassForStatus(item.status)}`}>
                          {item.statusLabel}
                        </span>
                        {item.mergedCount && item.mergedCount > 1 ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                            {item.mergedCount} bloques agrupados
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span className="font-medium tabular-nums text-slate-700">{timelineDisplayTime(item)}</span>
                        {item.teacher ? <span>{timelineTeacherName(item)}</span> : null}
                        {item.group ? <span>{item.group.name}</span> : null}
                        {item.type === 'SUBSTITUTION' && canReadEvents ? (
                          <Link href="/admin/events" className="font-medium text-indigo-700 hover:underline">
                            Ver agenda
                          </Link>
                        ) : null}
                        {canReadAttendance && (item.status === 'PENDING' || item.type === 'PENDING_ABSENCE') ? (
                          <Link href="/admin/attendance" className="font-medium text-emerald-700 hover:underline">
                            Gestionar asistencias
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}
        {!loading && !error && data && selectedItems.length > 5 && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-500">{showAll ? selectedItems.length : 5} de {selectedItems.length} registros</p>
            <button type="button" onClick={() => setShowAll((previous) => !previous)} className="text-sm font-semibold text-emerald-700 hover:underline">
              {showAll ? 'Mostrar menos' : 'Ver todos los registros'}
            </button>
          </div>
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
      Abrir agenda
      <ChevronRight className="h-4 w-4 opacity-80" aria-hidden />
    </a>
  )

  return (
    <HomePanelShell
      title="Próximas actividades"
      subtitle="Agenda institucional cercana: clases, turnos y actividades programadas para los próximos días."
      icon={<Calendar className="h-6 w-6" strokeWidth={2} aria-hidden />}
      action={action}
    >
      <div className="p-4 sm:p-5">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
            <Loader2 className="h-9 w-9 animate-spin text-emerald-600" aria-hidden />
            <span className="text-sm">Cargando próximas actividades…</span>
          </div>
        )}
        {!loading && error && <EmptyState message={error} />}
        {!loading && !error && visible.length === 0 && (
          <EmptyState message="No hay actividades próximas en los próximos días. Cuando se programe actividad, aparecerá aquí." />
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

export function HomeUpcomingSchedule({ role, userId }: { role: string; userId?: string }) {
  const [events, setEvents] = useState<AssignedEventRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!userId) {
      setEvents([])
      setLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(false)
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
      } catch {
        if (!cancelled) {
          setEvents([])
          setError(true)
        }
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
    .slice(0, 4)

  const eventsHref = '/me/events'

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
      title={role === 'TEACHER' ? 'Tus próximas clases' : role === 'STAFF' ? 'Tus próximos turnos' : 'Tus próximas actividades'}
      subtitle="Las actividades más cercanas. Consultá el resto en tu agenda."
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
        {!loading && error && <EmptyState message="No pudimos cargar tu agenda. Abrí la agenda completa para volver a consultar." />}
        {!loading && !error && visible.length === 0 && (
          <EmptyState message="No tenés actividades programadas para las próximas dos semanas." />
        )}
        {!loading && !error && visible.length > 0 && (
          <ul className="space-y-3" role="list">
            {visible.map((event) => (
              <li key={event.id}>
                <div className="min-w-0 flex-1">
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
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
          Si tenés alertas arriba (correo, perfil o aprobación), resolvelas primero. Después podés usar el menú para navegar.
        </p>
      </div>
    </HomePanelShell>
  )
}
