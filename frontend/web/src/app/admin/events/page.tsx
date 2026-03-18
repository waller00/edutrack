'use client'
import RoleGuard from '@/components/RoleGuard'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

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

export default function AdminEvents() {
  const [events, setEvents] = useState<Event[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingEvent, setEditingEvent] = useState<Event | null>(null)
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    userId: '',
    assignedUserId: '',
    type: '',
    status: ''
  })
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [message, setMessage] = useState('')

  const [newEvent, setNewEvent] = useState({
    title: '',
    description: '',
    type: 'JORNADA_LABORAL' as const,
    startDate: new Date().toISOString().split('T')[0],
    startTime: '',
    endTime: '',
    assignedUserId: '',
    recurrenceType: 'NONE' as const,
    isRecurring: false,
    daysOfWeek: [] as number[],
    recurrenceEnd: ''
  })
  
  const [selectedRole, setSelectedRole] = useState<'TEACHER' | 'STAFF' | ''>('')

  useEffect(() => {
    loadEvents()
    loadUsers()
  }, [page, filters])

  async function loadEvents() {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: '20'
      })
      
      if (filters.startDate) params.set('startDate', filters.startDate)
      if (filters.endDate) params.set('endDate', filters.endDate)
      if (filters.userId) params.set('userId', filters.userId)
      if (filters.assignedUserId) params.set('assignedUserId', filters.assignedUserId)
      if (filters.type) params.set('type', filters.type)
      if (filters.status) params.set('status', filters.status)

      const data = await api(`/events/all?${params.toString()}`) as {
        total: number
        page: number
        pageSize: number
        data: Event[]
      }
      
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
      const data = await api('/admin/users?pageSize=100') as {
        data: User[]
      }
      setUsers(data.data)
    } catch (error) {
      console.error('Error cargando usuarios:', error)
    }
  }

  async function createEvent() {
    try {
      // Preparar datos del evento
      const eventData = {
        ...newEvent,
        recurrenceType: newEvent.isRecurring ? 'WEEKLY' : 'NONE',
        recurrenceEnd: newEvent.isRecurring && newEvent.recurrenceEnd ? newEvent.recurrenceEnd : null
      }
      
      await api('/events/', {
        method: 'POST',
        body: JSON.stringify(eventData)
      })
      
      setMessage('✅ Evento creado correctamente')
      await loadEvents()
      setCreating(false)
      setSelectedRole('')
      setNewEvent({
        title: '',
        description: '',
        type: 'JORNADA_LABORAL',
        startDate: new Date().toISOString().split('T')[0],
        startTime: '',
        endTime: '',
        assignedUserId: '',
        recurrenceType: 'NONE',
        isRecurring: false,
        daysOfWeek: [],
        recurrenceEnd: ''
      })
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al crear evento'}`)
    }
  }

  async function updateEvent(id: string, updates: Partial<Event>) {
    try {
      await api(`/events/${id}`, {
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

  async function deleteEvent(id: string) {
    if (!confirm('¿Estás seguro de que quieres eliminar este evento?')) return
    
    try {
      await api(`/events/${id}`, { method: 'DELETE' })
      setMessage('✅ Evento eliminado correctamente')
      await loadEvents()
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al eliminar evento'}`)
    }
  }

  return (
    <RoleGuard allow={['ADMIN']}>
      <main className="mx-auto max-w-7xl p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <span className="text-emerald-600 text-xl">📅</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold">Gestión de Eventos</h1>
              <p className="text-gray-600">Crear y administrar eventos</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setCreating(true)}
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
                type: '',
                status: ''
              })}
              className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded border"
            >
              Limpiar Filtros
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha inicio</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha fin</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
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

        {message && (
          <div className={`p-3 rounded ${
            message.includes('✅') ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          }`}>
            {message}
          </div>
        )}

        {/* Tabla de eventos */}
        <div className="bg-white border rounded-lg shadow-sm">
          <div className="p-6 border-b">
            <h2 className="text-lg font-semibold">Eventos</h2>
          </div>
          
          {loading ? (
            <div className="p-6 text-center text-gray-500">Cargando...</div>
          ) : events.length === 0 ? (
            <div className="p-6 text-center text-gray-500">No hay eventos</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Título</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha Inicio</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha Fin</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Asignado</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Asistencias</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div>
                          <div className="font-medium text-gray-900">{event.title}</div>
                          {event.description && (
                            <div className="text-gray-500 text-xs">{event.description}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {event.type === 'JORNADA_LABORAL' ? 'Jornada Laboral' :
                           event.type === 'REUNION' ? 'Reunión' :
                           event.type === 'CLASE' ? 'Clase' :
                           event.type === 'EVENTO' ? 'Evento' :
                           event.type === 'CAPACITACION' ? 'Capacitación' :
                           'Cita Médica'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div>
                          <div>{new Date(event.startDate).toLocaleDateString('es-ES')}</div>
                          {event.startTime && (
                            <div className="text-xs text-gray-500">
                              {new Date(event.startTime).toLocaleTimeString('es-ES', { 
                                hour: '2-digit', 
                                minute: '2-digit' 
                              })}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div>
                          {event.endDate ? (
                            <>
                              <div>{new Date(event.endDate).toLocaleDateString('es-ES')}</div>
                              {event.endTime && (
                                <div className="text-xs text-gray-500">
                                  {new Date(event.endTime).toLocaleTimeString('es-ES', { 
                                    hour: '2-digit', 
                                    minute: '2-digit' 
                                  })}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-gray-400">Sin fecha fin</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {event.assignedUser ? (
                          <div>
                            <div className="font-medium text-gray-900">{event.assignedUser.username || event.assignedUser.name}</div>
                            <div className="text-xs text-gray-500">{event.assignedUser.role}</div>
                          </div>
                        ) : (
                          <span className="text-gray-400">Sin asignar</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          event.status === 'SCHEDULED' ? 'bg-blue-100 text-blue-800' :
                          event.status === 'IN_PROGRESS' ? 'bg-yellow-100 text-yellow-800' :
                          event.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                          event.status === 'EXPIRED' ? 'bg-gray-100 text-gray-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {event.status === 'SCHEDULED' ? 'Programado' :
                           event.status === 'IN_PROGRESS' ? 'En Progreso' :
                           event.status === 'COMPLETED' ? 'Completado' :
                           event.status === 'EXPIRED' ? 'Vencido' :
                           'Cancelado'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {event._count.attendances}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex gap-2">
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
                          <button
                            onClick={() => deleteEvent(event.id)}
                            className="text-red-600 hover:text-red-900"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginación */}
          {total > 20 && (
            <div className="px-6 py-3 border-t bg-gray-50">
              <div className="flex justify-between items-center">
                <div className="text-sm text-gray-700">
                  Página {page} de {Math.ceil(total / 20)}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                    className="px-3 py-1 border rounded disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={page >= Math.ceil(total / 20)}
                    className="px-3 py-1 border rounded disabled:opacity-50"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal de creación */}
        {creating && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold mb-4">Crear Evento</h3>
              
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
                          daysOfWeek: isRecurring ? [] : [],
                          recurrenceEnd: isRecurring ? '' : ''
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
                      const role = e.target.value as 'TEACHER' | 'STAFF' | ''
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
                    onChange={(e) => setNewEvent({ ...newEvent, type: e.target.value as any })}
                    disabled={!selectedRole}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  >
                    {selectedRole === 'TEACHER' ? (
                      <>
                        <option value="CLASE">Clase</option>
                        <option value="REUNION">Reunión</option>
                      </>
                    ) : selectedRole === 'STAFF' ? (
                      <>
                        <option value="JORNADA_LABORAL">Jornada Laboral</option>
                        <option value="REUNION">Reunión</option>
                      </>
                    ) : (
                      <option value="">Selecciona un rol primero</option>
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
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hora inicio</label>
                  <input
                    type="time"
                    value={newEvent.startTime}
                    onChange={(e) => setNewEvent({ ...newEvent, startTime: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hora fin</label>
                  <input
                    type="time"
                    value={newEvent.endTime}
                    onChange={(e) => setNewEvent({ ...newEvent, endTime: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                
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
                  onClick={createEvent}
                  className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  Crear Evento
                </button>
                <button
                  onClick={() => {
                    setCreating(false)
                    setSelectedRole('')
                    setNewEvent({
                      title: '',
                      description: '',
                      type: 'JORNADA_LABORAL',
                      startDate: new Date().toISOString().split('T')[0],
                      startTime: '',
                      endTime: '',
                      assignedUserId: '',
                      recurrenceType: 'NONE',
                      isRecurring: false,
                      daysOfWeek: [],
                      recurrenceEnd: ''
                    })
                  }}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de edición */}
        {editingEvent && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold mb-4">Editar Evento</h3>
              
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
                    onChange={(e) => setEditingEvent({ ...editingEvent, type: e.target.value as any })}
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
                    onChange={(e) => setEditingEvent({ ...editingEvent, status: e.target.value as any })}
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
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hora inicio</label>
                  <input
                    type="time"
                    value={editingEvent.startTime ? editingEvent.startTime.split('T')[1].substring(0, 5) : ''}
                    onChange={(e) => setEditingEvent({ ...editingEvent, startTime: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hora fin</label>
                  <input
                    type="time"
                    value={editingEvent.endTime ? editingEvent.endTime.split('T')[1].substring(0, 5) : ''}
                    onChange={(e) => setEditingEvent({ ...editingEvent, endTime: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                
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
          </div>
        )}
      </main>
    </RoleGuard>
  )
}
