'use client'

import RoleGuard from '@/components/RoleGuard'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import {
  getEventTypeLabel,
  getAssignedEventStatusLabel,
  getAssignedEventStatusColor,
  getDaysOfWeekLabel,
} from '@/lib/assigned-event-display'

export type AssignedEventRow = {
  id: string
  title: string
  description?: string
  type: string
  status: string
  startDate: string
  endDate?: string
  startTime?: string
  endTime?: string
  location?: string
  isRecurring: boolean
  daysOfWeek: number[]
  recurrenceEnd?: string
  user: { id: string; name: string; email: string; role: string }
  assignedUser?: { id: string; name: string; email: string; role: string }
}

export default function MyAssignedEventsPage({ role }: { role: 'TEACHER' | 'STAFF' }) {
  const [me, setMe] = useState<{ id: string } | null>(null)
  const [events, setEvents] = useState<AssignedEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'upcoming' | 'all'>('upcoming')
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())

  useEffect(() => {
    api<{ id: string }>('/auth/me')
      .then((u: { id: string }) => {
        setMe(u)
        setLoading(false)
      })
      .catch(() => {
        window.location.href = '/login'
      })
  }, [])

  useEffect(() => {
    if (!me) return
    let cancelled = false
    async function loadEvents() {
      setLoading(true)
      try {
        const now = new Date()
        let startDate = ''
        let endDate = ''
        if (filter === 'upcoming') {
          // Próximos móviles: desde "ahora" hasta +7 días.
          const to = new Date(now)
          to.setDate(to.getDate() + 7)
          startDate = now.toISOString()
          endDate = to.toISOString()
        }
        const params = new URLSearchParams()
        if (startDate) params.set('startDate', startDate)
        if (endDate) params.set('endDate', endDate)
        params.set('assignedUserId', me!.id)
        const data = await api<AssignedEventRow[]>(`/events/my-events?${params.toString()}`)
        if (!cancelled) setEvents(data)
      } catch (e) {
        console.error('Error cargando eventos:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadEvents()
    return () => {
      cancelled = true
    }
  }, [me, filter])

  function toggleEventExpansion(eventId: string) {
    setExpandedEvents((prev) => {
      const next = new Set(prev)
      if (next.has(eventId)) next.delete(eventId)
      else next.add(eventId)
      return next
    })
  }

  if (loading) return <p>Cargando...</p>

  const visibleEvents =
    filter === 'upcoming'
      ? events
          .filter((e) => e.status === 'SCHEDULED' || e.status === 'IN_PROGRESS')
          .sort((a, b) => {
            // IN_PROGRESS primero; luego por fecha/hora ascendente.
            if (a.status !== b.status) return a.status === 'IN_PROGRESS' ? -1 : 1
            return new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
          })
      : events

  return (
    <RoleGuard allow={[role]}>
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
          <div className="text-sm text-gray-500">Total: {visibleEvents.length} eventos</div>
        </div>

        <div className="bg-white border rounded-lg p-4 shadow-sm">
          <div className="flex gap-2">
            <button
              type="button"
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
              type="button"
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

        <div className="bg-white border rounded-lg shadow-sm">
          <div className="p-6 border-b">
            <h2 className="text-lg font-semibold">Eventos</h2>
          </div>
          {visibleEvents.length === 0 ? (
            <div className="p-6 text-center text-gray-500">No hay eventos para mostrar</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {visibleEvents.map((event) => {
                const isExpanded = expandedEvents.has(event.id)
                return (
                  <div key={event.id} className="p-6 hover:bg-gray-50">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                          <h3 className="text-lg font-semibold text-gray-900">{event.title}</h3>
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${getAssignedEventStatusColor(event.status)}`}
                          >
                            {getAssignedEventStatusLabel(event.status)}
                          </span>
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {getEventTypeLabel(event.type)}
                          </span>
                        </div>
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
                                  minute: '2-digit',
                                })}
                                {event.endTime && (
                                  <span>
                                    {' '}
                                    -{' '}
                                    {new Date(event.endTime).toLocaleTimeString('es-ES', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
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
                            {event.isRecurring && event.daysOfWeek?.length > 0 && (
                              <div>
                                <span className="font-medium text-gray-700">Repetición:</span>
                                <div className="text-gray-900 mt-1">
                                  Todos los {getDaysOfWeekLabel(event.daysOfWeek)}
                                  {event.recurrenceEnd && (
                                    <span>
                                      {' '}
                                      hasta {new Date(event.recurrenceEnd).toLocaleDateString('es-ES')}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
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
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
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
