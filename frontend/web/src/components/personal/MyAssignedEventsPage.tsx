'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import { useState, useEffect } from 'react'
import { MapPin } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAuth } from '@/contexts/AuthContext'
import {
  getEventTypeLabel,
  getAssignedEventStatusLabel,
  getAssignedEventStatusColor,
  getDaysOfWeekLabel,
} from '@/lib/events/assigned-event-display'
import {
  formatDateInUruguay,
  formatTimeInUruguay,
  getTodayYmdInUruguay,
} from '@/lib/forms/datetime-uy'
import DateRangePicker from '@/components/forms/DateRangePicker'
import SettingsDetails from '@/components/admin/settings/SettingsDetails'
import {
  PersonalLoading,
  PersonalError,
  PersonalPagination,
} from './PersonalPageUi'
import ModuleHeader from '@/components/common/ModuleHeader'

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
  isSubstitution?: boolean
}

function nextWeek() {
  const day = new Date(`${getTodayYmdInUruguay()}T12:00:00Z`)
  day.setUTCDate(day.getUTCDate() + 7)
  return day.toISOString().slice(0, 10)
}

export default function MyAssignedEventsPage(
  _props: { role?: 'TEACHER' | 'STAFF' } = {},
) {
  return (
    <RoleGuard permission="events.read" permissionScope="own">
      <EventsContent />
    </RoleGuard>
  )
}

function EventsContent() {
  const { me } = useAuth()
  const userId = me?.id
  const [events, setEvents] = useState<AssignedEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'upcoming' | 'all' | 'range'>('upcoming')
  const [startDate, setStartDate] = useState(getTodayYmdInUruguay())
  const [endDate, setEndDate] = useState(nextWeek())
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const rangeError =
    startDate && endDate && startDate > endDate
      ? 'La fecha de fin debe ser posterior al inicio.'
      : null
  useEffect(() => {
    if (!userId || rangeError) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (filter === 'upcoming') {
      const now = new Date(),
        end = new Date(now)
      end.setDate(end.getDate() + 7)
      params.set('startDate', now.toISOString())
      params.set('endDate', end.toISOString())
    } else if (filter === 'range') {
      if (startDate)
        params.set(
          'startDate',
          new Date(`${startDate}T00:00:00-03:00`).toISOString(),
        )
      if (endDate)
        params.set(
          'endDate',
          new Date(`${endDate}T23:59:59.999-03:00`).toISOString(),
        )
    }
    params.set('assignedUserId', userId)
    async function load() {
      try {
        const data = await api<AssignedEventRow[]>(
          `/events/my-events?${params}`,
        )
        if (!cancelled) setEvents(Array.isArray(data) ? data : [])
      } catch {
        if (!cancelled) {
          setEvents([])
          setError('No se pudo cargar tu agenda.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [userId, filter, startDate, endDate, refresh, rangeError])
  const norm = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
  const visible = events
    .filter(
      (event) =>
        (filter !== 'upcoming' ||
          ['SCHEDULED', 'IN_PROGRESS'].includes(event.status)) &&
        norm(
          `${event.title} ${event.location || ''} ${getEventTypeLabel(event.type)}`,
        ).includes(norm(search)),
    )
    .sort((a, b) =>
      filter === 'upcoming' && a.status !== b.status
        ? a.status === 'IN_PROGRESS'
          ? -1
          : 1
        : new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    )
  const safePage = Math.min(page, Math.max(1, Math.ceil(visible.length / 20)))
  return (
    <main className="responsive-page max-w-6xl space-y-5">
      <ModuleHeader id="my-agenda" />
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="Período de la agenda"
        >
          {[
            ['upcoming', 'Próximos días'],
            ['all', 'Todos'],
          ].map(([id, text]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => {
                setFilter(id as 'all' | 'upcoming')
                setStartDate(id === 'all' ? '' : getTodayYmdInUruguay())
                setEndDate(id === 'all' ? '' : nextWeek())
                setPage(1)
              }}
              className={`rounded-lg px-4 py-2 text-sm ${filter === id ? 'bg-emerald-50 font-medium text-emerald-700' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {text}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={(range) => {
              setStartDate(range.startDate)
              setEndDate(range.endDate)
              setFilter(range.startDate || range.endDate ? 'range' : 'all')
              setPage(1)
            }}
          />
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Buscar actividad
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Nombre, tipo o lugar"
              className="input-field min-h-11 text-sm"
            />
          </label>
        </div>
      </div>
      {rangeError ? (
        <p role="alert" className="text-sm text-red-700">
          {rangeError}
        </p>
      ) : loading ? (
        <PersonalLoading />
      ) : error ? (
        <PersonalError
          message={error}
          retry={() => setRefresh((value) => value + 1)}
        />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              Actividades
            </h2>
            <p className="text-xs text-slate-500">
              {visible.length} {visible.length === 1 ? 'actividad' : 'actividades'}
            </p>
          </div>
          {visible.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
              No hay actividades para mostrar
            </p>
          ) : (
            <ul className="grid items-start gap-4 lg:grid-cols-2">
              {visible
                .slice((safePage - 1) * 20, safePage * 20)
                .map((event) => (
                  <li
                    key={event.id}
                    className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="min-w-0 text-base font-semibold text-slate-900">
                        {event.title}
                      </h3>
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${getAssignedEventStatusColor(event.status)}`}
                      >
                        {getAssignedEventStatusLabel(event.status)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded-md bg-slate-50 px-2 py-1 text-slate-600">
                        {getEventTypeLabel(event.type)}
                      </span>
                      {event.isSubstitution && (
                        <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-800">
                          Suplencia
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700">
                      {formatDateInUruguay(event.startDate)}
                      {event.endDate &&
                        event.endDate !== event.startDate &&
                        ` – ${formatDateInUruguay(event.endDate)}`}
                      {event.startTime &&
                        ` · ${formatTimeInUruguay(event.startTime)}${event.endTime ? ` – ${formatTimeInUruguay(event.endTime)}` : ''}`}
                    </p>
                    {event.location && (
                      <p className="flex items-start gap-2 text-xs text-slate-500">
                        <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                        {event.location}
                      </p>
                    )}
                    {(event.description || event.isRecurring) && (
                      <SettingsDetails title={`Detalles de ${event.title}`}>
                        {event.description && (
                          <p className="text-sm text-slate-600">
                            {event.description}
                          </p>
                        )}
                        {event.isRecurring && event.daysOfWeek?.length > 0 && (
                          <p className="text-xs text-slate-500">
                            Todos los {getDaysOfWeekLabel(event.daysOfWeek)}
                            {event.recurrenceEnd &&
                              ` hasta ${formatDateInUruguay(event.recurrenceEnd)}`}
                          </p>
                        )}
                      </SettingsDetails>
                    )}
                  </li>
                ))}
            </ul>
          )}
          <PersonalPagination
            page={safePage}
            total={visible.length}
            onPage={setPage}
          />
        </>
      )}
    </main>
  )
}
