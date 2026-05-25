'use client'
import PaginationControls from '@/components/common/PaginationControls'
import RoleGuard from '@/components/auth/RoleGuard'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import {
  buildAdminAttendanceAllQueryString,
  buildAttendanceExportReportQueryString,
  getAdminAttendancePlannedTimeLabel,
  getAdminAttendanceStatusLabel,
  getAdminAttendanceStatusStyle,
  getAdminAttendanceTypeLabel,
  getAdminAttendanceTypeStyle,
} from '@/lib/admin/attendance-display'
import { formatDateInUruguay, formatTimeInUruguay } from '@/lib/forms/datetime-uy'
import { getAdminFlashMessageClass } from '@/lib/admin/ui-helpers'
import AdminIncidentsPanel from '@/components/admin/AdminIncidentsPanel'
import AttendanceJustifyModal from '@/components/admin/AttendanceJustifyModal'
import {
  BarChart3,
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  FileSpreadsheet,
  FileText,
  Search,
  Trash2,
} from 'lucide-react'

function withSchoolYear(path: string, schoolYearQuery: string): string {
  if (!schoolYearQuery) return path
  return path.includes('?') ? `${path}&${schoolYearQuery}` : `${path}?${schoolYearQuery}`
}

function getAttendanceRowStatusLabel(attendance: AttendanceRecord) {
  if (attendance.type === 'CHECK_OUT' && attendance.status === 'PRESENT') {
    return 'Salida'
  }
  if (attendance.status === 'LATE' && attendance.notes?.toLowerCase().includes('llegada muy tarde')) {
    return 'Llegada muy tarde'
  }
  return getAdminAttendanceStatusLabel(attendance.status)
}

type AttendanceRecord = {
  id: string
  type: 'CHECK_IN' | 'CHECK_OUT' | 'INCIDENT'
  status:
    | 'PRESENT'
    | 'LATE'
    | 'ABSENT_NOT_JUSTIFIED'
    | 'ABSENT_JUSTIFIED'
    | 'EXIT'
    | 'EARLY_EXIT'
    | 'JUSTIFIED'
    | 'SUBSTITUTED'
  date: string
  time: string
  notes?: string
  title?: string
  description?: string
  user: {
    id: string
    name: string
    email: string
    role: string
  }
  event?: {
    id: string
    title: string
    type: string
    startTime?: string
    endTime?: string
  }
}

type AttendanceStats = {
  totalAttendances: number
  presentCount: number
  absentCount: number
  lateCount: number
  medicalLeaveCount: number
  exitCount: number
  earlyExitCount: number
  attendanceRate: number
  lateRate: number
  absenceRate: number
  exitRate: number
  earlyExitRate: number
}

type User = {
  id: string
  name: string
  email: string
  role: string
  username?: string
}

type AttendanceStatusOption = AttendanceRecord['status']
type AttendanceTypeOption = Exclude<AttendanceRecord['type'], 'INCIDENT'>

type AttendancePairRow = {
  key: string
  user: AttendanceRecord['user']
  event?: AttendanceRecord['event']
  eventSummary?: {
    title: string
    type: string
  }
  dateTime: string
  checkIn?: AttendanceRecord
  checkOut?: AttendanceRecord
  incident?: AttendanceRecord
}

type AttendanceGroup = {
  user: AttendanceRecord['user']
  attendances: AttendanceRecord[]
}

function isIncidentRow(attendance: AttendanceRecord): boolean {
  return attendance.type === 'INCIDENT' || attendance.id.startsWith('incident:')
}

function getAttendanceDayGroupKey(attendance: AttendanceRecord): string {
  const dateKey = attendance.date ? attendance.date.slice(0, 10) : attendance.time.slice(0, 10)
  return `${attendance.user.id}:${dateKey}`
}

function summarizeRowEvent(row: Pick<AttendancePairRow, 'checkIn' | 'checkOut' | 'incident' | 'event'>) {
  const incidentEvent = row.incident?.event
  if (incidentEvent) return { title: incidentEvent.title, type: incidentEvent.type }

  const entryEvent = row.checkIn?.event
  const exitEvent = row.checkOut?.event
  const first = entryEvent ?? exitEvent ?? row.event
  const second = entryEvent && exitEvent && entryEvent.id !== exitEvent.id ? exitEvent : null

  if (!first) return undefined

  return {
    title: second ? `${first.title} → ${second.title}` : first.title,
    type: second && first.type !== second.type ? `${first.type} / ${second.type}` : first.type,
  }
}

function buildAttendancePairRows(attendances: AttendanceRecord[]): AttendancePairRow[] {
  const groups = new Map<string, AttendanceGroup>()
  const incidentRows: AttendancePairRow[] = []

  for (const attendance of attendances) {
    if (isIncidentRow(attendance)) {
      incidentRows.push({
        key: attendance.id,
        user: attendance.user,
        event: attendance.event,
        eventSummary: summarizeRowEvent({ incident: attendance }),
        dateTime: attendance.time,
        incident: attendance,
      })
      continue
    }

    const key = getAttendanceDayGroupKey(attendance)
    const group = groups.get(key) ?? {
      user: attendance.user,
      attendances: [],
    }
    group.attendances.push(attendance)
    groups.set(key, group)
  }

  const rows = [...incidentRows]
  for (const [key, group] of groups) {
    const dayRows: AttendancePairRow[] = []
    const openRows: AttendancePairRow[] = []
    const ordered = [...group.attendances].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

    for (const attendance of ordered) {
      if (attendance.type === 'CHECK_IN') {
        const row: AttendancePairRow = {
          key: `${key}:in:${attendance.id}`,
          user: group.user,
          event: attendance.event,
          eventSummary: summarizeRowEvent({ checkIn: attendance }),
          dateTime: attendance.time,
          checkIn: attendance,
        }
        dayRows.push(row)
        openRows.push(row)
        continue
      }

      const attendanceTime = new Date(attendance.time).getTime()
      const openRow = openRows.find((row) => {
        if (!row.checkIn || row.checkOut) return false
        return new Date(row.checkIn.time).getTime() <= attendanceTime
      })

      if (openRow) {
        openRow.checkOut = attendance
        openRow.dateTime = attendance.time
        openRow.event = openRow.checkIn?.event ?? attendance.event
        openRow.eventSummary = summarizeRowEvent(openRow)
        continue
      }

      const row: AttendancePairRow = {
        key: `${key}:out:${attendance.id}`,
        user: group.user,
        event: attendance.event,
        eventSummary: summarizeRowEvent({ checkOut: attendance }),
        dateTime: attendance.time,
        checkOut: attendance,
      }
      dayRows.push(row)
    }

    rows.push(...dayRows)
  }

  return rows.sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime())
}

type EntryDisplayStats = {
  totalAttendances: number
  presentCount: number
  absentCount: number
  lateCount: number
  medicalLeaveCount: number
  attendanceRate: number
  lateRate: number
  absenceRate: number
  label: 'Entradas' | 'Eventos'
}

function percentage(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100)
}

function countCoveredEventsForRow(row: AttendancePairRow): number {
  const coveredEventIds = new Set([row.checkIn?.event?.id, row.checkOut?.event?.id].filter(Boolean))
  if (coveredEventIds.size > 0) return coveredEventIds.size
  return row.checkIn ? 1 : 0
}

function buildEntryDisplayStats(attendances: AttendanceRecord[], stats: AttendanceStats | null): EntryDisplayStats | null {
  if (!stats) return null

  const rows = buildAttendancePairRows(attendances)
  let presentCount = 0
  let lateCount = 0
  let coveredEvents = 0

  for (const row of rows) {
    if (row.incident || !row.checkIn) continue

    const count = countCoveredEventsForRow(row)
    if (count === 0) continue

    if (row.checkIn.status === 'PRESENT') {
      presentCount += count
      coveredEvents += count
    } else if (row.checkIn.status === 'LATE') {
      lateCount += count
      coveredEvents += count
    }
  }

  if (coveredEvents === 0) {
    return {
      totalAttendances: stats.totalAttendances,
      presentCount: stats.presentCount,
      absentCount: stats.absentCount,
      lateCount: stats.lateCount,
      medicalLeaveCount: stats.medicalLeaveCount,
      attendanceRate: stats.attendanceRate,
      lateRate: stats.lateRate,
      absenceRate: stats.absenceRate,
      label: 'Entradas',
    }
  }

  const totalAttendances = coveredEvents + stats.absentCount
  return {
    totalAttendances,
    presentCount,
    absentCount: stats.absentCount,
    lateCount,
    medicalLeaveCount: stats.medicalLeaveCount,
    attendanceRate: percentage(presentCount, totalAttendances),
    lateRate: percentage(lateCount, totalAttendances),
    absenceRate: percentage(stats.absentCount, totalAttendances),
    label: 'Eventos',
  }
}

function renderAttendanceMark(
  attendance: AttendanceRecord | undefined,
  fallback: string,
  onEdit: (attendance: AttendanceRecord) => void,
) {
  if (!attendance) {
    return <span className="text-sm text-gray-400">{fallback}</span>
  }

  return (
    <div className="space-y-2">
      <div>
        <div className="font-medium text-gray-900">{formatTimeInUruguay(attendance.time)}</div>
        {attendance.event && (
          <div className="text-xs text-gray-500">
            Planificado: {getAdminAttendancePlannedTimeLabel(attendance)}
          </div>
        )}
      </div>
      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getAdminAttendanceStatusStyle(attendance.status)}`}>
        {getAttendanceRowStatusLabel(attendance)}
      </span>
      <div>
        <button onClick={() => onEdit(attendance)} className="text-sm text-indigo-600 hover:text-indigo-900">
          Editar
        </button>
      </div>
    </div>
  )
}

function renderEventSummary(row: AttendancePairRow, expanded: boolean, onToggle: () => void) {
  if (!row.eventSummary) {
    return <span className="text-gray-400">Sin evento</span>
  }

  const entryEvent = row.checkIn?.event
  const exitEvent = row.checkOut?.event
  const hasLinkedEvents = Boolean(entryEvent || exitEvent)
  const hasDifferentEvents = Boolean(entryEvent && exitEvent && entryEvent.id !== exitEvent.id)

  return (
    <div className="min-w-[180px] space-y-2">
      <div className="flex items-start gap-2">
        {hasLinkedEvents ? (
          <button
            type="button"
            onClick={onToggle}
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label={expanded ? 'Ocultar detalle de eventos' : 'Mostrar detalle de eventos'}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
          </button>
        ) : null}
        <div>
          <div className="font-medium">{row.eventSummary.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
            <span>{row.eventSummary.type}</span>
            {hasDifferentEvents ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-100">
                Permanencia correlacionada
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {expanded && hasLinkedEvents ? (
        <div className="space-y-1.5 rounded-lg border border-slate-100 bg-slate-50/80 p-2 text-xs text-slate-700">
          {entryEvent ? (
            <div className="flex items-start gap-2">
              <span className="mt-0.5 rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">Entrada</span>
              <div className="min-w-0">
                <div className="font-medium text-slate-800">{entryEvent.title}</div>
                <div className="text-slate-500">Planificado: {getAdminAttendancePlannedTimeLabel(row.checkIn!)}</div>
              </div>
            </div>
          ) : null}
          {exitEvent ? (
            <div className="flex items-start gap-2">
              <span className="mt-0.5 rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-800">Salida</span>
              <div className="min-w-0">
                <div className="font-medium text-slate-800">{exitEvent.title}</div>
                <div className="text-slate-500">Planificado: {getAdminAttendancePlannedTimeLabel(row.checkOut!)}</div>
              </div>
            </div>
          ) : null}
          {hasDifferentEvents ? (
            <div className="pt-1 text-[11px] text-slate-500">La misma permanencia cubre eventos contiguos.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function renderAttendancesTable(
  attendances: AttendanceRecord[],
  selectedAttendanceIds: string[],
  onToggleSelectAll: () => void,
  onToggleSelect: (id: string) => void,
  expandedRowKeys: string[],
  onToggleExpandedRow: (key: string) => void,
  onEdit: (attendance: AttendanceRecord) => void,
  allSelected: boolean
) {
  if (attendances.length === 0) {
    return <div className="p-4 text-center text-gray-500 sm:p-6">No hay registros de asistencia</div>
  }

  const rows = buildAttendancePairRows(attendances)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px]">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
                aria-label="Seleccionar todas las asistencias"
              />
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usuario</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entrada</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Salida</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Evento</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notas</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rows.map((row) => {
            const ids = [row.checkIn?.id, row.checkOut?.id].filter(Boolean) as string[]
            const selected = ids.length > 0 && ids.every((id) => selectedAttendanceIds.includes(id))
            const primaryAttendance = row.incident ?? row.checkIn ?? row.checkOut

            if (!primaryAttendance) return null

            return (
              <tr key={row.key} className={row.incident ? 'bg-red-50/20' : undefined}>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {row.incident ? (
                    <span className="text-xs text-gray-400">—</span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => {
                        const idsToToggle = selected
                          ? ids.filter((id) => selectedAttendanceIds.includes(id))
                          : ids.filter((id) => !selectedAttendanceIds.includes(id))
                        idsToToggle.forEach(onToggleSelect)
                      }}
                      aria-label={`Seleccionar asistencia de ${row.user.name}`}
                    />
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <div>
                    <div className="font-medium text-gray-900">{row.user.name}</div>
                    <div className="text-gray-500">{row.user.email}</div>
                    <div className="text-xs text-gray-400">{row.user.role}</div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {formatDateInUruguay(primaryAttendance.time)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {row.incident ? (
                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getAdminAttendanceTypeStyle('INCIDENT')}`}>
                      {getAdminAttendanceTypeLabel('INCIDENT')}
                    </span>
                  ) : renderAttendanceMark(row.checkIn, 'Sin entrada', onEdit)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {row.incident ? (
                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getAdminAttendanceStatusStyle(row.incident.status)}`}>
                      {getAttendanceRowStatusLabel(row.incident)}
                    </span>
                  ) : renderAttendanceMark(row.checkOut, 'Sin salida', onEdit)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {renderEventSummary(row, expandedRowKeys.includes(row.key), () => onToggleExpandedRow(row.key))}
                </td>
                <td className="px-6 py-4 text-sm text-gray-900">
                  {row.incident
                    ? row.incident.notes || row.incident.description || '-'
                    : [row.checkIn?.notes, row.checkOut?.notes].filter(Boolean).join(' / ') || '-'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function AdminAttendance() {
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<AttendanceRecord | null>(null)
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    userId: '',
    eventId: '',
    eventType: '', // Nuevo filtro para tipo de evento
    type: '',
    status: '',
    role: '',
    userSearch: ''
  })
  const [selectedUserName, setSelectedUserName] = useState('')
  const [selectedEventName, setSelectedEventName] = useState('')
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false)
  const [isEventDropdownOpen, setIsEventDropdownOpen] = useState(false)
  const [userEvents, setUserEvents] = useState<any[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [message, setMessage] = useState('')
  const [selectedAttendanceIds, setSelectedAttendanceIds] = useState<string[]>([])
  const [expandedAttendanceRows, setExpandedAttendanceRows] = useState<string[]>([])
  const [deletingSelected, setDeletingSelected] = useState(false)
  const [activeTab, setActiveTab] = useState<'attendance' | 'incidents'>('attendance')
  const [justifyTarget, setJustifyTarget] = useState<AttendanceRecord | null>(null)

  const [stats, setStats] = useState<AttendanceStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)

  const syCtx = useOptionalAdminSchoolYear()
  const schoolYearQuery = syCtx?.schoolYearQuery ?? ''
  const showingExitStats = filters.type === 'CHECK_OUT'
  const entryDisplayStats = buildEntryDisplayStats(attendances, stats)

  useEffect(() => {
    loadAttendances()
    loadUsers()
  }, [page, filters, schoolYearQuery])

  useEffect(() => {
    if (filters.userId) {
      loadUserEvents(filters.userId)
    } else {
      setUserEvents([])
      setSelectedEventName('')
      setFilters(prev => ({ ...prev, eventId: '' }))
    }
  }, [filters.userId, filters.startDate, filters.endDate, schoolYearQuery])

  useEffect(() => {
    loadStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.startDate,
    filters.endDate,
    filters.userId,
    filters.eventType,
    filters.eventId,
    filters.type,
    filters.status,
    filters.role,
    schoolYearQuery,
  ])

  useEffect(() => {
    setSelectedAttendanceIds([])
    setExpandedAttendanceRows([])
  }, [attendances])

  async function loadAttendances() {
    setLoading(true)
    try {
      const qs = buildAdminAttendanceAllQueryString(page, filters)
      const qsWithIncidents = qs ? `${qs}&includeIncidents=true` : 'includeIncidents=true'
      const url = withSchoolYear(`/attendance/all?${qsWithIncidents}`, schoolYearQuery)
      const data = await api<{
        total: number
        page: number
        pageSize: number
        data: AttendanceRecord[]
      }>(url)
      
      setAttendances(data.data)
      setTotal(data.total)
    } catch (error) {
      console.error('Error cargando asistencias:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadStats() {
    setStatsLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.startDate) params.set('startDate', filters.startDate)
      if (filters.endDate) params.set('endDate', filters.endDate)
      if (filters.userId) params.set('userId', filters.userId)
      if (filters.eventType) params.set('eventType', filters.eventType)
      if (filters.eventId) params.set('eventId', filters.eventId)
      if (filters.type) params.set('type', filters.type)
      if (filters.status) params.set('status', filters.status)
      if (filters.role) params.set('role', filters.role)
      params.set('includeIncidents', 'true')

      const qs = params.toString()
      const base = qs ? `/attendance/stats?${qs}` : '/attendance/stats'
      const url = withSchoolYear(base, schoolYearQuery)
      const data = await api<AttendanceStats>(url)
      setStats(data)
    } catch (error) {
      console.error('Error cargando métricas:', error)
      setStats(null)
    } finally {
      setStatsLoading(false)
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

  async function loadUserEvents(userId: string) {
    if (!userId) {
      setUserEvents([])
      return
    }
    
    try {
      const params = new URLSearchParams()
      if (filters.startDate) params.set('startDate', filters.startDate)
      if (filters.endDate) params.set('endDate', filters.endDate)
      
      const q = params.toString()
      const base = q ? `/reports/user-events/${userId}?${q}` : `/reports/user-events/${userId}`
      const url = withSchoolYear(base, schoolYearQuery)
      const data = await api<any[]>(url)
      setUserEvents(data)
    } catch (error) {
      console.error('Error cargando eventos del usuario:', error)
      setUserEvents([])
    }
  }

  async function updateAttendance(id: string, status: string, notes?: string) {
    try {
      await api(`/attendance/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status, notes })
      })
      
      setMessage('✅ Asistencia actualizada correctamente')
      await loadAttendances()
      setEditing(null)
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al actualizar asistencia'}`)
    }
  }

  async function deleteSelectedAttendances() {
    if (selectedAttendanceIds.length === 0) return
    if (!confirm(`¿Estás seguro de eliminar ${selectedAttendanceIds.length} asistencias seleccionadas?`)) return

    setDeletingSelected(true)
    setMessage('')
    try {
      await Promise.all(selectedAttendanceIds.map((id) => api(`/attendance/${id}`, { method: 'DELETE' })))
      setMessage(`✅ Se eliminaron ${selectedAttendanceIds.length} asistencias seleccionadas`)
      setSelectedAttendanceIds([])
      await loadAttendances()
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al eliminar asistencias seleccionadas'}`)
    } finally {
      setDeletingSelected(false)
    }
  }

  function toggleAttendanceSelection(id: string) {
    if (id.startsWith('incident:')) return
    setSelectedAttendanceIds((prev) =>
      prev.includes(id) ? prev.filter((currentId) => currentId !== id) : [...prev, id],
    )
  }

  function toggleAllAttendancesSelection() {
    const selectableIds = attendances.filter((attendance) => !isIncidentRow(attendance)).map((attendance) => attendance.id)
    setSelectedAttendanceIds((prev) =>
      selectableIds.every((id) => prev.includes(id)) ? [] : selectableIds,
    )
  }

  function toggleExpandedAttendanceRow(key: string) {
    setExpandedAttendanceRows((prev) =>
      prev.includes(key) ? prev.filter((currentKey) => currentKey !== key) : [...prev, key],
    )
  }

  async function exportReport(format: 'excel' | 'pdf') {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
      const to = filters.endDate || new Date().toISOString().split('T')[0]

      const sanitizePart = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_')
      const shortUuid = (id: string) => (id && id.length > 10 ? id.slice(-8) : id)
      const shortText = (s: string) => (s && s.length > 18 ? s.slice(0, 18) : s)

      const userNameForFilename = (() => {
        const raw = selectedUserName
        if (raw) return raw.startsWith('@') ? raw.slice(1) : raw
        if (!filters.userId) return null
        const u = users.find((x) => x.id === filters.userId)
        if (!u) return null
        return u.name || u.username || u.email || null
      })()

      const suffixParts: string[] = []
      if (filters.role) suffixParts.push(`role-${sanitizePart(filters.role)}`)
      if (filters.userId) {
        const part = userNameForFilename ? shortText(sanitizePart(userNameForFilename)) : shortUuid(filters.userId)
        suffixParts.push(`user-${part}`)
      }
      if (filters.eventType) suffixParts.push(`eventType-${sanitizePart(filters.eventType)}`)
      if (filters.eventId) suffixParts.push(`event-${shortUuid(filters.eventId)}`)
      if (filters.type) suffixParts.push(`type-${sanitizePart(filters.type)}`)
      if (filters.status) suffixParts.push(`status-${sanitizePart(filters.status)}`)
      const filterSuffix = suffixParts.length ? `__${suffixParts.join('__')}` : ''

      const payload = {
        reportKey: 'attendance_detail',
        format: format === 'excel' ? 'XLSX' : 'PDF',
        from: filters.startDate,
        to,
        filters: {
          role: filters.role || undefined,
          userId: filters.userId || undefined,
          eventId: filters.eventId || undefined,
          eventType: filters.eventType || undefined,
          type: filters.type || undefined,
          status: filters.status || undefined,
          ...(syCtx?.allYears ? { allYears: true } : {}),
          ...(!syCtx?.allYears && (syCtx?.selectedId ?? syCtx?.activeId)
            ? { schoolYearId: syCtx.selectedId ?? syCtx.activeId }
            : {}),
        },
      }

      const res = await api<{ exportId: string }>(`/exports`, { method: 'POST', body: JSON.stringify(payload) })
      const exportId = res.exportId

      let exportDone = false
      for (let i = 0; i < 40; i++) {
        const st = await api<{ status: string; downloadUrl: string | null; errorMessage?: string }>(`/exports/${exportId}`)
        if (st.status === 'DONE') {
          exportDone = true
          break
        }
        if (st.status === 'FAILED') throw new Error(st.errorMessage || 'Error generando export')
        await new Promise((r) => setTimeout(r, 250))
      }
      if (!exportDone) throw new Error('El export tardó demasiado en generarse')

      const dl = await fetch(`${apiUrl}/exports/${exportId}/download`, { credentials: 'include' })
      if (!dl.ok) throw new Error(`Error descargando export: ${dl.status}`)

      const blob = await dl.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download =
        format === 'excel'
          ? `EduTrack_Asistencia_Detallada_${filters.startDate}_${to}${filterSuffix}.xlsx`
          : `EduTrack_Asistencia_Detallada_${filters.startDate}_${to}${filterSuffix}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      setMessage(`✅ Export ${format.toUpperCase()} generado correctamente`)
    } catch (error: any) {
      console.error('Error completo:', error)
      setMessage(`❌ Error: ${error.message || 'Error al exportar el reporte'}`)
    }
  }

  async function markAbsences() {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
      const startDate = filters.startDate || new Date().toISOString().split('T')[0]
      const endDate = filters.endDate || new Date().toISOString().split('T')[0]

      const response = await fetch(`${apiUrl}/attendance/mark-absences`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate,
          endDate,
          userId: filters.userId || undefined,
          ...(syCtx?.allYears ? { allYears: '1' } : {}),
          ...(!syCtx?.allYears && (syCtx?.selectedId ?? syCtx?.activeId)
            ? { schoolYearId: syCtx.selectedId ?? syCtx.activeId }
            : {}),
        })
      })

      if (!response.ok) {
        throw new Error('Error al marcar ausencias')
      }

      const result = await response.json()
      setMessage(`✅ ${result.message}`)
      await loadAttendances()
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al marcar ausencias'}`)
    }
  }

  return (
    <RoleGuard permission="attendance.read" permissionScope="all">
      <main className="responsive-page max-w-7xl space-y-8">
        {/* Header moderno */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <BarChart3 className="h-7 w-7 text-emerald-600" aria-hidden />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">EduTrack</h1>
              <p className="text-gray-600">Control y seguimiento del personal</p>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-2xl font-bold text-emerald-600">{total}</div>
            <div className="text-sm text-gray-600">registros totales</div>
          </div>
        </div>

        {/* Filtros modernos */}
        <div className="card">
          <div className="card-header">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <Search className="h-4 w-4 text-emerald-600" aria-hidden />
                </div>
                <h2 className="text-lg font-semibold text-gray-900">Filtros de Búsqueda</h2>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <button
                  onClick={() => exportReport('excel')}
                  className="btn-success inline-flex items-center gap-1.5 text-sm"
                >
                  <FileSpreadsheet className="h-4 w-4 shrink-0" aria-hidden />
                  Excel
                </button>
                <button
                  onClick={() => exportReport('pdf')}
                  className="btn-danger inline-flex items-center gap-1.5 text-sm"
                >
                  <FileText className="h-4 w-4 shrink-0" aria-hidden />
                  PDF
                </button>
                <button
                  onClick={markAbsences}
                  className="btn-warning inline-flex items-center gap-1.5 text-sm"
                >
                  <Clock className="h-4 w-4 shrink-0" aria-hidden />
                  Marcar Ausencias
                </button>
                <button
                  onClick={() => {
                    setFilters({
                      startDate: '',
                      endDate: '',
                      userId: '',
                      eventId: '',
                      eventType: '',
                      type: '',
                      status: '',
                      role: '',
                      userSearch: ''
                    })
                    setSelectedUserName('')
                    setSelectedEventName('')
                    setIsUserDropdownOpen(false)
                    setIsEventDropdownOpen(false)
                    setUserEvents([])
                  }}
                  className="btn-secondary inline-flex items-center gap-1.5 text-sm"
                >
                  <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                  Limpiar
                </button>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <Calendar className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                Fecha inicio
              </label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                className="input-field"
              />
            </div>
            <div>
              <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <Calendar className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                Fecha fin
              </label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                className="input-field"
              />
            </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Usuario</label>
                      <div className="relative">
                        <input
                          type="text"
                          value={filters.userSearch}
                          onChange={(e) => {
                            setFilters({ ...filters, userSearch: e.target.value, userId: '' })
                            setSelectedUserName('')
                          }}
                          onFocus={() => setIsUserDropdownOpen(true)}
                          placeholder="Buscar por username..."
                          className="w-full border border-gray-300 rounded px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                        <div 
                          className="absolute inset-y-0 right-0 flex items-center pr-2 cursor-pointer"
                          onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
                        >
                          <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                      {isUserDropdownOpen && !selectedUserName && (
                        <div className="mt-1 max-h-40 overflow-y-auto border border-gray-300 rounded bg-white shadow-lg z-10">
                          {users
                            .filter(user => 
                              !filters.userSearch || 
                              (user.username && user.username.toLowerCase().includes(filters.userSearch.toLowerCase())) ||
                              (user.name && user.name.toLowerCase().includes(filters.userSearch.toLowerCase()))
                            )
                            .map(user => (
                              <div
                                key={user.id}
                                onClick={() => {
                                  setFilters({ ...filters, userId: user.id, userSearch: user.username || user.name || '' })
                                  setSelectedUserName(user.username || user.name || '')
                                  setIsUserDropdownOpen(false)
                                }}
                                className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                              >
                                {user.username ? `@${user.username}` : (user.name || 'Sin nombre')}
                              </div>
                            ))}
                        </div>
                      )}
                      {selectedUserName && (
                        <div className="mt-1 px-3 py-2 bg-gray-100 rounded text-sm">
                          Seleccionado: {selectedUserName.startsWith('@') ? selectedUserName : `@${selectedUserName}`}
                          <button
                            onClick={() => {
                              setFilters({ ...filters, userId: '', userSearch: '' })
                              setSelectedUserName('')
                              setIsUserDropdownOpen(false)
                            }}
                            className="ml-2 text-red-600 hover:text-red-800"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Evento</label>
              <div className="relative">
                <input
                  type="text"
                  value={selectedEventName}
                  onChange={(e) => {
                    setSelectedEventName(e.target.value)
                    setFilters({ ...filters, eventId: '' })
                  }}
                  onFocus={() => setIsEventDropdownOpen(true)}
                  placeholder="Buscar evento..."
                  disabled={!filters.userId}
                  className="w-full border border-gray-300 rounded px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
                <div 
                  className="absolute inset-y-0 right-0 flex items-center pr-2 cursor-pointer"
                  onClick={() => setIsEventDropdownOpen(!isEventDropdownOpen)}
                >
                  <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              {isEventDropdownOpen && !selectedEventName && filters.userId && (
                <div className="mt-1 max-h-40 overflow-y-auto border border-gray-300 rounded bg-white shadow-lg z-10">
                  {userEvents.map(event => (
                    <div
                      key={event.id}
                      onClick={() => {
                        setFilters({ ...filters, eventId: event.id })
                        setSelectedEventName(event.title)
                        setIsEventDropdownOpen(false)
                      }}
                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                    >
                      {event.title} ({event.type})
                    </div>
                  ))}
                </div>
              )}
              {selectedEventName && (
                <div className="mt-1 px-3 py-2 bg-gray-100 rounded text-sm">
                  Seleccionado: {selectedEventName}
                  <button
                    onClick={() => {
                      setFilters({ ...filters, eventId: '' })
                      setSelectedEventName('')
                      setIsEventDropdownOpen(false)
                    }}
                    className="ml-2 text-red-600 hover:text-red-800"
                  >
                    ✕
                  </button>
                </div>
              )}
              {!filters.userId && (
                <p className="text-xs text-gray-500 mt-1">Selecciona un usuario primero</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Evento</label>
              <select
                value={filters.eventType}
                onChange={(e) => setFilters({ ...filters, eventType: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">Todos</option>
                <option value="JORNADA_LABORAL">Jornada Laboral</option>
                <option value="REUNION">Reunión</option>
                <option value="CLASE">Clase</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
              <select
                value={filters.type}
                onChange={(e) => setFilters({ ...filters, type: e.target.value, status: '' })}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">Todos</option>
                <option value="CHECK_IN">Entrada</option>
                <option value="CHECK_OUT">Salida</option>
              </select>
            </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                      <select
                        value={filters.status}
                        onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                        disabled={!filters.type}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                      >
                        <option value="">Todos</option>
                        {filters.type === 'CHECK_IN' && (
                          <>
                            <option value="PRESENT">Presente</option>
                            <option value="LATE">Tarde</option>
                            <option value="ABSENT_NOT_JUSTIFIED">Ausente (No Justificada)</option>
                            <option value="SUBSTITUTED">Suplido</option>
                            <option value="JUSTIFIED">Justificado</option>
                            <option value="ABSENT_JUSTIFIED">Ausente (Justificada)</option>
                          </>
                        )}
                        {filters.type === 'CHECK_OUT' && (
                          <>
                            <option value="EXIT">Salida</option>
                            <option value="EARLY_EXIT">Salida Anticipada</option>
                          </>
                        )}
                      </select>
                    </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rol</label>
              <select
                value={filters.role}
                onChange={(e) => setFilters({ ...filters, role: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">Todos</option>
                <option value="ADMIN">Admin</option>
                <option value="TEACHER">Teacher</option>
                <option value="STAFF">Staff</option>
              </select>
            </div>
          </div>
        </div>

        {/* Métricas (KPIs) */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 bg-white border rounded-lg shadow-sm">
            <div className="text-sm text-gray-500">{showingExitStats ? 'Tasa de Salida' : 'Tasa de Presencia'}</div>
            <div className="text-2xl font-bold text-emerald-600">
              {statsLoading || !stats
                ? '—'
                : `${showingExitStats ? stats.exitRate : entryDisplayStats?.attendanceRate ?? stats.attendanceRate}%`}
            </div>
            <div className="text-xs text-gray-500">
              {showingExitStats
                ? 'Solo salidas (CHECK_OUT) en el rango filtrado'
                : 'Eventos cubiertos por entradas correlacionadas'}
            </div>
          </div>

          <div className="p-4 bg-white border rounded-lg shadow-sm">
            <div className="text-sm text-gray-500">{showingExitStats ? 'Salidas' : 'Presentes'}</div>
            <div className="text-2xl font-bold text-emerald-600">
              {statsLoading || !stats ? '—' : showingExitStats ? stats.exitCount : entryDisplayStats?.presentCount ?? stats.presentCount}
            </div>
            <div className="text-xs text-gray-500">{showingExitStats ? 'Salidas normales' : 'Eventos presentes cubiertos'}</div>
          </div>

          <div className="p-4 bg-white border rounded-lg shadow-sm">
            <div className="text-sm text-gray-500">{showingExitStats ? 'Anticipadas' : 'Tarde'}</div>
            <div className="text-2xl font-bold text-yellow-600">
              {statsLoading || !stats ? '—' : showingExitStats ? stats.earlyExitCount : entryDisplayStats?.lateCount ?? stats.lateCount}
            </div>
            <div className="text-xs text-gray-500">
              {statsLoading || !stats ? '' : `${showingExitStats ? stats.earlyExitRate : entryDisplayStats?.lateRate ?? stats.lateRate}%`} tasa
            </div>
          </div>

          <div className="p-4 bg-white border rounded-lg shadow-sm">
            <div className="text-sm text-gray-500">{showingExitStats ? 'Total salidas' : 'Ausentes'}</div>
            <div className="text-2xl font-bold text-red-600">
              {statsLoading || !stats ? '—' : showingExitStats ? stats.totalAttendances : entryDisplayStats?.absentCount ?? stats.absentCount}
            </div>
            <div className="text-xs text-gray-500">
              {statsLoading || !stats || showingExitStats ? '' : `Justificadas: ${entryDisplayStats?.medicalLeaveCount ?? stats.medicalLeaveCount}`}
            </div>
          </div>
        </div>

        {/* Gráfico (simple) de distribución de estados */}
        <div className="bg-white border rounded-lg shadow-sm p-4 sm:p-6">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-lg font-semibold">Distribución de Estados</h3>
            <div className="text-sm text-gray-500">
              {statsLoading
                ? 'Cargando…'
                : stats
                  ? `${showingExitStats ? 'Salidas' : entryDisplayStats?.label ?? 'Entradas'}: ${
                      showingExitStats ? stats.totalAttendances : entryDisplayStats?.totalAttendances ?? stats.totalAttendances
                    }`
                  : ''}
            </div>
          </div>
          {statsLoading || !stats ? (
            <div className="text-sm text-gray-500">—</div>
          ) : (
            (() => {
              const first = showingExitStats ? stats.exitCount : entryDisplayStats?.presentCount ?? stats.presentCount
              const second = showingExitStats ? stats.earlyExitCount : entryDisplayStats?.lateCount ?? stats.lateCount
              const third = showingExitStats ? 0 : entryDisplayStats?.absentCount ?? stats.absentCount
              const max = Math.max(1, first, second, third)
              const hMax = 90
              const bar = (value: number) => (value / max) * hMax

              const bar1H = bar(first)
              const bar2H = bar(second)
              const bar3H = bar(third)

              return (
                <svg viewBox="0 0 600 140" className="w-full" role="img" aria-label="Distribución de estados">
                  <rect x="40" y="20" width="520" height="100" fill="none" stroke="#e5e7eb" rx="8" />
                  {/* Eje / baseline */}
                  <line x1="60" y1="110" x2="560" y2="110" stroke="#e5e7eb" />

                  {/* Barras */}
                  <rect x="130" y={110 - bar1H} width="90" height={bar1H} fill="#16a34a" rx="6" />
                  <rect x="255" y={110 - bar2H} width="90" height={bar2H} fill="#f59e0b" rx="6" />
                  <rect x="380" y={110 - bar3H} width="90" height={bar3H} fill="#dc2626" rx="6" />

                  {/* Labels */}
                  <text x="175" y="130" textAnchor="middle" fontSize="12" fill="#374151">
                    {showingExitStats ? `Salida (${first})` : `Presente (${first})`}
                  </text>
                  <text x="300" y="130" textAnchor="middle" fontSize="12" fill="#374151">
                    {showingExitStats ? `Anticipada (${second})` : `Tarde (${second})`}
                  </text>
                  <text x="425" y="130" textAnchor="middle" fontSize="12" fill="#374151">
                    {showingExitStats ? '' : `Ausente (${third})`}
                  </text>
                </svg>
              )
            })()
          )}
        </div>

        {message && (
          <div className={`p-3 rounded ${getAdminFlashMessageClass(message)}`}>
            {message}
          </div>
        )}

        <div className="flex gap-2 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab('attendance')}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === 'attendance'
                ? 'border-b-2 border-emerald-600 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Registros
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('incidents')}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === 'incidents'
                ? 'border-b-2 border-emerald-600 text-emerald-700'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Incidencias
          </button>
        </div>

        {activeTab === 'incidents' ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <AdminIncidentsPanel onMessage={setMessage} />
          </div>
        ) : null}

        {/* Tabla de asistencias */}
        {activeTab === 'attendance' ? (
        <div className="bg-white border rounded-lg shadow-sm">
          <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between sm:p-6">
            <h2 className="text-lg font-semibold">Registros de Asistencia</h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-gray-500">
                {selectedAttendanceIds.length === 0
                  ? 'Selecciona registros para eliminarlos'
                  : `${selectedAttendanceIds.length} seleccionadas`}
              </span>
              <button
                type="button"
                onClick={deleteSelectedAttendances}
                disabled={selectedAttendanceIds.length === 0 || deletingSelected}
                className="inline-flex items-center gap-2 rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                {deletingSelected ? 'Eliminando...' : 'Eliminar seleccionadas'}
              </button>
            </div>
          </div>
          
          {loading
            ? <div className="p-4 text-center text-gray-500 sm:p-6">Cargando...</div>
            : renderAttendancesTable(
              attendances,
              selectedAttendanceIds,
              toggleAllAttendancesSelection,
              toggleAttendanceSelection,
              expandedAttendanceRows,
              toggleExpandedAttendanceRow,
              setEditing,
              attendances.some((attendance) => !isIncidentRow(attendance)) &&
                selectedAttendanceIds.length === attendances.filter((attendance) => !isIncidentRow(attendance)).length,
            )}

          <PaginationControls page={page} total={total} onPageChange={setPage} />
        </div>
        ) : null}

        {justifyTarget ? (
          <AttendanceJustifyModal
            attendanceId={justifyTarget.id}
            teacherLabel={justifyTarget.user.name}
            onClose={() => setJustifyTarget(null)}
            onSaved={() => {
              setMessage('✅ Justificación registrada')
              void loadAttendances()
              void loadStats()
            }}
          />
        ) : null}

        {/* Modal de edición */}
        {editing && (
          <div className="responsive-modal">
            <div className="responsive-modal-panel max-w-md">
              <h3 className="text-lg font-semibold mb-4">Editar Asistencia</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                  <select
                    value={editing.status}
                    onChange={(e) => setEditing({ ...editing, status: e.target.value as AttendanceStatusOption })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {editing.type === 'CHECK_IN' ? (
                      <>
                        <option value="PRESENT">Presente</option>
                        <option value="LATE">Tarde</option>
                        <option value="ABSENT_NOT_JUSTIFIED">Ausente (No Justificada)</option>
                        <option value="ABSENT_JUSTIFIED">Ausente (Justificada)</option>
                        <option value="SUBSTITUTED">Suplido</option>
                        <option value="JUSTIFIED">Justificado</option>
                      </>
                    ) : (
                      <>
                        <option value="EXIT">Salida</option>
                        <option value="EARLY_EXIT">Salida Anticipada</option>
                      </>
                    )}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
                  <textarea
                    value={editing.notes || ''}
                    onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    rows={3}
                  />
                </div>
              </div>
              
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={() => updateAttendance(editing.id, editing.status, editing.notes)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  Guardar
                </button>
                {(editing.status === 'ABSENT_NOT_JUSTIFIED' ||
                  editing.status === 'LATE' ||
                  editing.status === 'EARLY_EXIT') && (
                  <button
                    type="button"
                    onClick={() => {
                      setJustifyTarget(editing)
                      setEditing(null)
                    }}
                    className="px-4 py-2 border border-emerald-300 text-emerald-800 rounded hover:bg-emerald-50"
                  >
                    Justificar con auditoría
                  </button>
                )}
                <button
                  onClick={() => setEditing(null)}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </RoleGuard>
  )
}
