'use client'
import PaginationControls from '@/components/PaginationControls'
import RoleGuard from '@/components/RoleGuard'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import {
  buildAdminAttendanceAllQueryString,
  buildAttendanceExportReportQueryString,
  getAdminAttendanceDefaultStartDate,
  getAdminAttendancePlannedTimeLabel,
  getAdminAttendanceStatusLabel,
  getAdminAttendanceStatusStyle,
  getAdminAttendanceTypeLabel,
  getAdminAttendanceTypeStyle,
} from '@/lib/admin-attendance-display'
import { getAdminFlashMessageClass } from '@/lib/admin-ui-helpers'
import {
  BarChart3,
  Calendar,
  Clock,
  FileSpreadsheet,
  FileText,
  Search,
  Trash2,
} from 'lucide-react'

type AttendanceRecord = {
  id: string
  type: 'CHECK_IN' | 'CHECK_OUT'
  status: 'PRESENT' | 'LATE' | 'ABSENT_NOT_JUSTIFIED' | 'ABSENT_JUSTIFIED' | 'EXIT' | 'EARLY_EXIT'
  date: string
  time: string
  notes?: string
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
  attendanceRate: number
  lateRate: number
  absenceRate: number
}

type User = {
  id: string
  name: string
  email: string
  role: string
  username?: string
}

type AttendanceStatusOption = AttendanceRecord['status']
type AttendanceTypeOption = AttendanceRecord['type']

function renderAttendancesTable(
  attendances: AttendanceRecord[],
  onEdit: (attendance: AttendanceRecord) => void,
  onDelete: (id: string) => void
) {
  if (attendances.length === 0) {
    return <div className="p-6 text-center text-gray-500">No hay registros de asistencia</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usuario</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Hora</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Evento</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notas</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {attendances.map((attendance) => (
            <tr key={attendance.id}>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                <div>
                  <div className="font-medium text-gray-900">{attendance.user.name}</div>
                  <div className="text-gray-500">{attendance.user.email}</div>
                  <div className="text-xs text-gray-400">{attendance.user.role}</div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {new Date(attendance.date).toLocaleDateString('es-ES')}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                <div className="flex flex-col">
                  <div className="font-medium">
                    {new Date(attendance.time).toLocaleTimeString('es-ES', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                  {attendance.event && (
                    <div className="text-xs text-gray-500">
                      Planificado: {getAdminAttendancePlannedTimeLabel(attendance)}
                    </div>
                  )}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {attendance.event ? (
                  <div>
                    <div className="font-medium">{attendance.event.title}</div>
                    <div className="text-xs text-gray-500">{attendance.event.type}</div>
                  </div>
                ) : (
                  <span className="text-gray-400">Sin evento</span>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getAdminAttendanceTypeStyle(attendance.type)}`}>
                  {getAdminAttendanceTypeLabel(attendance.type)}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getAdminAttendanceStatusStyle(attendance.status)}`}>
                  {getAdminAttendanceStatusLabel(attendance.status)}
                </span>
              </td>
              <td className="px-6 py-4 text-sm text-gray-900">
                {attendance.notes || '-'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                <div className="flex gap-2">
                  <button onClick={() => onEdit(attendance)} className="text-indigo-600 hover:text-indigo-900">
                    Editar
                  </button>
                  <button onClick={() => onDelete(attendance.id)} className="text-red-600 hover:text-red-900">
                    Eliminar
                  </button>
                </div>
              </td>
            </tr>
          ))}
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
    startDate: getAdminAttendanceDefaultStartDate(),
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

  const [stats, setStats] = useState<AttendanceStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)

  useEffect(() => {
    loadAttendances()
    loadUsers()
  }, [page, filters])

  useEffect(() => {
    if (filters.userId) {
      loadUserEvents(filters.userId)
    } else {
      setUserEvents([])
      setSelectedEventName('')
      setFilters(prev => ({ ...prev, eventId: '' }))
    }
  }, [filters.userId, filters.startDate, filters.endDate])

  useEffect(() => {
    loadStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.startDate, filters.endDate, filters.userId, filters.eventType, filters.eventId, filters.type, filters.status, filters.role])

  async function loadAttendances() {
    setLoading(true)
    try {
      const qs = buildAdminAttendanceAllQueryString(page, filters)
      const data = await api<{
        total: number
        page: number
        pageSize: number
        data: AttendanceRecord[]
      }>(`/attendance/all?${qs}`)
      
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

      const qs = params.toString()
      const url = qs ? `/attendance/stats?${qs}` : '/attendance/stats'
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
      
      const data = await api<any[]>(`/reports/user-events/${userId}?${params.toString()}`)
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

  async function deleteAttendance(id: string) {
    if (!confirm('¿Estás seguro de que quieres eliminar esta asistencia?')) return
    
    try {
      await api(`/attendance/${id}`, { method: 'DELETE' })
      setMessage('✅ Asistencia eliminada correctamente')
      await loadAttendances()
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al eliminar asistencia'}`)
    }
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
        },
      }

      const res = await api<{ exportId: string }>(`/exports`, { method: 'POST', body: JSON.stringify(payload) })
      const exportId = res.exportId

      for (let i = 0; i < 40; i++) {
        const st = await api<{ status: string; downloadUrl: string | null }>(`/exports/${exportId}`)
        if (st.status === 'DONE') break
        await new Promise((r) => setTimeout(r, 250))
      }

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
          userId: filters.userId || undefined
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
    <RoleGuard allow={['ADMIN']}>
      <main className="mx-auto max-w-7xl p-6 space-y-8">
        {/* Header moderno */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <BarChart3 className="h-7 w-7 text-emerald-600" aria-hidden />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">EduTrack</h1>
              <p className="text-gray-600">Control y seguimiento del personal</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-emerald-600">{total}</div>
            <div className="text-sm text-gray-600">registros totales</div>
          </div>
        </div>

        {/* Filtros modernos */}
        <div className="card">
          <div className="card-header">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <Search className="h-4 w-4 text-emerald-600" aria-hidden />
                </div>
                <h2 className="text-lg font-semibold text-gray-900">Filtros de Búsqueda</h2>
              </div>
              <div className="flex gap-2">
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
                      startDate: getAdminAttendanceDefaultStartDate(),
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
            <div className="text-sm text-gray-500">Tasa de Presencia</div>
            <div className="text-2xl font-bold text-emerald-600">
              {statsLoading || !stats || typeof stats.attendanceRate !== 'number' ? '—' : `${stats.attendanceRate}%`}
            </div>
            <div className="text-xs text-gray-500">Sobre el rango filtrado</div>
          </div>

          <div className="p-4 bg-white border rounded-lg shadow-sm">
            <div className="text-sm text-gray-500">Presentes</div>
            <div className="text-2xl font-bold text-emerald-600">
              {statsLoading || !stats || typeof stats.presentCount !== 'number' ? '—' : stats.presentCount}
            </div>
            <div className="text-xs text-gray-500">Cantidad de registros</div>
          </div>

          <div className="p-4 bg-white border rounded-lg shadow-sm">
            <div className="text-sm text-gray-500">Tarde</div>
            <div className="text-2xl font-bold text-yellow-600">
              {statsLoading || !stats || typeof stats.lateCount !== 'number' ? '—' : stats.lateCount}
            </div>
            <div className="text-xs text-gray-500">
              {statsLoading || !stats || typeof stats.lateRate !== 'number' ? '' : `${stats.lateRate}%`} tasa
            </div>
          </div>

          <div className="p-4 bg-white border rounded-lg shadow-sm">
            <div className="text-sm text-gray-500">Ausentes</div>
            <div className="text-2xl font-bold text-red-600">
              {statsLoading || !stats || typeof stats.absentCount !== 'number' ? '—' : stats.absentCount}
            </div>
            <div className="text-xs text-gray-500">
              {statsLoading || !stats || typeof stats.medicalLeaveCount !== 'number' ? '' : `Justificadas: ${stats.medicalLeaveCount}`}
            </div>
          </div>
        </div>

        {/* Gráfico (simple) de distribución de estados */}
        <div className="bg-white border rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h3 className="text-lg font-semibold">Distribución de Estados</h3>
            <div className="text-sm text-gray-500">
              {statsLoading ? 'Cargando…' : stats ? `Total: ${stats.totalAttendances}` : ''}
            </div>
          </div>
          {statsLoading || !stats ? (
            <div className="text-sm text-gray-500">—</div>
          ) : (
            (() => {
              const present = stats.presentCount
              const late = stats.lateCount
              const absent = stats.absentCount
              const max = Math.max(1, present, late, absent)
              const hMax = 90
              const bar = (value: number) => (value / max) * hMax

              const bar1H = bar(present)
              const bar2H = bar(late)
              const bar3H = bar(absent)

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
                    Presente ({present})
                  </text>
                  <text x="300" y="130" textAnchor="middle" fontSize="12" fill="#374151">
                    Tarde ({late})
                  </text>
                  <text x="425" y="130" textAnchor="middle" fontSize="12" fill="#374151">
                    Ausente ({absent})
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

        {/* Tabla de asistencias */}
        <div className="bg-white border rounded-lg shadow-sm">
          <div className="p-6 border-b">
            <h2 className="text-lg font-semibold">Registros de Asistencia</h2>
          </div>
          
          {loading
            ? <div className="p-6 text-center text-gray-500">Cargando...</div>
            : renderAttendancesTable(attendances, setEditing, deleteAttendance)}

          <PaginationControls page={page} total={total} onPageChange={setPage} />
        </div>

        {/* Modal de edición */}
        {editing && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
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
              
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => updateAttendance(editing.id, editing.status, editing.notes)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  Guardar
                </button>
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
