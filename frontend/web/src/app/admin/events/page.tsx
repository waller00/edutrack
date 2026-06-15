'use client'
import DateRangeFields from '@/components/forms/DateRangeFields'
import PaginationControls from '@/components/common/PaginationControls'
import RoleGuard from '@/components/auth/RoleGuard'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, Download, Upload } from 'lucide-react'
import { api } from '@/lib/api/client'
import {
  buildAdminEventsAllQueryString,
  ADMIN_EVENT_TYPE_SELECT_OPTIONS,
  getAdminEventRoleTypeOptions,
  getAdminEventStatusLabel,
  getAdminEventStatusStyle,
  getAdminEventTypeLabel,
  type AdminEventCreatorRole,
} from '@/lib/admin/events-display'
import { getAdminFlashMessageClass } from '@/lib/admin/ui-helpers'
import { getRoleLabel } from '@/lib/roles/display'
import {
  addDaysToYmd,
  eventAssignedWeekdays,
  getEventsForYmd,
  uniqueSortedDays,
  weekdayNumberInUruguay,
  type EventOccurrence,
  type OccurrenceChild,
} from '@/lib/admin/event-occurrences'
import {
  formatDateInUruguay,
  formatTimeInUruguay,
  formatClockHhMmInUruguayFromIso,
  getTodayYmdInUruguay,
  isUruguayWallDateTimeInPast,
} from '@/lib/forms/datetime-uy'
import SubstitutionModal, { type SubstitutionModalEvent } from '@/components/admin/SubstitutionModal'
import EventsCalendar, { type CalendarEvent } from '@/components/admin/EventsCalendar'
import type { SubstitutionListResponse } from '@/lib/substitutions/types'
import {
  resolveAdminSchoolYearForEvents,
  schoolYearRangeLabel,
  type RecurrenceRangeMode,
} from '@/lib/admin/event-recurrence'

type CourseOpt = { id: string; name: string; code: string | null; isActive?: boolean }
type CourseOrientationOpt = {
  id: string
  orientationId: string
  isActive: boolean
  orientation: { id: string; name: string; code: string | null }
}
type SubjectOpt = { id: string; name: string; code: string | null }

function withSchoolYear(path: string, schoolYearQuery: string): string {
  if (!schoolYearQuery) return path
  return path.includes('?') ? `${path}&${schoolYearQuery}` : `${path}?${schoolYearQuery}`
}

type Event = {
  id: string
  title: string
  description?: string
  type: 'JORNADA_LABORAL' | 'REUNION' | 'CLASE'
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED'
  startDate: string
  endDate?: string
  startTime?: string
  endTime?: string
  location?: string
  user: {
    id: string
    name: string
    username?: string
    email: string
    role: string
  }
  assignedUser?: {
    id: string
    name: string
    username?: string
    email: string
    role: string
  }
  assignedUserId?: string
  courseId?: string | null
  course?: { id: string; name: string; code: string | null } | null
  orientationId?: string | null
  courseOrientationId?: string | null
  orientation?: { id: string; name: string; code: string | null } | null
  subjectId?: string | null
  subject?: { id: string; name: string; code: string | null } | null
  recurrenceType: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'
  isRecurring: boolean
  daysOfWeek: number[]
  recurrenceEnd?: string
  childEvents?: OccurrenceChild[]
  _count: {
    attendances: number
  }
}

type User = {
  id: string
  name: string
  username?: string
  email: string
  role: string
}

type EventImportError = { row: number; message: string }
type EventImportResponse = {
  ok: boolean
  createdCount: number
  validCount?: number
  errors?: EventImportError[]
}

type EventTypeOption = Event['type']
type EventStatusOption = Event['status']
type RoleOption = AdminEventCreatorRole
type EditableEvent = Pick<
  Event,
  | 'title'
  | 'description'
  | 'type'
  | 'startDate'
  | 'startTime'
  | 'endTime'
  | 'assignedUserId'
  | 'courseId'
  | 'orientationId'
  | 'courseOrientationId'
  | 'subjectId'
  | 'recurrenceType'
  | 'isRecurring'
  | 'daysOfWeek'
  | 'recurrenceEnd'
> & {
  assignedUserId: string
  recurrenceEnd: string
  courseId: string
  orientationId: string
  courseOrientationId: string
  subjectId: string
}

function timeStringToMinutes(t: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t.trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function getApiErrorDetail(error: unknown): string {
  const e = error as {
    message?: string
    data?: {
      message?: string
      detail?: string
      errors?: { path: (string | number)[]; message: string }[]
      issues?: { path: (string | number)[]; message: string }[]
      fieldErrors?: Record<string, string[] | undefined>
    }
  }
  if (e.data?.detail) return e.data.detail
  const fe = e.data?.fieldErrors
  if (fe && typeof fe === 'object') {
    const parts = Object.entries(fe).flatMap(([k, msgs]) =>
      (msgs ?? []).map((msg) => `${k}: ${msg}`),
    )
    if (parts.length > 0) return parts.join(' · ')
  }
  const zod = e.data?.errors ?? e.data?.issues
  if (zod && zod.length > 0) {
    return zod.map((err) => (err.path?.length ? `${err.path.join('.')}: ` : '') + err.message).join(' · ')
  }
  return e.data?.message || e.message || 'Error desconocido'
}

function csvCell(value: string): string {
  if (/[;"\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function buildEventImportTemplate(): string {
  const headers = [
    'titulo',
    'descripcion',
    'tipo',
    'fecha',
    'hora_inicio',
    'hora_fin',
    'asignado_a',
    'curso',
    'orientacion',
    'asignatura',
    'repite',
    'dias',
    'fin_repeticion',
  ]
  const rows = [
    [
      'Clase semanal Biología',
      'Una fila crea toda la regla semanal',
      'CLASE',
      '2026-03-02',
      '09:00',
      '10:30',
      'usuario_docente',
      '3-EMS',
      'Ciencias de la Vida',
      'Biología Humana',
      'si',
      'lun',
      'ciclo',
    ],
    [
      'Reunion de coordinacion',
      '',
      'REUNION',
      '2026-03-04',
      '13:00',
      '14:00',
      'admin',
      '',
      '',
      '',
      'no',
      '',
      '',
    ],
  ]
  return [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\n')
}

function parseCsvRows(text: string): Record<string, string>[] {
  const cleaned = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const firstLine = cleaned.split('\n')[0] ?? ''
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i]
    const next = cleaned[i + 1]
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === delimiter && !inQuotes) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' && !inQuotes) {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  const [headersRaw, ...dataRows] = rows.filter((r) => r.some((v) => v.trim() !== ''))
  if (!headersRaw) return []
  const headers = headersRaw.map((h) => h.trim())
  return dataRows
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) =>
      headers.reduce<Record<string, string>>((acc, header, index) => {
        acc[header] = (r[index] ?? '').trim()
        return acc
      }, {}),
    )
}

/** Horas 00–23 (formato 24 h civil; no AM/PM). */
const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES_60 = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))
const WEEKDAY_OPTIONS = [
  { value: 0, short: 'Dom', long: 'Domingo' },
  { value: 1, short: 'Lun', long: 'Lunes' },
  { value: 2, short: 'Mar', long: 'Martes' },
  { value: 3, short: 'Mié', long: 'Miércoles' },
  { value: 4, short: 'Jue', long: 'Jueves' },
  { value: 5, short: 'Vie', long: 'Viernes' },
  { value: 6, short: 'Sáb', long: 'Sábado' },
] as const
const WEEKDAY_SHORT_BY_VALUE = new Map(WEEKDAY_OPTIONS.map((d) => [d.value, d.short]))
type WeekdayValue = (typeof WEEKDAY_OPTIONS)[number]['value']

function formatWeekdayList(days: number[]): string {
  const sorted = uniqueSortedDays(days)
  if (sorted.length === 0) return 'Sin días definidos'
  if (sorted.length === 7) return 'Todos los días'
  return sorted.map((d) => WEEKDAY_SHORT_BY_VALUE.get(d as 0 | 1 | 2 | 3 | 4 | 5 | 6) ?? String(d)).join(', ')
}

function formatEventTimeRange(event: Pick<Event, 'startTime' | 'endTime'>): string {
  const start = event.startTime ? formatClockHhMmInUruguayFromIso(event.startTime) : 'Sin inicio'
  const end = event.endTime ? formatClockHhMmInUruguayFromIso(event.endTime) : 'sin fin'
  return `${start}-${end}`
}

function formatEventRecurrenceLabel(event: Pick<Event, 'isRecurring' | 'recurrenceType' | 'recurrenceEnd'>): string {
  if (!event.isRecurring || event.recurrenceType === 'NONE') return 'Evento único'
  const type =
    event.recurrenceType === 'DAILY'
      ? 'Diario'
      : event.recurrenceType === 'MONTHLY'
        ? 'Mensual'
        : 'Semanal'
  const end = event.recurrenceEnd ? `hasta ${formatDateInUruguay(event.recurrenceEnd)}` : 'hasta cierre del ciclo'
  return `${type}, ${end}`
}

function formatEventScheduleSummary(event: Pick<Event, 'isRecurring' | 'recurrenceType' | 'daysOfWeek' | 'startDate' | 'startTime' | 'endTime' | 'recurrenceEnd'>): string {
  return `${formatWeekdayList(eventAssignedWeekdays(event))} · ${formatEventTimeRange(event)} · ${formatEventRecurrenceLabel(event)}`
}

/** Etiqueta corta de un día para las tarjetas: "Hoy" / "Mañana" / "Mié". */
function dayLabelForOffset(ymd: string, offset: number): string {
  if (offset === 0) return 'Hoy'
  if (offset === 1) return 'Mañana'
  const wd = weekdayNumberInUruguay(ymd)
  return wd === null ? '' : WEEKDAY_SHORT_BY_VALUE.get(wd as 0 | 1 | 2 | 3 | 4 | 5 | 6) ?? ''
}

/** Resumen de los próximos 7 días (desde hoy), con las actividades reales de cada fecha. */
function buildNext7DaysSummary(events: Event[], todayYmd: string) {
  return Array.from({ length: 7 }, (_, offset) => {
    const ymd = addDaysToYmd(todayYmd, offset)
    const dayEvents = getEventsForYmd(events, ymd)
    const visible = dayEvents.slice(0, 3).map((event) => ({
      id: event.id,
      title: event.title,
      time: formatEventTimeRange(event),
      assigned: getEventAssignedDisplay(event),
    }))
    return {
      ymd,
      dayLabel: dayLabelForOffset(ymd, offset),
      dateLabel: `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`,
      count: dayEvents.length,
      visible,
      hiddenCount: Math.max(dayEvents.length - visible.length, 0),
    }
  })
}

function getEventAssignedDisplay(event: Pick<Event, 'assignedUser'>): string {
  return event.assignedUser?.username || event.assignedUser?.name || 'Sin asignar'
}

function getEventAcademicSummary(event: Pick<Event, 'course' | 'subject' | 'orientation'>): string {
  const parts = [event.course?.name, event.orientation?.name, event.subject?.name].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'Sin curso ni asignatura'
}

function parseHhMm(value: string): { h: string; m: string } {
  if (!value || typeof value !== 'string') return { h: '09', m: '00' }
  const t = value.trim()
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t)
  if (!match) return { h: '09', m: '00' }
  return { h: match[1].padStart(2, '0'), m: match[2].padStart(2, '0') }
}

function AdminTime24Selects({
  label,
  value,
  onChange,
  idPrefix,
}: {
  label: string
  value: string
  onChange: (hhmm: string) => void
  idPrefix: string
}) {
  const { h, m } = parseHhMm(value || '09:00')
  return (
    <div>
      <span className="block text-sm font-medium text-gray-700 mb-1">{label} (24 h)</span>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${idPrefix}-h`} className="sr-only">
          {label} horas
        </label>
        <select
          id={`${idPrefix}-h`}
          data-testid={`${idPrefix}-h`}
          className="w-[5.5rem] border border-gray-300 rounded px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          value={h}
          onChange={(e) => {
            const nh = e.target.value.padStart(2, '0')
            onChange(`${nh}:${m}`)
          }}
        >
          {HOURS_24.map((hour) => (
            <option key={hour} value={hour}>
              {hour}
            </option>
          ))}
        </select>
        <span className="text-lg font-semibold leading-none text-gray-500">:</span>
        <label htmlFor={`${idPrefix}-m`} className="sr-only">
          {label} minutos
        </label>
        <select
          id={`${idPrefix}-m`}
          data-testid={`${idPrefix}-m`}
          className="w-[5.5rem] border border-gray-300 rounded px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          value={m}
          onChange={(e) => {
            const nm = e.target.value.padStart(2, '0')
            onChange(`${h}:${nm}`)
          }}
        >
          {MINUTES_60.map((min) => (
            <option key={min} value={min}>
              {min}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function renderEventsEmptyState(events: Event[]) {
  if (events.length === 0) {
    return <div className="p-4 text-center text-gray-500 sm:p-6">No hay actividades</div>
  }

  return null
}

function getEventDateInputValue(value?: string | null) {
  return value ? value.split('T')[0] : ''
}

function getEventEndDateInputValue(event: Event) {
  return getEventDateInputValue(event.endDate) || getEventDateInputValue(event.startDate)
}

function eventScheduleKey(startDate: string, startTime?: string | null): string {
  return `${getEventDateInputValue(startDate)}|${formatClockHhMmInUruguayFromIso(startTime ?? undefined)}`
}

function OccurrenceActionModal({
  occ,
  busy,
  onClose,
  onSuspend,
  onRestore,
  onSaveTimes,
  onEditSeries,
}: {
  occ: EventOccurrence<CalendarEvent>
  busy: boolean
  onClose: () => void
  onSuspend: (reason: string) => void
  onRestore: () => void
  onSaveTimes: (startTime: string, endTime: string) => void
  onEditSeries: () => void
}) {
  const [editingTimes, setEditingTimes] = useState(false)
  const [startTime, setStartTime] = useState(occ.startTime ? formatClockHhMmInUruguayFromIso(occ.startTime) : '09:00')
  const [endTime, setEndTime] = useState(occ.endTime ? formatClockHhMmInUruguayFromIso(occ.endTime) : '10:00')
  const dateLabel = `${occ.ymd.slice(8, 10)}/${occ.ymd.slice(5, 7)}/${occ.ymd.slice(0, 4)}`
  const stateLabel = occ.suspended ? ' · Suspendida' : occ.overridden ? ' · Modificada' : ''

  return (
    <div
      className="fixed inset-0 z-[2147483646] flex items-end justify-center bg-black/60 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-gray-900">{occ.title}</h3>
            <p className="text-sm text-gray-500">
              {dateLabel}
              {stateLabel}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-600" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {editingTimes ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-gray-700">
                Inicio
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="input-field mt-1" />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Fin
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="input-field mt-1" />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onSaveTimes(startTime, endTime)}
                className="btn-primary flex-1 disabled:opacity-60"
              >
                Guardar solo este día
              </button>
              <button type="button" onClick={() => setEditingTimes(false)} className="btn-secondary">
                Volver
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {!occ.suspended && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onSuspend('')}
                className="w-full rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                Suspender solo este día
              </button>
            )}
            {!occ.suspended && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditingTimes(true)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Editar horario solo este día
              </button>
            )}
            {(occ.suspended || occ.overridden) && (
              <button
                type="button"
                disabled={busy}
                onClick={onRestore}
                className="w-full rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
              >
                Restaurar este día (quitar excepción)
              </button>
            )}
            <button
              type="button"
              onClick={onEditSeries}
              className="w-full rounded-lg border border-indigo-200 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
            >
              Editar la serie completa
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AdminEvents() {
  const syCtx = useOptionalAdminSchoolYear()
  const schoolYearQuery = syCtx?.schoolYearQuery ?? ''
  /** Cursos/asignaturas: siempre un solo ciclo (evita EMS1-ARTE-2020, 2024, 2025… en el combo). */
  const coursePickerQuery = syCtx?.schoolYearScopedQuery ?? schoolYearQuery

  const [events, setEvents] = useState<Event[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [courses, setCourses] = useState<CourseOpt[]>([])
  const [createOrientations, setCreateOrientations] = useState<CourseOrientationOpt[]>([])
  const [editOrientations, setEditOrientations] = useState<CourseOrientationOpt[]>([])
  const [createSubjects, setCreateSubjects] = useState<SubjectOpt[]>([])
  const [editSubjects, setEditSubjects] = useState<SubjectOpt[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingEvent, setEditingEvent] = useState<Event | null>(null)
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    userId: '',
    assignedUserId: '',
    courseId: '',
    type: '',
    status: ''
  })
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [message, setMessage] = useState('')
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([])
  const [deletingSelected, setDeletingSelected] = useState(false)
  const [importingEvents, setImportingEvents] = useState(false)
  const [importErrors, setImportErrors] = useState<EventImportError[]>([])
  const importInputRef = useRef<HTMLInputElement | null>(null)
  /** Errores del formulario "Crear evento" (se muestran dentro del modal). */
  const [createModalError, setCreateModalError] = useState('')
  /** Clave fecha|hora de inicio al abrir edición (detectar si se movió al pasado). */
  const [editingEventScheduleSnapshot, setEditingEventScheduleSnapshot] = useState<string | null>(null)
  const [editModalError, setEditModalError] = useState('')

  const [recurrenceRangeMode, setRecurrenceRangeMode] = useState<RecurrenceRangeMode>('school_year')
  const activeSchoolYear = resolveAdminSchoolYearForEvents(syCtx ?? null)

  const [newEvent, setNewEvent] = useState<EditableEvent>({
    title: '',
    description: '',
    type: 'JORNADA_LABORAL',
    startDate: getTodayYmdInUruguay(),
    startTime: '09:00',
    endTime: '10:00',
    assignedUserId: '',
    courseId: '',
    orientationId: '',
    courseOrientationId: '',
    subjectId: '',
    recurrenceType: 'NONE',
    isRecurring: false,
    daysOfWeek: [],
    recurrenceEnd: ''
  })
  
  const [selectedRole, setSelectedRole] = useState<RoleOption>('')
  const [portalReady, setPortalReady] = useState(false)
  const [substitutionEvent, setSubstitutionEvent] = useState<SubstitutionModalEvent | null>(null)
  const [substitutionKeys, setSubstitutionKeys] = useState<Set<string>>(new Set())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [calendarEvents, setCalendarEvents] = useState<Event[]>([])
  const [nonWorkingYmds, setNonWorkingYmds] = useState<Set<string>>(new Set())
  const [occurrencePanel, setOccurrencePanel] = useState<EventOccurrence<CalendarEvent> | null>(null)
  const [occurrenceBusy, setOccurrenceBusy] = useState(false)
  // Vista rápida: próximos 7 días con sus actividades reales (resuelve recurrencias, sin vencidos).
  const next7Days = buildNext7DaysSummary(events, getTodayYmdInUruguay())
  const activeFilterCount = Object.values(filters).filter((value) => value).length
  const selectedDaySummary = selectedDate === null ? null : next7Days.find((day) => day.ymd === selectedDate) ?? null
  const selectedDayEvents = selectedDate === null ? [] : getEventsForYmd(events, selectedDate)

  useEffect(() => {
    loadEvents()
    loadUsers()
    void loadSubstitutionFlags()
  }, [page, filters, syCtx?.allYears, syCtx?.schoolYearQuery])

  async function loadSubstitutionFlags() {
    try {
      const from = filters.startDate || getTodayYmdInUruguay()
      const to = filters.endDate || from
      const res = await api<SubstitutionListResponse>(
        `/substitutions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&pageSize=100`,
      )
      const keys = new Set(
        res.data.map((s) => {
          const day = String(s.date).slice(0, 10)
          return `${s.eventId}|${day}`
        }),
      )
      setSubstitutionKeys(keys)
    } catch {
      setSubstitutionKeys(new Set())
    }
  }

  const loadCourses = useCallback(async () => {
    try {
      const c = await api<CourseOpt[]>(withSchoolYear('/courses', coursePickerQuery))
      setCourses(Array.isArray(c) ? c : [])
    } catch {
      setCourses([])
    }
  }, [coursePickerQuery])

  useEffect(() => {
    void loadCourses()
  }, [loadCourses])

  useEffect(() => {
    setPortalReady(true)
  }, [])

  useEffect(() => {
    setSelectedEventIds([])
  }, [events])

  useEffect(() => {
    if (!creating || !newEvent.courseId) {
      setCreateOrientations([])
      setCreateSubjects([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const orientationPath = `/courses/${newEvent.courseId}/orientations`
        const subjectPath = newEvent.orientationId
          ? `/courses/${newEvent.courseId}/subjects?orientationId=${encodeURIComponent(newEvent.orientationId)}`
          : `/courses/${newEvent.courseId}/subjects`
        const [orientationList, subjectList] = await Promise.all([
          api<CourseOrientationOpt[]>(withSchoolYear(orientationPath, coursePickerQuery)),
          api<SubjectOpt[]>(withSchoolYear(subjectPath, coursePickerQuery)),
        ])
        if (!cancelled) {
          setCreateOrientations(Array.isArray(orientationList) ? orientationList : [])
          setCreateSubjects(Array.isArray(subjectList) ? subjectList : [])
        }
      } catch {
        if (!cancelled) {
          setCreateOrientations([])
          setCreateSubjects([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [creating, newEvent.courseId, newEvent.orientationId, coursePickerQuery])

  useEffect(() => {
    if (!editingEvent?.courseId) {
      setEditOrientations([])
      setEditSubjects([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const orientationPath = `/courses/${editingEvent.courseId}/orientations`
        const subjectPath = editingEvent.orientationId
          ? `/courses/${editingEvent.courseId}/subjects?orientationId=${encodeURIComponent(editingEvent.orientationId)}`
          : `/courses/${editingEvent.courseId}/subjects`
        const [orientationList, subjectList] = await Promise.all([
          api<CourseOrientationOpt[]>(withSchoolYear(orientationPath, coursePickerQuery)),
          api<SubjectOpt[]>(withSchoolYear(subjectPath, coursePickerQuery)),
        ])
        if (!cancelled) {
          setEditOrientations(Array.isArray(orientationList) ? orientationList : [])
          setEditSubjects(Array.isArray(subjectList) ? subjectList : [])
        }
      } catch {
        if (!cancelled) {
          setEditOrientations([])
          setEditSubjects([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [editingEvent?.courseId, editingEvent?.orientationId, coursePickerQuery])

  async function loadEvents() {
    setLoading(true)
    try {
      const qs = buildAdminEventsAllQueryString(page, filters, {
        allYears: syCtx?.allYears,
        schoolYearId:
          syCtx && !syCtx.allYears ? syCtx.selectedId ?? syCtx.activeId ?? undefined : undefined,
      })
      const data = await api<{
        total: number
        page: number
        pageSize: number
        data: Event[]
      }>(`/events/all?${qs}`)
      
      setEvents(data.data)
      setTotal(data.total)
    } catch (error) {
      console.error('Error cargando eventos:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadUsers() {
    try {
      const data = await api<{
        data: User[]
      }>('/admin/users?pageSize=100')
      setUsers(data.data)
    } catch (error) {
      console.error('Error cargando usuarios:', error)
    }
  }

  const schoolYearScopeParams = useCallback(() => {
    const params = new URLSearchParams()
    if (syCtx?.allYears) params.set('allYears', '1')
    else {
      const syId = syCtx?.selectedId ?? syCtx?.activeId
      if (syId) params.set('schoolYearId', syId)
    }
    return params
  }, [syCtx?.allYears, syCtx?.selectedId, syCtx?.activeId])

  // El calendario necesita TODOS los eventos del ciclo (no una página): se piden crudos (sin rango
  // → el server no expande) y se expanden en el cliente con sus excepciones por día.
  const loadCalendarEvents = useCallback(async () => {
    try {
      const all: Event[] = []
      for (let p = 1; p <= 20; p++) {
        const params = schoolYearScopeParams()
        params.set('page', String(p))
        params.set('pageSize', '100')
        const data = await api<{ total: number; data: Event[] }>(`/events/all?${params.toString()}`)
        all.push(...data.data)
        if (data.data.length === 0 || all.length >= data.total) break
      }
      setCalendarEvents(all)
    } catch (error) {
      console.error('Error cargando eventos del calendario:', error)
    }
  }, [schoolYearScopeParams])

  const loadNonWorkingDays = useCallback(async () => {
    try {
      const year = Number(getTodayYmdInUruguay().slice(0, 4))
      const rows = await api<Array<{ date: string }>>(
        `/non-working-days?from=${year}-01-01&to=${year + 1}-12-31`,
      )
      setNonWorkingYmds(new Set((Array.isArray(rows) ? rows : []).map((r) => String(r.date).slice(0, 10))))
    } catch {
      setNonWorkingYmds(new Set())
    }
  }, [])

  useEffect(() => {
    if (view !== 'calendar') return
    void loadCalendarEvents()
    void loadNonWorkingDays()
  }, [view, loadCalendarEvents, loadNonWorkingDays])

  async function suspendOccurrence(reason: string) {
    if (!occurrencePanel) return
    setOccurrenceBusy(true)
    try {
      await api(`/events/${occurrencePanel.event.id}/occurrences/${occurrencePanel.ymd}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
      setMessage('✅ Día suspendido')
      setOccurrencePanel(null)
      await loadCalendarEvents()
    } catch (e) {
      setMessage(getApiErrorDetail(e))
    } finally {
      setOccurrenceBusy(false)
    }
  }

  async function restoreOccurrence() {
    if (!occurrencePanel) return
    setOccurrenceBusy(true)
    try {
      await api(`/events/${occurrencePanel.event.id}/occurrences/${occurrencePanel.ymd}`, { method: 'DELETE' })
      setMessage('✅ Se quitó la excepción de ese día')
      setOccurrencePanel(null)
      await loadCalendarEvents()
    } catch (e) {
      setMessage(getApiErrorDetail(e))
    } finally {
      setOccurrenceBusy(false)
    }
  }

  async function saveOccurrenceTimes(startTime: string, endTime: string) {
    if (!occurrencePanel) return
    setOccurrenceBusy(true)
    try {
      await api(`/events/${occurrencePanel.event.id}/occurrences/${occurrencePanel.ymd}`, {
        method: 'PUT',
        body: JSON.stringify({ startTime, endTime }),
      })
      setMessage('✅ Ocurrencia actualizada solo para ese día')
      setOccurrencePanel(null)
      await loadCalendarEvents()
    } catch (e) {
      setMessage(getApiErrorDetail(e))
    } finally {
      setOccurrenceBusy(false)
    }
  }

  function resetCreateForm() {
    setSelectedRole('')
    setCreateModalError('')
    setRecurrenceRangeMode('school_year')
    setNewEvent({
      title: '',
      description: '',
      type: 'JORNADA_LABORAL',
      startDate: getTodayYmdInUruguay(),
      startTime: '09:00',
      endTime: '10:00',
      assignedUserId: '',
      courseId: '',
      orientationId: '',
      courseOrientationId: '',
      subjectId: '',
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
      recurrenceEnd: ''
    })
  }

  function closeCreateModal() {
    setCreating(false)
    resetCreateForm()
  }

  function openEditEvent(event: Event) {
    setEditModalError('')
    setEditingEventScheduleSnapshot(eventScheduleKey(event.startDate, event.startTime))
    setEditingEvent(event)
  }

  function closeEditModal() {
    setEditingEvent(null)
    setEditingEventScheduleSnapshot(null)
    setEditModalError('')
  }

  const createMinStartDateYmd = getTodayYmdInUruguay()
  const editMinStartDateYmd =
    editingEventScheduleSnapshot &&
    isUruguayWallDateTimeInPast(
      editingEventScheduleSnapshot.split('|')[0] ?? '',
      editingEventScheduleSnapshot.split('|')[1] ?? '00:00',
    )
      ? undefined
      : getTodayYmdInUruguay()

  function validateEditEventBeforeSubmit(event: Event): string | null {
    const startYmd = getEventDateInputValue(event.startDate)
    const startHhmm = formatClockHhMmInUruguayFromIso(event.startTime)
    const endHhmm = formatClockHhMmInUruguayFromIso(event.endTime)
    const startM = timeStringToMinutes(startHhmm)
    const endM = timeStringToMinutes(endHhmm)
    if (!startYmd) return 'Indicá la fecha del evento.'
    if (startM === null || endM === null) return 'Formato de hora inválido (usa HH:MM).'
    if (endM <= startM) {
      return 'La hora de fin debe ser mayor que la de inicio.'
    }
    const scheduleKey = eventScheduleKey(event.startDate, event.startTime)
    const scheduleChanged = editingEventScheduleSnapshot != null && scheduleKey !== editingEventScheduleSnapshot
    if (scheduleChanged && isUruguayWallDateTimeInPast(startYmd, startHhmm)) {
      return 'No se puede mover un evento al pasado. Elegí una fecha y hora de inicio actuales o futuras.'
    }
    return null
  }

  function validateNewEventBeforeSubmit(): string | null {
    if (!newEvent.title.trim()) return 'El título es obligatorio.'
    if (!selectedRole) return 'Selecciona el rol del usuario.'
    if (!newEvent.startTime || !newEvent.endTime) return 'Indica hora de inicio y hora de fin.'
    const startM = timeStringToMinutes(newEvent.startTime)
    const endM = timeStringToMinutes(newEvent.endTime)
    if (startM === null || endM === null) return 'Formato de hora inválido (usa HH:MM).'
    if (endM <= startM) {
      return 'La hora de fin debe ser mayor que la de inicio. Muy común: elegir “12:11 AM” para el fin (eso es 00:11 de la madrugada, antes que las 11:11 de la mañana). Para terminar a las 12:11 del mediodía usá 12:11 en 24 h o “12:11 PM”.'
    }
    if (!newEvent.startDate.trim()) return 'Indicá la fecha del evento.'
    if (isUruguayWallDateTimeInPast(newEvent.startDate, newEvent.startTime)) {
      return 'No se pueden crear eventos en el pasado. Elegí una fecha y hora de inicio actuales o futuras.'
    }
    if (newEvent.isRecurring) {
      const endYmd =
        recurrenceRangeMode === 'school_year' ? null : newEvent.recurrenceEnd?.trim() || null
      if (!endYmd) {
        if (recurrenceRangeMode === 'school_year') {
          if (!activeSchoolYear || activeSchoolYear.status === 'CLOSED') {
            return 'Para repetir hasta cierre manual del ciclo, elegí un ciclo lectivo abierto en la barra superior.'
          }
        } else {
          return 'Los eventos repetitivos requieren fecha de fin de recurrencia.'
        }
      }
      if (endYmd && endYmd < newEvent.startDate) {
        return 'La fecha de fin de recurrencia debe ser igual o posterior a la fecha de inicio.'
      }
      if (endYmd && endYmd < getTodayYmdInUruguay()) {
        return 'La fecha de fin de repetición ya pasó. Elegí una fecha futura.'
      }
      if (newEvent.daysOfWeek.length === 0) {
        return 'Seleccioná al menos un día de la semana para la repetición.'
      }
    }
    return null
  }

  async function createEvent() {
    setMessage('')
    setCreateModalError('')
    const localErr = validateNewEventBeforeSubmit()
    if (localErr) {
      setCreateModalError(localErr)
      return
    }
    try {
      const eventData: Record<string, unknown> = {
        title: newEvent.title.trim(),
        description: newEvent.description?.trim() || undefined,
        type: newEvent.type,
        startDate: newEvent.startDate,
        startTime: newEvent.startTime,
        endTime: newEvent.endTime,
        isRecurring: newEvent.isRecurring,
        recurrenceType: newEvent.isRecurring ? 'WEEKLY' : 'NONE',
        daysOfWeek: newEvent.isRecurring ? newEvent.daysOfWeek.map((d) => Number(d)) : [],
        recurrenceEnd: newEvent.isRecurring
          ? recurrenceRangeMode === 'school_year'
            ? null
            : newEvent.recurrenceEnd || null
          : null,
      }
      if (newEvent.assignedUserId) {
        eventData.assignedUserId = newEvent.assignedUserId
      }
      if (newEvent.courseId) {
        eventData.courseId = newEvent.courseId
      }
      if (newEvent.orientationId) {
        eventData.orientationId = newEvent.orientationId
      }
      if (newEvent.courseOrientationId) {
        eventData.courseOrientationId = newEvent.courseOrientationId
      }
      if (newEvent.subjectId) {
        eventData.subjectId = newEvent.subjectId
      }

      const created = await api<{ warning?: string }>(withSchoolYear('/events/', coursePickerQuery), {
        method: 'POST',
        body: JSON.stringify(eventData),
      })

      setMessage(created?.warning ? `✅ Actividad creada. ⚠️ ${created.warning}` : '✅ Actividad creada correctamente')
      await loadEvents()
      setCreating(false)
      resetCreateForm()
    } catch (error: unknown) {
      setCreateModalError(getApiErrorDetail(error))
    }
  }

  async function updateEvent(id: string, updates: Partial<Event>) {
    setEditModalError('')
    const localErr = validateEditEventBeforeSubmit(updates as Event)
    if (localErr) {
      setEditModalError(localErr)
      return
    }
    try {
      await api(withSchoolYear(`/events/${id}`, coursePickerQuery), {
        method: 'PUT',
        body: JSON.stringify(updates)
      })
      
      setMessage('✅ Actividad actualizada correctamente')
      await loadEvents()
      closeEditModal()
    } catch (error: any) {
      setEditModalError(getApiErrorDetail(error))
    }
  }

  async function cancelEvent(id: string, reason?: string) {
    try {
      await api(`/events/${id}/cancel`, {
        method: 'PUT',
        body: JSON.stringify({ reason })
      })
      
      setMessage('✅ Actividad cancelada correctamente')
      await loadEvents()
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al cancelar evento'}`)
    }
  }

  async function reactivateEvent(id: string) {
    try {
      await api(`/events/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'SCHEDULED' })
      })
      
      setMessage('✅ Actividad reactivada correctamente')
      await loadEvents()
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al reactivar evento'}`)
    }
  }

  async function deleteSelectedEvents() {
    if (selectedEventIds.length === 0) return
    if (!confirm(`¿Estás seguro de eliminar ${selectedEventIds.length} eventos seleccionados?`)) return

    setDeletingSelected(true)
    setMessage('')
    try {
      await Promise.all(selectedEventIds.map((id) => api(`/events/${id}`, { method: 'DELETE' })))
      setMessage(`✅ Se eliminaron ${selectedEventIds.length} eventos seleccionados`)
      setSelectedEventIds([])
      await loadEvents()
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al eliminar eventos seleccionados'}`)
    } finally {
      setDeletingSelected(false)
    }
  }

  function downloadImportTemplate() {
    const blob = new Blob([`\uFEFF${buildEventImportTemplate()}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'plantilla_importacion_eventos.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function importEventsFromFile(file: File) {
    setMessage('')
    setImportErrors([])
    setImportingEvents(true)
    try {
      const rows = parseCsvRows(await file.text())
      if (rows.length === 0) {
        setMessage('❌ El CSV no tiene filas para importar.')
        return
      }
      const result = await api<EventImportResponse>(withSchoolYear('/events/import', coursePickerQuery), {
        method: 'POST',
        body: JSON.stringify({ rows }),
      })
      setMessage(`✅ Se importaron ${result.createdCount} eventos correctamente`)
      await loadEvents()
    } catch (error: unknown) {
      const data = (error as { data?: { errors?: EventImportError[] } }).data
      const errors = Array.isArray(data?.errors) ? data.errors : []
      setImportErrors(errors)
      setMessage(errors.length > 0 ? '❌ No se importó ningún evento. Revisá las filas marcadas.' : `❌ ${getApiErrorDetail(error)}`)
    } finally {
      setImportingEvents(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  function toggleEventSelection(id: string) {
    setSelectedEventIds((prev) =>
      prev.includes(id) ? prev.filter((currentId) => currentId !== id) : [...prev, id],
    )
  }

  function toggleAllEventsSelection() {
    setSelectedEventIds((prev) => (prev.length === events.length ? [] : events.map((event) => event.id)))
  }

  return (
    <RoleGuard permission="events.read" permissionScope="all">
      <main className="responsive-page max-w-[1600px] space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <Calendar className="h-7 w-7 text-emerald-600" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Agenda y clases</h1>
              <p className="text-gray-600">Organizá clases, jornadas, reuniones y suplencias.</p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={downloadImportTemplate}
              className="inline-flex items-center justify-center gap-2 rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Download className="h-4 w-4" aria-hidden />
              Descargar formato
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={importingEvents}
              className="inline-flex items-center justify-center gap-2 rounded border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Upload className="h-4 w-4" aria-hidden />
              {importingEvents ? 'Importando...' : 'Importar CSV'}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void importEventsFromFile(file)
              }}
            />
            <button
              onClick={() => {
                setMessage('')
                setImportErrors([])
                setCreateModalError('')
                setCreating(true)
              }}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Nueva actividad
            </button>
            <div className="text-sm text-gray-600">
              {total} actividades
            </div>
          </div>
        </div>

        {/* Filtros */}
        <div className="bg-white border rounded-lg p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Buscar en agenda</h2>
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                  {activeFilterCount} filtro{activeFilterCount > 1 ? 's' : ''} activo{activeFilterCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <button
              onClick={() => setFilters({
                startDate: '',
                endDate: '',
                userId: '',
                assignedUserId: '',
                courseId: '',
                type: '',
                status: ''
              })}
              disabled={activeFilterCount === 0}
              className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded border disabled:cursor-not-allowed disabled:opacity-50"
            >
              Limpiar filtros
            </button>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500">Atajos:</span>
            <button
              type="button"
              onClick={() => setFilters({ ...filters, type: 'CLASE' })}
              className="rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Solo clases
            </button>
            <button
              type="button"
              onClick={() =>
                setFilters({
                  ...filters,
                  startDate: getTodayYmdInUruguay(),
                  endDate: addDaysToYmd(getTodayYmdInUruguay(), 7),
                })
              }
              className="rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Próximos 7 días
            </button>
            <button
              type="button"
              onClick={() => setFilters({ ...filters, status: 'SCHEDULED' })}
              className="rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Solo programados
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
            <DateRangeFields
              startDate={filters.startDate}
              endDate={filters.endDate}
              onStartDateChange={(value) => setFilters({ ...filters, startDate: value })}
              onEndDateChange={(value) => setFilters({ ...filters, endDate: value })}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Creador</label>
              <select
                value={filters.userId}
                onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">Todos</option>
                {users.filter(user => user.role === 'ADMIN').map(user => (
                  <option key={user.id} value={user.id}>{user.username || user.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Asignado</label>
              <select
                value={filters.assignedUserId}
                onChange={(e) => setFilters({ ...filters, assignedUserId: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">Todos</option>
                {users.map(user => (
                  <option key={user.id} value={user.id}>{user.username || user.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Curso</label>
              <select
                value={filters.courseId}
                onChange={(e) => setFilters({ ...filters, courseId: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">Todos</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code ? `${c.code} — ${c.name}` : c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
              <select
                value={filters.type}
                onChange={(e) => setFilters({ ...filters, type: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">Todos</option>
                {ADMIN_EVENT_TYPE_SELECT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">Todos</option>
                <option value="SCHEDULED">Programado</option>
                <option value="IN_PROGRESS">En curso</option>
                <option value="COMPLETED">Completado</option>
                <option value="CANCELLED">Cancelado</option>
                <option value="EXPIRED">Vencido</option>
              </select>
            </div>
          </div>
        </div>

        {/* Oculto si hay modal abierto: si no, el aviso se ve “detrás” del overlay y parece que no se actualizó nada */}
        {message && !creating && !editingEvent && (
          <div className={`p-3 rounded ${getAdminFlashMessageClass(message)}`}>
            {message}
          </div>
        )}
        {importErrors.length > 0 && !creating && !editingEvent ? (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <div className="font-semibold">Errores de importación</div>
            <ul className="mt-2 space-y-1">
              {importErrors.slice(0, 12).map((err) => (
                <li key={`${err.row}-${err.message}`}>Fila {err.row}: {err.message}</li>
              ))}
            </ul>
            {importErrors.length > 12 ? (
              <div className="mt-2 text-red-800">Hay {importErrors.length - 12} errores más.</div>
            ) : null}
          </div>
        ) : null}

        {/* Selector de vista */}
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-sm">
          {(['list', 'calendar'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-4 py-1.5 font-medium ${
                view === v ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {v === 'list' ? 'Lista' : 'Calendario'}
            </button>
          ))}
        </div>

        {view === 'calendar' && (
          <EventsCalendar
            events={calendarEvents as unknown as CalendarEvent[]}
            nonWorkingYmds={nonWorkingYmds}
            onSelectOccurrence={(occ) => setOccurrencePanel(occ)}
          />
        )}

        {/* Tabla de eventos */}
        {view === 'list' && (
        <div className="bg-white border rounded-lg shadow-sm">
          <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between sm:p-6">
            <h2 className="text-lg font-semibold">Actividades programadas</h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-gray-500">
                {selectedEventIds.length === 0
                  ? 'Seleccioná actividades para eliminarlas'
                  : `${selectedEventIds.length} seleccionados`}
              </span>
              <button
                type="button"
                onClick={deleteSelectedEvents}
                disabled={selectedEventIds.length === 0 || deletingSelected}
                className="inline-flex items-center rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingSelected ? 'Eliminando…' : 'Eliminar seleccionadas'}
              </button>
            </div>
          </div>
          {!loading && events.length > 0 ? (
            <div className="border-b bg-slate-50 px-4 py-4 sm:px-6">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Próximos 7 días</h3>
                  <p className="text-xs text-slate-500">
                    Actividades de los próximos 7 días (resuelve las recurrencias; no muestra eventos vencidos).
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
                {next7Days.map((day) => (
                  <button
                    key={day.ymd}
                    type="button"
                    onClick={() => setSelectedDate(day.ymd)}
                    aria-pressed={selectedDate === day.ymd}
                    className={`min-h-[6.5rem] rounded border px-3 py-2 text-left transition hover:border-emerald-300 hover:bg-emerald-50/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                      selectedDate === day.ymd
                        ? 'border-emerald-500 bg-emerald-50 shadow-sm'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 text-sm font-semibold text-slate-900">
                        {day.dayLabel} <span className="font-normal text-slate-500">{day.dateLabel}</span>
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {day.count}
                      </span>
                    </div>
                    {day.visible.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {day.visible.map((event) => (
                          <li key={`${day.ymd}-${event.id}`} className="min-w-0 text-xs text-slate-600">
                            <span className="block truncate font-medium text-slate-800">{event.title}</span>
                            <span className="block truncate">{event.time} · {event.assigned}</span>
                          </li>
                        ))}
                        {day.hiddenCount > 0 ? (
                          <li className="text-xs font-medium text-slate-500">+{day.hiddenCount} más</li>
                        ) : null}
                      </ul>
                    ) : (
                      <div className="mt-2 text-xs text-slate-400">Sin actividades</div>
                    )}
                  </button>
                ))}
              </div>
              {selectedDaySummary ? (
                <div
                  className="mt-4 rounded border border-slate-200 bg-white"
                  role="region"
                  aria-label={`Actividades del ${selectedDaySummary.dayLabel} ${selectedDaySummary.dateLabel}`}
                >
                  <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {selectedDaySummary.dayLabel} {selectedDaySummary.dateLabel}
                        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          {selectedDayEvents.length}
                        </span>
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedDate(null)}
                      className="self-start rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 sm:self-auto"
                    >
                      Cerrar
                    </button>
                  </div>
                  {selectedDayEvents.length > 0 ? (
                    <div className="max-h-[22rem] overflow-y-auto">
                      <ul className="divide-y divide-slate-100">
                        {selectedDayEvents.map((event) => (
                          <li key={`${selectedDaySummary.ymd}-${event.id}`} className="px-4 py-3">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-800">
                                    {formatEventTimeRange(event)}
                                  </span>
                                  <span className={`rounded px-2 py-1 text-xs font-medium ${getAdminEventStatusStyle(event.status)}`}>
                                    {getAdminEventStatusLabel(event.status)}
                                  </span>
                                  <span className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800">
                                    {getAdminEventTypeLabel(event.type)}
                                  </span>
                                </div>
                                <div>
                                  <div className="font-medium text-slate-900">{event.title}</div>
                                  <div className="mt-1 text-xs text-slate-500">{formatEventRecurrenceLabel(event)}</div>
                                </div>
                                <div className="text-sm text-slate-700">{getEventAcademicSummary(event)}</div>
                                <div className="text-xs text-slate-500">
                                  {getEventAssignedDisplay(event)} · {event.location || 'Sin ubicación'} · {event._count.attendances} asist.
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => openEditEvent(event)}
                                className="inline-flex w-fit items-center rounded border border-indigo-200 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
                              >
                                Editar
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="px-4 py-5 text-sm text-slate-500">Sin actividades para este día.</div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
          
          {loading ? (
            <div className="p-4 text-center text-gray-500 sm:p-6">Cargando agenda…</div>
          ) : renderEventsEmptyState(events) || (
            <>
            {/* Mobile: tarjetas (evita el scroll horizontal de la tabla) */}
            <ul className="divide-y divide-gray-100 sm:hidden">
              {events.map((event) => (
                <li key={event.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="break-words font-medium text-gray-900">{event.title}</div>
                      <div className="text-xs text-gray-500">
                        {formatEventTimeRange(event)} · {formatEventRecurrenceLabel(event)}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={selectedEventIds.includes(event.id)}
                      onChange={() => toggleEventSelection(event.id)}
                      aria-label={`Seleccionar actividad ${event.title}`}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                      {getAdminEventTypeLabel(event.type)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getAdminEventStatusStyle(event.status)}`}>
                      {getAdminEventStatusLabel(event.status)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600">{getEventAcademicSummary(event)}</div>
                  <div className="text-xs text-gray-500">{getEventAssignedDisplay(event)}</div>
                  <div className="flex flex-wrap gap-4 pt-1 text-sm">
                    <button onClick={() => openEditEvent(event)} className="font-medium text-indigo-600">
                      Editar
                    </button>
                    {event.type === 'CLASE' && event.assignedUser && event.status !== 'CANCELLED' ? (
                      <button onClick={() => setSubstitutionEvent(event)} className="font-medium text-indigo-600">
                        Suplencia
                      </button>
                    ) : null}
                    {event.status !== 'CANCELLED' ? (
                      <button onClick={() => cancelEvent(event.id)} className="font-medium text-yellow-600">
                        Cancelar
                      </button>
                    ) : (
                      <button onClick={() => reactivateEvent(event.id)} className="font-medium text-green-600">
                        Reactivar
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {/* Desktop: tabla */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[900px] table-fixed">
                <colgroup>
                  <col className="w-10" />
                  <col className="w-[32%]" />
                  <col className="w-[24%]" />
                  <col className="w-[16%]" />
                  <col className="w-[16%]" />
                  <col className="w-[12%]" />
                </colgroup>
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      <input
                        type="checkbox"
                        checked={events.length > 0 && selectedEventIds.length === events.length}
                        onChange={toggleAllEventsSelection}
                        aria-label="Seleccionar todas las actividades"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actividad</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Curso y asignatura</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Horario</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Asignado</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td className="px-4 py-4 align-top text-sm">
                        <input
                          type="checkbox"
                          checked={selectedEventIds.includes(event.id)}
                          onChange={() => toggleEventSelection(event.id)}
                          aria-label={`Seleccionar actividad ${event.title}`}
                        />
                      </td>
                      <td className="px-4 py-4 align-top text-sm">
                        <div className="min-w-0 space-y-2">
                          <div className="font-medium text-gray-900 break-words">{event.title}</div>
                          {event.description && (
                            <div className="line-clamp-2 text-gray-500 text-xs break-words">{event.description}</div>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              {getAdminEventTypeLabel(event.type)}
                            </span>
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getAdminEventStatusStyle(event.status)}`}>
                              {getAdminEventStatusLabel(event.status)}
                            </span>
                            <span className="text-xs text-gray-500">{event._count.attendances} asist.</span>
                            {event.type === 'CLASE' &&
                            event.assignedUser &&
                            substitutionKeys.has(
                              `${event.id}|${getEventDateInputValue(event.startDate)}`,
                            ) ? (
                              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
                                Suplida
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top text-sm text-gray-900">
                        <div className="min-w-0 space-y-2">
                          {event.course ? (
                            <div>
                              <div className="font-medium break-words">{event.course.name}</div>
                              {event.course.code ? (
                                <div className="text-xs text-gray-500 break-words">{event.course.code}</div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-gray-400">Sin curso</span>
                          )}
                          {event.subject ? (
                            <div className="border-t border-gray-100 pt-2">
                              <div className="break-words">{event.subject.name}</div>
                              {event.subject.code ? (
                                <div className="text-xs text-gray-500 break-words">{event.subject.code}</div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="text-xs text-gray-400">Sin asignatura</div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top text-sm text-gray-900">
                        <div className="space-y-1">
                          <div>{formatDateInUruguay(event.startDate)}</div>
                          <div className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-900">
                            {formatEventScheduleSummary(event)}
                          </div>
                          {event.startTime && (
                            <div className="text-xs text-gray-500">
                              Inicio {formatTimeInUruguay(event.startTime)}
                            </div>
                          )}
                          {event.endTime ? (
                            <div className="text-xs text-gray-500">
                              {event.endDate && event.endDate !== event.startDate
                                ? `Fin ${formatDateInUruguay(event.endDate)} ${formatTimeInUruguay(event.endTime)}`
                                : `Fin ${formatTimeInUruguay(event.endTime)}`}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">Sin hora fin</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 align-top text-sm">
                        {event.assignedUser ? (
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900 break-words">{event.assignedUser.username || event.assignedUser.name}</div>
                            <div className="text-xs text-gray-500">{getRoleLabel(event.assignedUser.role)}</div>
                          </div>
                        ) : (
                          <span className="text-gray-400">Sin asignar</span>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top text-sm">
                        <div className="flex flex-col items-start gap-2">
                          <button
                            onClick={() => openEditEvent(event)}
                            className="text-indigo-600 hover:text-indigo-900"
                          >
                            Editar
                          </button>
                          {event.type === 'CLASE' && event.assignedUser && event.status !== 'CANCELLED' ? (
                            <button
                              type="button"
                              onClick={() => setSubstitutionEvent(event)}
                              className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
                            >
                              Registrar suplencia
                            </button>
                          ) : null}
                          {event.status !== 'CANCELLED' ? (
                            <button
                              onClick={() => cancelEvent(event.id)}
                              className="text-yellow-600 hover:text-yellow-900"
                            >
                              Cancelar
                            </button>
                          ) : (
                            <button
                              onClick={() => reactivateEvent(event.id)}
                              className="text-green-600 hover:text-green-900"
                            >
                              Reactivar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}

          <PaginationControls page={page} total={total} onPageChange={setPage} />
        </div>
        )}

        {occurrencePanel ? (
          <OccurrenceActionModal
            occ={occurrencePanel}
            busy={occurrenceBusy}
            onClose={() => setOccurrencePanel(null)}
            onSuspend={(reason) => void suspendOccurrence(reason)}
            onRestore={() => void restoreOccurrence()}
            onSaveTimes={(startTime, endTime) => void saveOccurrenceTimes(startTime, endTime)}
            onEditSeries={() => {
              const target = occurrencePanel.event as unknown as Event
              setOccurrencePanel(null)
              openEditEvent(target)
            }}
          />
        ) : null}

        {substitutionEvent ? (
          <SubstitutionModal
            event={substitutionEvent}
            teachers={users.filter((u) => u.role === 'TEACHER' || u.role === 'STAFF')}
            onClose={() => setSubstitutionEvent(null)}
            onSaved={() => {
              void loadEvents()
              void loadSubstitutionFlags()
              setMessage('✅ Suplencia registrada')
            }}
          />
        ) : null}

        {/* Modal de creación (portal a document.body → siempre encima, no queda “tapado” por el layout) */}
        {portalReady &&
          creating &&
          createPortal(
            <div
              className="fixed inset-0 flex items-end justify-center overflow-y-auto bg-black/70 p-3 sm:items-center sm:p-4"
              style={{ zIndex: 2147483647 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-event-title"
            >
            <div
              data-testid="create-event-modal"
              className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-lg sm:p-6"
            >
              <button
                type="button"
                onClick={closeCreateModal}
                className="absolute top-3 right-3 z-[2] flex h-12 w-12 items-center justify-center rounded-full border-4 border-indigo-600 bg-white text-2xl font-bold leading-none text-indigo-700 shadow-lg hover:bg-indigo-50"
                aria-label="Cerrar"
                title="Cerrar"
              >
                ×
              </button>
              <div className="mb-4 border-b border-gray-200 pb-3 pr-14">
                <h3 id="create-event-title" className="text-lg font-semibold">
                  Nueva actividad
                </h3>
              </div>

              {createModalError && (
                <div
                  className="mb-4 rounded-md border-2 border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-900 shadow-sm"
                  role="alert"
                >
                  {createModalError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Se repite - Primera opción */}
                <div className="md:col-span-2">
                  <div className="flex items-center mb-4 p-3 bg-gray-50 rounded-lg">
                    <input
                      type="checkbox"
                      id="isRecurring"
                      checked={newEvent.isRecurring}
                      onChange={(e) => {
                        const isRecurring = e.target.checked
                        setRecurrenceRangeMode('school_year')
                        setNewEvent({
                          ...newEvent,
                          isRecurring,
                          recurrenceType: isRecurring ? 'WEEKLY' : 'NONE',
                          daysOfWeek: [],
                          recurrenceEnd: '',
                        })
                      }}
                      className="mr-3 h-4 w-4"
                    />
                    <label htmlFor="isRecurring" className="text-sm font-medium text-gray-700">
                      Se repite
                    </label>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
                  <input
                    type="text"
                    value={newEvent.title}
                    onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="Ej: Turno matutino"
                  />
                </div>
                
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
                  <textarea
                    value={newEvent.description}
                    onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    rows={3}
                    placeholder="Descripción del evento"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Perfil de la persona</label>
                  <select
                    value={selectedRole}
                    onChange={(e) => {
                      const role = e.target.value as RoleOption
                      setSelectedRole(role)
                      // Resetear tipo cuando cambia el rol
                      if (role === 'TEACHER') {
                        setNewEvent({ ...newEvent, type: 'CLASE' })
                      } else if (role === 'STAFF') {
                        setNewEvent({ ...newEvent, type: 'JORNADA_LABORAL' })
                      }
                    }}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="">Seleccioná un perfil</option>
                    <option value="TEACHER">Docente</option>
                    <option value="STAFF">Personal</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                  <select
                    value={newEvent.type}
                    onChange={(e) => setNewEvent({ ...newEvent, type: e.target.value as EventTypeOption })}
                    disabled={!selectedRole}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  >
                    {getAdminEventRoleTypeOptions(selectedRole).length === 0 ? (
                      <option value="">Seleccioná un perfil primero</option>
                    ) : (
                      getAdminEventRoleTypeOptions(selectedRole).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))
                    )}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Asignado a</label>
                  <select
                    value={newEvent.assignedUserId}
                    onChange={(e) => setNewEvent({ ...newEvent, assignedUserId: e.target.value })}
                    disabled={!selectedRole}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  >
                    <option value="">Sin asignar</option>
                    {users
                      .filter(user => !selectedRole || user.role === selectedRole)
                      .map(user => (
                        <option key={user.id} value={user.id}>{user.username || user.name} ({getRoleLabel(user.role)})</option>
                      ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Curso (opcional)</label>
                  <select
                    value={newEvent.courseId}
                    onChange={(e) => {
                      const v = e.target.value
                      setNewEvent((prev) => ({
                        ...prev,
                        courseId: v,
                        orientationId: prev.courseId === v ? prev.orientationId : '',
                        courseOrientationId: prev.courseId === v ? prev.courseOrientationId : '',
                        subjectId: prev.courseId === v ? prev.subjectId : '',
                      }))
                    }}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="">Sin curso</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Orientación (opcional)</label>
                  <select
                    value={newEvent.courseOrientationId}
                    onChange={(e) => {
                      const row = createOrientations.find((o) => o.id === e.target.value)
                      setNewEvent({
                        ...newEvent,
                        courseOrientationId: row?.id ?? '',
                        orientationId: row?.orientationId ?? '',
                        subjectId: '',
                      })
                    }}
                    disabled={!newEvent.courseId || createOrientations.length === 0}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  >
                    <option value="">
                      {!newEvent.courseId
                        ? 'Elegí un curso primero'
                        : createOrientations.length === 0
                          ? 'El curso no tiene orientaciones'
                          : 'Todas las orientaciones'}
                    </option>
                    {createOrientations.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.orientation.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Asignatura (opcional)</label>
                  <select
                    value={newEvent.subjectId}
                    onChange={(e) => setNewEvent({ ...newEvent, subjectId: e.target.value })}
                    disabled={!newEvent.courseId}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  >
                    <option value="">{newEvent.courseId ? 'Sin asignatura' : 'Elegí un curso primero'}</option>
                    {createSubjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                
                <AdminTime24Selects
                  label="Hora inicio"
                  idPrefix="create-event-start"
                  value={newEvent.startTime ?? '09:00'}
                  onChange={(hhmm) => setNewEvent({ ...newEvent, startTime: hhmm })}
                />

                <AdminTime24Selects
                  label="Hora fin"
                  idPrefix="create-event-end"
                  value={newEvent.endTime ?? '10:00'}
                  onChange={(hhmm) => setNewEvent({ ...newEvent, endTime: hhmm })}
                />
                
                {/* Fechas: evento único o repetitivo */}
                {newEvent.isRecurring ? (
                  <div className="md:col-span-2 space-y-4 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
                    <div>
                      <span className="block text-sm font-medium text-gray-800 mb-2">Vigencia de la repetición</span>
                      <div className="space-y-2">
                        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
                          <input
                            type="radio"
                            name="recurrenceRangeMode"
                            checked={recurrenceRangeMode === 'school_year'}
                            onChange={() => {
                              setRecurrenceRangeMode('school_year')
                              setNewEvent((prev) => ({ ...prev, recurrenceEnd: '' }))
                            }}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="font-medium text-gray-900">Hasta cierre manual del año lectivo</span>
                            <span className="mt-0.5 block text-xs text-gray-600">
                              {activeSchoolYear && activeSchoolYear.status !== 'CLOSED'
                                ? `Sigue disponible en ${schoolYearRangeLabel(activeSchoolYear)} hasta que el ciclo se cierre.`
                                : 'Elegí un ciclo lectivo abierto en la barra superior para usar esta opción.'}
                            </span>
                          </span>
                        </label>
                        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
                          <input
                            type="radio"
                            name="recurrenceRangeMode"
                            checked={recurrenceRangeMode === 'custom'}
                            onChange={() => setRecurrenceRangeMode('custom')}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="font-medium text-gray-900">Rango personalizado</span>
                            <span className="mt-0.5 block text-xs text-gray-600">
                              Elegí manualmente la fecha de inicio y la fecha de fin de la repetición.
                            </span>
                          </span>
                        </label>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de inicio</label>
                        <input
                          type="date"
                          value={newEvent.startDate}
                          min={createMinStartDateYmd}
                          onChange={(e) => setNewEvent({ ...newEvent, startDate: e.target.value })}
                          className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                        <p className="mt-1 text-xs text-gray-500">Desde cuándo empieza a repetirse (primer día).</p>
                      </div>
                      {recurrenceRangeMode === 'custom' ? (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de fin</label>
                          <input
                            type="date"
                            value={newEvent.recurrenceEnd}
                            min={newEvent.startDate || createMinStartDateYmd}
                            onChange={(e) => setNewEvent({ ...newEvent, recurrenceEnd: e.target.value })}
                            className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                          />
                          <p className="mt-1 text-xs text-gray-500">Último día en que puede repetirse.</p>
                        </div>
                      ) : (
                        <div className="flex flex-col justify-center rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                          <span className="font-medium">Vigencia</span>
                          <span className="mt-1">
                            {activeSchoolYear && activeSchoolYear.status !== 'CLOSED'
                              ? 'Hasta cierre manual del ciclo'
                              : 'Sin ciclo lectivo abierto'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
                    <input
                      type="date"
                      value={newEvent.startDate}
                      min={createMinStartDateYmd}
                      onChange={(e) => setNewEvent({ ...newEvent, startDate: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                )}
                
                {/* Días de la semana solo para eventos repetitivos */}
                {newEvent.isRecurring && (
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Días de la Semana</label>
                    <div className="grid grid-cols-7 gap-2">
                      {WEEKDAY_OPTIONS.map(day => (
                        <label key={day.value} className="flex flex-col items-center">
                          <input
                            type="checkbox"
                            checked={newEvent.daysOfWeek.includes(day.value)}
                            onChange={(e) => {
                              const daysOfWeek = e.target.checked
                                ? [...newEvent.daysOfWeek, day.value]
                                : newEvent.daysOfWeek.filter(d => d !== day.value)
                              setNewEvent({ ...newEvent, daysOfWeek })
                            }}
                            className="mb-1"
                          />
                          <span className="text-xs text-gray-600">{day.short}</span>
                        </label>
                      ))}
                    </div>
                    <div className="mt-3 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-950">
                      <span className="font-medium">Queda asignado:</span>{' '}
                      {formatEventScheduleSummary(newEvent)}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={createEvent}
                  className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  Nueva actividad
                </button>
                <button type="button" onClick={closeCreateModal} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </div>
          </div>,
            document.body,
          )}

        {/* Modal de edición (portal) */}
        {portalReady &&
          editingEvent &&
          createPortal(
            <div
              className="fixed inset-0 flex items-end justify-center overflow-y-auto bg-black/70 p-3 sm:items-center sm:p-4"
              style={{ zIndex: 2147483647 }}
              role="dialog"
              aria-modal="true"
            >
            <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-lg sm:p-6">
              <button
                type="button"
                onClick={closeEditModal}
                className="absolute top-3 right-3 z-[2] flex h-12 w-12 items-center justify-center rounded-full border-4 border-indigo-600 bg-white text-2xl font-bold leading-none text-indigo-700 shadow-lg hover:bg-indigo-50"
                aria-label="Cerrar"
                title="Cerrar"
              >
                ×
              </button>
              <div className="mb-4 border-b border-gray-200 pb-3 pr-14">
                <h3 className="text-lg font-semibold">Editar actividad</h3>
              </div>

              {editModalError && (
                <div
                  role="alert"
                  className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                >
                  {editModalError}
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
                  <input
                    type="text"
                    value={editingEvent.title}
                    onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
                  <textarea
                    value={editingEvent.description || ''}
                    onChange={(e) => setEditingEvent({ ...editingEvent, description: e.target.value })}
                    rows={3}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                  <select
                    value={editingEvent.type}
                    onChange={(e) => setEditingEvent({ ...editingEvent, type: e.target.value as EventTypeOption })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {ADMIN_EVENT_TYPE_SELECT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                  <select
                    value={editingEvent.status}
                    onChange={(e) => setEditingEvent({ ...editingEvent, status: e.target.value as EventStatusOption })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="SCHEDULED">Programado</option>
                    <option value="IN_PROGRESS">En curso</option>
                    <option value="COMPLETED">Completado</option>
                    <option value="CANCELLED">Cancelado</option>
                    <option value="EXPIRED">Vencido</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
                  <input
                    type="date"
                    value={getEventDateInputValue(editingEvent.startDate)}
                    min={editMinStartDateYmd}
                    onChange={(e) => setEditingEvent({ ...editingEvent, startDate: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha fin</label>
                  <input
                    type="date"
                    value={getEventEndDateInputValue(editingEvent)}
                    onChange={(e) => setEditingEvent({ ...editingEvent, endDate: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  {!editingEvent.endDate && (
                    <p className="mt-1 text-xs text-gray-500">Mismo día que la fecha del evento.</p>
                  )}
                </div>
                
                <AdminTime24Selects
                  label="Hora inicio"
                  idPrefix="edit-event-start"
                  value={formatClockHhMmInUruguayFromIso(editingEvent.startTime)}
                  onChange={(hhmm) => setEditingEvent({ ...editingEvent, startTime: hhmm })}
                />

                <AdminTime24Selects
                  label="Hora fin"
                  idPrefix="edit-event-end"
                  value={formatClockHhMmInUruguayFromIso(editingEvent.endTime)}
                  onChange={(hhmm) => setEditingEvent({ ...editingEvent, endTime: hhmm })}
                />
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Asignado a</label>
                  <select
                    value={editingEvent.assignedUserId || ''}
                    onChange={(e) => setEditingEvent({ ...editingEvent, assignedUserId: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="">Sin asignar</option>
                    {users.map(user => (
                      <option key={user.id} value={user.id}>
                        {user.username || user.name} ({getRoleLabel(user.role)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Curso (opcional)</label>
                  <select
                    value={editingEvent.courseId ?? ''}
                    onChange={(e) => {
                      const v = e.target.value || null
                      setEditingEvent((prev) => {
                        if (!prev) return prev
                        const prevC = prev.courseId ?? ''
                        const nextC = v ?? ''
                        return {
                          ...prev,
                          courseId: v,
                          orientationId: prevC === nextC ? prev.orientationId ?? null : null,
                          courseOrientationId: prevC === nextC ? prev.courseOrientationId ?? null : null,
                          subjectId: prevC === nextC ? prev.subjectId : null,
                        }
                      })
                    }}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="">Sin curso</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Orientación (opcional)</label>
                  <select
                    value={editingEvent.courseOrientationId ?? ''}
                    onChange={(e) => {
                      const row = editOrientations.find((o) => o.id === e.target.value)
                      setEditingEvent({
                        ...editingEvent,
                        courseOrientationId: row?.id ?? null,
                        orientationId: row?.orientationId ?? null,
                        subjectId: null,
                      })
                    }}
                    disabled={!editingEvent.courseId || editOrientations.length === 0}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  >
                    <option value="">
                      {!editingEvent.courseId
                        ? 'Elegí un curso primero'
                        : editOrientations.length === 0
                          ? 'El curso no tiene orientaciones'
                          : 'Todas las orientaciones'}
                    </option>
                    {editOrientations.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.orientation.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Asignatura (opcional)</label>
                  <select
                    value={editingEvent.subjectId ?? ''}
                    onChange={(e) =>
                      setEditingEvent({
                        ...editingEvent,
                        subjectId: e.target.value || null,
                      })
                    }
                    disabled={!editingEvent.courseId}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  >
                    <option value="">{editingEvent.courseId ? 'Sin asignatura' : 'Elegí un curso primero'}</option>
                    {editSubjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                {editingEvent.type === 'CLASE' &&
                editingEvent.assignedUserId &&
                editingEvent.status !== 'CANCELLED' ? (
                  <div className="md:col-span-2 rounded-xl border-2 border-indigo-200 bg-indigo-50/80 p-4">
                    <h4 className="text-sm font-semibold text-indigo-900">Suplencia de clase</h4>
                    <p className="mt-1 text-sm text-indigo-800/90">
                      Registrá qué docente cubre al titular en una fecha concreta (no es un tipo de evento).
                    </p>
                    {substitutionKeys.has(
                      `${editingEvent.id}|${getEventDateInputValue(editingEvent.startDate)}`,
                    ) ? (
                      <p className="mt-2 text-xs font-medium text-indigo-700">Ya hay suplencia para el día del evento en el listado.</p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setSubstitutionEvent(editingEvent)}
                      className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                    >
                      Registrar suplencia
                    </button>
                  </div>
                ) : null}
              </div>
              
              <div className="mt-6 flex flex-col justify-end gap-3 sm:flex-row">
                <button
                  onClick={() => updateEvent(editingEvent.id, editingEvent)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  Guardar Cambios
                </button>
                <button
                  onClick={closeEditModal}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>,
            document.body,
          )}
      </main>
    </RoleGuard>
  )
}
