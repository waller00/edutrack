'use client'
import RoleGuard from '@/components/RoleGuard'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'

type Event = {
  id: string
  title: string
  description?: string
  type: 'JORNADA_LABORAL' | 'REUNION' | 'CLASE' | 'EVENTO' | 'CAPACITACION' | 'CITA_MEDICA'
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  startDate: string
  endDate?: string
  startTime?: string
  endTime?: string
  location?: string
  isRecurring: boolean
  daysOfWeek: number[]
  recurrenceEnd?: string
  user: {
    id: string
    name: string
    email: string
    role: string
  }
  assignedUser?: {
    id: string
    name: string
    email: string
    role: string
  }
}

export default function TeacherEvents() {
  const [me, setMe] = useState<any>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'upcoming' | 'all'>('upcoming')
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())

  useEffect(() => {
    api('/auth/me')
      .then((u: any) => {
        setMe(u)
        setLoading(false)
      })
      .catch(() => {
        window.location.href = '/login'
      })
  }, [])

  useEffect(() => {
    if (me) {
      loadEvents()
    }
  }, [me, filter])

  async function loadEvents() {
    setLoading(true)
    try {
      const now = new Date()
      let startDate = ''
      let endDate = ''

      if (filter === 'upcoming') {
        // Para "Próximos" ahora mostramos esta semana
        const startOfWeek = new Date(now)
        startOfWeek.setDate(now.getDate() - now.getDay() + 1) // Lunes
        startOfWeek.setHours(0, 0, 0, 0)
        
        const endOfWeek = new Date(startOfWeek)
        endOfWeek.setDate(startOfWeek.getDate() + 6) // Domingo
        endOfWeek.setHours(23, 59, 59, 999)
        
        startDate = startOfWeek.toISOString()
        endDate = endOfWeek.toISOString()
      }

      const params = new URLSearchParams()
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      params.set('assignedUserId', me.id)

      const data = await api(`/events/my-events?${params.toString()}`) as Event[]
      setEvents(data)
    } catch (error) {
      console.error('Error cargando eventos:', error)
    } finally {
      setLoading(false)
    }
  }

  function getEventTypeLabel(type: string) {
    switch (type) {
      case 'CLASE': return 'Clase'
      case 'REUNION': return 'Reunión'
      case 'JORNADA_LABORAL': return 'Jornada Laboral'
      case 'EVENTO': return 'Evento'
      case 'CAPACITACION': return 'Capacitación'
      case 'CITA_MEDICA': return 'Cita Médica'
      default: return type
    }
  }

  function getStatusLabel(status: string) {
    switch (status) {
      case 'SCHEDULED': return 'Programado'
      case 'IN_PROGRESS': return 'En Progreso'
      case 'COMPLETED': return 'Completado'
      case 'CANCELLED': return 'Cancelado'
      default: return status
    }
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'SCHEDULED': return 'bg-blue-100 text-blue-800'
      case 'IN_PROGRESS': return 'bg-yellow-100 text-yellow-800'
      case 'COMPLETED': return 'bg-green-100 text-green-800'
      case 'CANCELLED': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  function getDaysOfWeekLabel(daysOfWeek: number[]) {
    if (!daysOfWeek || daysOfWeek.length === 0) return ''
    
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
    return daysOfWeek.map(day => dayNames[day]).join(', ')
  }

  function toggleEventExpansion(eventId: string) {
    const newExpanded = new Set(expandedEvents)
    if (newExpanded.has(eventId)) {
      newExpanded.delete(eventId)
    } else {
      newExpanded.add(eventId)
    }
    setExpandedEvents(newExpanded)
  }

  if (loading) return <p>Cargando...</p>

  return (
    <RoleGuard allow={['TEACHER']}>
      <main className="mx-auto max-w-6xl p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <span className="text-emerald-600 text-xl">📅</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold">Mis Eventos</h1>
              <p className="text-sm text-gray-600">Consulta tus eventos asignados</p>
            </div>
          </div>
          <div className="text-sm text-gray-500">
            Total: {events.length} eventos
          </div>
        </div>

        {/* Filtros */}
        <div className="bg-white border rounded-lg p-4 shadow-sm">
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('upcoming')}
              className={`px-4 py-2 rounded text-sm font-medium ${
                filter === 'upcoming' 
                  ? 'bg-indigo-600 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Esta Semana
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded text-sm font-medium ${
                filter === 'all' 
                  ? 'bg-indigo-600 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Todos
            </button>
          </div>
        </div>

        {/* Lista de eventos */}
        <div className="bg-white border rounded-lg shadow-sm">
          <div className="p-6 border-b">
            <h2 className="text-lg font-semibold">Eventos</h2>
          </div>
          
          {events.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              No hay eventos para mostrar
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {events.map((event) => {
                const isExpanded = expandedEvents.has(event.id)
                return (
                  <div key={event.id} className="p-6 hover:bg-gray-50">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        {/* Información básica siempre visible */}
                        <div className="flex items-center gap-3 mb-3">
                          <h3 className="text-lg font-semibold text-gray-900">{event.title}</h3>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(event.status)}`}>
                            {getStatusLabel(event.status)}
                          </span>
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {getEventTypeLabel(event.type)}
                          </span>
                        </div>
                        
                        {/* Fecha y horario siempre visibles */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-3">
                          <div>
                            <span className="font-medium text-gray-700">Fecha:</span>
                            <div className="text-gray-900">
                              {new Date(event.startDate).toLocaleDateString('es-ES')}
                              {event.endDate && event.endDate !== event.startDate && (
                                <span> - {new Date(event.endDate).toLocaleDateString('es-ES')}</span>
                              )}
                            </div>
                          </div>
                          
                          {event.startTime && (
                            <div>
                              <span className="font-medium text-gray-700">Horario:</span>
                              <div className="text-gray-900">
                                {new Date(event.startTime).toLocaleTimeString('es-ES', { 
                                  hour: '2-digit', 
                                  minute: '2-digit' 
                                })}
                                {event.endTime && (
                                  <span> - {new Date(event.endTime).toLocaleTimeString('es-ES', { 
                                    hour: '2-digit', 
                                    minute: '2-digit' 
                                  })}</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        
                        {/* Información expandible */}
                        {isExpanded && (
                          <div className="space-y-3 border-t pt-3">
                            {event.description && (
                              <div>
                                <span className="font-medium text-gray-700">Descripción:</span>
                                <p className="text-gray-600 mt-1">{event.description}</p>
                              </div>
                            )}
                            
                            {event.location && (
                              <div>
                                <span className="font-medium text-gray-700">Ubicación:</span>
                                <div className="text-gray-900 mt-1">{event.location}</div>
                              </div>
                            )}
                            
                            {event.isRecurring && event.daysOfWeek && event.daysOfWeek.length > 0 && (
                              <div>
                                <span className="font-medium text-gray-700">Repetición:</span>
                                <div className="text-gray-900 mt-1">
                                  Todos los {getDaysOfWeekLabel(event.daysOfWeek)}
                                  {event.recurrenceEnd && (
                                    <span> hasta {new Date(event.recurrenceEnd).toLocaleDateString('es-ES')}</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      
                      {/* Botón de expansión */}
                      <button
                        onClick={() => toggleEventExpansion(event.id)}
                        className="ml-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title={isExpanded ? 'Contraer detalles' : 'Expandir detalles'}
                      >
                        <svg 
                          className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} 
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </RoleGuard>
  )
}
