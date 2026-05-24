'use client'
import DateRangeFields from '@/components/forms/DateRangeFields'
import PaginationControls from '@/components/common/PaginationControls'
import RoleGuard from '@/components/auth/RoleGuard'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar } from 'lucide-react'
import { api } from '@/lib/api/client'
import {
  buildAdminEventsAllQueryString,
  getAdminEventRoleTypeOptions,
  getAdminEventStatusLabel,
  getAdminEventStatusStyle,
  getAdminEventTypeLabel,
  type AdminEventCreatorRole,
} from '@/lib/admin/events-display'
import { getAdminFlashMessageClass } from '@/lib/admin/ui-helpers'
import {
  formatDateInUruguay,
  formatTimeInUruguay,
  formatClockHhMmInUruguayFromIso,
  getTodayYmdInUruguay,
} from '@/lib/forms/datetime-uy'

type CourseOpt = { id: string; name: string; code: string | null; isActive?: boolean }
type SubjectOpt = { id: string; name: string; code: string | null }

function withSchoolYear(path: string, schoolYearQuery: string): string {
  if (!schoolYearQuery) return path
  return path.includes('?') ? `${path}&${schoolYearQuery}` : `${path}?${schoolYearQuery}`
}

type Event = {
  id: string
  title: string
  description?: string
  type: 'JORNADA_LABORAL' | 'REUNION' | 'CLASE' | 'EVENTO' | 'CAPACITACION' | 'CITA_MEDICA'
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
  subjectId?: string | null
  subject?: { id: string; name: string; code: string | null } | null
  recurrenceType: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'
  isRecurring: boolean
  daysOfWeek: number[]
  recurrenceEnd?: string
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
  | 'subjectId'
  | 'recurrenceType'
  | 'isRecurring'
  | 'daysOfWeek'
  | 'recurrenceEnd'
> & {
  assignedUserId: string
  recurrenceEnd: string
  courseId: string
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

/** Horas 00–23 (formato 24 h civil; no AM/PM). */
const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES_60 = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

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
    return <div className="p-6 text-center text-gray-500">No hay eventos</div>
  }

  return null
}

export default function AdminEvents() {
  const syCtx = useOptionalAdminSchoolYear()
  const schoolYearQuery = syCtx?.schoolYearQuery ?? ''
  /** Cursos/asignaturas: siempre un solo ciclo (evita EMS1-ARTE-2020, 2024, 2025… en el combo). */
  const coursePickerQuery = syCtx?.schoolYearScopedQuery ?? schoolYearQuery

  const [events, setEvents] = useState<Event[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [courses, setCourses] = useState<CourseOpt[]>([])
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
  /** Errores del formulario "Crear evento" (se muestran dentro del modal). */
  const [createModalError, setCreateModalError] = useState('')

  const [newEvent, setNewEvent] = useState<EditableEvent>({
    title: '',
    description: '',
    type: 'JORNADA_LABORAL',
    startDate: getTodayYmdInUruguay(),
    startTime: '09:00',
    endTime: '10:00',
    assignedUserId: '',
    courseId: '',
    subjectId: '',
    recurrenceType: 'NONE',
    isRecurring: false,
    daysOfWeek: [],
    recurrenceEnd: ''
  })
  
  const [selectedRole, setSelectedRole] = useState<RoleOption>('')
  const [portalReady, setPortalReady] = useState(false)

  useEffect(() => {
    loadEvents()
    loadUsers()
  }, [page, filters, syCtx?.allYears, syCtx?.schoolYearQuery])

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
      setCreateSubjects([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const path = `/courses/${newEvent.courseId}/subjects`
        const list = await api<SubjectOpt[]>(withSchoolYear(path, coursePickerQuery))
        if (!cancelled) setCreateSubjects(Array.isArray(list) ? list : [])
      } catch {
        if (!cancelled) setCreateSubjects([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [creating, newEvent.courseId, coursePickerQuery])

  useEffect(() => {
    if (!editingEvent?.courseId) {
      setEditSubjects([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const path = `/courses/${editingEvent.courseId}/subjects`
        const list = await api<SubjectOpt[]>(withSchoolYear(path, coursePickerQuery))
        if (!cancelled) setEditSubjects(Array.isArray(list) ? list : [])
      } catch {
        if (!cancelled) setEditSubjects([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [editingEvent?.courseId, coursePickerQuery])

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

  function resetCreateForm() {
    setSelectedRole('')
    setCreateModalError('')
    setNewEvent({
      title: '',
      description: '',
      type: 'JORNADA_LABORAL',
      startDate: getTodayYmdInUruguay(),
      startTime: '09:00',
      endTime: '10:00',
      assignedUserId: '',
      courseId: '',
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
    if (newEvent.isRecurring) {
      if (!newEvent.recurrenceEnd) return 'Los eventos repetitivos requieren fecha de fin de recurrencia.'
      if (newEvent.recurrenceEnd < newEvent.startDate) {
        return 'La fecha de fin de recurrencia debe ser igual o posterior a la fecha de inicio.'
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
        recurrenceEnd: newEvent.isRecurring && newEvent.recurrenceEnd ? newEvent.recurrenceEnd : null,
      }
      if (newEvent.assignedUserId) {
        eventData.assignedUserId = newEvent.assignedUserId
      }
      if (newEvent.courseId) {
        eventData.courseId = newEvent.courseId
      }
      if (newEvent.subjectId) {
        eventData.subjectId = newEvent.subjectId
      }

      await api(withSchoolYear('/events/', coursePickerQuery), {
        method: 'POST',
        body: JSON.stringify(eventData),
      })

      setMessage('✅ Evento creado correctamente')
      await loadEvents()
      setCreating(false)
      resetCreateForm()
    } catch (error: unknown) {
      setCreateModalError(getApiErrorDetail(error))
    }
  }

  async function updateEvent(id: string, updates: Partial<Event>) {
    try {
      await api(withSchoolYear(`/events/${id}`, coursePickerQuery), {
        method: 'PUT',
        body: JSON.stringify(updates)
      })
      
      setMessage('✅ Evento actualizado correctamente')
      await loadEvents()
      setEditingEvent(null)
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al actualizar evento'}`)
    }
  }

  async function cancelEvent(id: string, reason?: string) {
    try {
      await api(`/events/${id}/cancel`, {
        method: 'PUT',
        body: JSON.stringify({ reason })
      })
      
      setMessage('✅ Evento cancelado correctamente')
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
      
      setMessage('✅ Evento reactivado correctamente')
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
      <main className="mx-auto w-full max-w-[1600px] p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <Calendar className="h-7 w-7 text-emerald-600" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Gestión de Eventos</h1>
              <p className="text-gray-600">Crear y administrar eventos</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => {
                setMessage('')
                setCreateModalError('')
                setCreating(true)
              }}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Crear Evento
            </button>
            <div className="text-sm text-gray-600">
              Total: {total} eventos
            </div>
          </div>
        </div>

        {/* Filtros */}
        <div className="bg-white border rounded-lg p-6 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Filtros</h2>
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
              className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded border"
            >
              Limpiar Filtros
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-7 gap-4">
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
                <option value="JORNADA_LABORAL">Jornada Laboral</option>
                <option value="REUNION">Reunión</option>
                <option value="CLASE">Clase</option>
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
                <option value="IN_PROGRESS">En Progreso</option>
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

        {/* Tabla de eventos */}
        <div className="bg-white border rounded-lg shadow-sm">
          <div className="p-6 border-b flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-lg font-semibold">Eventos</h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-gray-500">
                {selectedEventIds.length === 0
                  ? 'Selecciona eventos para eliminarlos'
                  : `${selectedEventIds.length} seleccionados`}
              </span>
              <button
                type="button"
                onClick={deleteSelectedEvents}
                disabled={selectedEventIds.length === 0 || deletingSelected}
                className="inline-flex items-center rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingSelected ? 'Eliminando...' : 'Eliminar seleccionados'}
              </button>
            </div>
          </div>
          
          {loading ? (
            <div className="p-6 text-center text-gray-500">Cargando...</div>
          ) : renderEventsEmptyState(events) || (
            <div className="overflow-hidden">
              <table className="w-full table-fixed">
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
                        aria-label="Seleccionar todos los eventos"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Evento</th>
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
                          aria-label={`Seleccionar evento ${event.title}`}
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
                          {event.startTime && (
                            <div className="text-xs text-gray-500">
                              Inicio {formatTimeInUruguay(event.startTime)}
                            </div>
                          )}
                          {event.endDate ? (
                            <>
                              {event.endDate !== event.startDate && (
                                <div className="text-xs text-gray-500">Fin {formatDateInUruguay(event.endDate)}</div>
                              )}
                              {event.endTime && (
                                <div className="text-xs text-gray-500">
                                  Fin {formatTimeInUruguay(event.endTime)}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-gray-400">Sin fecha fin</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 align-top text-sm">
                        {event.assignedUser ? (
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900 break-words">{event.assignedUser.username || event.assignedUser.name}</div>
                            <div className="text-xs text-gray-500">{event.assignedUser.role}</div>
                          </div>
                        ) : (
                          <span className="text-gray-400">Sin asignar</span>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top text-sm">
                        <div className="flex flex-col items-start gap-2">
                          <button
                            onClick={() => setEditingEvent(event)}
                            className="text-indigo-600 hover:text-indigo-900"
                          >
                            Editar
                          </button>
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
          )}

          <PaginationControls page={page} total={total} onPageChange={setPage} />
        </div>

        {/* Modal de creación (portal a document.body → siempre encima, no queda “tapado” por el layout) */}
        {portalReady &&
          creating &&
          createPortal(
            <div
              className="fixed inset-0 flex items-center justify-center bg-black/70 p-4"
              style={{ zIndex: 2147483647 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-event-title"
            >
            <div
              data-testid="create-event-modal"
              className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl relative"
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
                  Crear Evento
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
                {/* Evento Repetitivo - Primera opción */}
                <div className="md:col-span-2">
                  <div className="flex items-center mb-4 p-3 bg-gray-50 rounded-lg">
                    <input
                      type="checkbox"
                      id="isRecurring"
                      checked={newEvent.isRecurring}
                      onChange={(e) => {
                        const isRecurring = e.target.checked
                        setNewEvent({ 
                          ...newEvent, 
                          isRecurring,
                          recurrenceType: isRecurring ? 'WEEKLY' : 'NONE',
                          daysOfWeek: [],
                          recurrenceEnd: ''
                        })
                      }}
                      className="mr-3 h-4 w-4"
                    />
                    <label htmlFor="isRecurring" className="text-sm font-medium text-gray-700">
                      Evento Repetitivo
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rol del Usuario</label>
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
                    <option value="">Seleccionar rol</option>
                    <option value="TEACHER">Teacher</option>
                    <option value="STAFF">Staff</option>
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
                      <option value="">Selecciona un rol primero</option>
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
                        <option key={user.id} value={user.id}>{user.username || user.name} ({user.role})</option>
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
                        subjectId: prev.courseId === v ? prev.subjectId : '',
                      }))
                    }}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="">Sin curso</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code ? `${c.code} — ${c.name}` : c.name}
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
                        {s.code ? `${s.code} — ${s.name}` : s.name}
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
                
                {/* Campos de fecha según si es repetitivo o no */}
                {newEvent.isRecurring ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Inicio</label>
                      <input
                        type="date"
                        value={newEvent.startDate}
                        onChange={(e) => setNewEvent({ ...newEvent, startDate: e.target.value })}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Fin</label>
                      <input
                        type="date"
                        value={newEvent.recurrenceEnd}
                        onChange={(e) => setNewEvent({ ...newEvent, recurrenceEnd: e.target.value })}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
                    <input
                      type="date"
                      value={newEvent.startDate}
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
                      {[
                        { value: 0, label: 'Dom' },
                        { value: 1, label: 'Lun' },
                        { value: 2, label: 'Mar' },
                        { value: 3, label: 'Mié' },
                        { value: 4, label: 'Jue' },
                        { value: 5, label: 'Vie' },
                        { value: 6, label: 'Sáb' }
                      ].map(day => (
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
                          <span className="text-xs text-gray-600">{day.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={createEvent}
                  className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  Crear Evento
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
              className="fixed inset-0 flex items-center justify-center bg-black/70 p-4"
              style={{ zIndex: 2147483647 }}
              role="dialog"
              aria-modal="true"
            >
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl relative">
              <button
                type="button"
                onClick={() => setEditingEvent(null)}
                className="absolute top-3 right-3 z-[2] flex h-12 w-12 items-center justify-center rounded-full border-4 border-indigo-600 bg-white text-2xl font-bold leading-none text-indigo-700 shadow-lg hover:bg-indigo-50"
                aria-label="Cerrar"
                title="Cerrar"
              >
                ×
              </button>
              <div className="mb-4 border-b border-gray-200 pb-3 pr-14">
                <h3 className="text-lg font-semibold">Editar Evento</h3>
              </div>
              
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
                    <option value="JORNADA_LABORAL">Jornada Laboral</option>
                    <option value="REUNION">Reunión</option>
                    <option value="CLASE">Clase</option>
                    <option value="EVENTO">Evento</option>
                    <option value="CAPACITACION">Capacitación</option>
                    <option value="CITA_MEDICA">Cita Médica</option>
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
                    <option value="IN_PROGRESS">En Progreso</option>
                    <option value="COMPLETED">Completado</option>
                    <option value="CANCELLED">Cancelado</option>
                    <option value="EXPIRED">Vencido</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
                  <input
                    type="date"
                    value={editingEvent.startDate.split('T')[0]}
                    onChange={(e) => setEditingEvent({ ...editingEvent, startDate: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha Fin</label>
                  <input
                    type="date"
                    value={editingEvent.endDate ? editingEvent.endDate.split('T')[0] : ''}
                    onChange={(e) => setEditingEvent({ ...editingEvent, endDate: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
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
                        {user.username || user.name} ({user.role})
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
                          subjectId: prevC === nextC ? prev.subjectId : null,
                        }
                      })
                    }}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="">Sin curso</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code ? `${c.code} — ${c.name}` : c.name}
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
                        {s.code ? `${s.code} — ${s.name}` : s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => updateEvent(editingEvent.id, editingEvent)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  Guardar Cambios
                </button>
                <button
                  onClick={() => setEditingEvent(null)}
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
