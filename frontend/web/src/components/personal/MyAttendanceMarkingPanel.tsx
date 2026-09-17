'use client'

import { useCallback, useEffect, useState } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { formatValidationErrorFromApi } from '@/lib/api/validation-message'
import DateField from '@/components/forms/DateField'
import { formatDateInUruguay, formatTimeInUruguay, getTodayYmdInUruguay } from '@/lib/forms/datetime-uy'
import { resolveRealEventId } from '@/lib/events/event-instance-id'

type DayEvent = {
  id: string
  /** uuid de la serie cuando `id` es una instancia expandida `<uuid>_<ymd>`. */
  originalEventId?: string | null
  title: string
  type: string
  status: string
  startDate: string
  startTime?: string
  endTime?: string
  assignedUserId?: string
}

type DayAttendance = {
  id: string
  type: 'CHECK_IN' | 'CHECK_OUT'
  eventId: string | null
  date: string
  time: string
}

type Props = {
  userId: string
  onMarked?: () => void
}

function toIsoDateTime(ymd: string, timeIso?: string): string {
  const now = new Date()
  if (timeIso) {
    const t = new Date(timeIso)
    return new Date(
      Date.UTC(
        parseInt(ymd.slice(0, 4), 10),
        parseInt(ymd.slice(5, 7), 10) - 1,
        parseInt(ymd.slice(8, 10), 10),
        t.getUTCHours(),
        t.getUTCMinutes(),
        t.getUTCSeconds(),
      ),
    ).toISOString()
  }
  return now.toISOString()
}

export default function MyAttendanceMarkingPanel({ userId, onMarked }: Props) {
  const [day, setDay] = useState(getTodayYmdInUruguay())
  const [events, setEvents] = useState<DayEvent[]>([])
  const [attendances, setAttendances] = useState<DayAttendance[]>([])
  const [loading, setLoading] = useState(true)
  const [marking, setMarking] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const q = new URLSearchParams({
        startDate: day,
        endDate: day,
        type: 'CLASE',
      })
      const [evs, atts] = await Promise.all([
        api<DayEvent[]>(`/events/my-events?${q}`),
        api<DayAttendance[]>(
          `/attendance/my-attendances?startDate=${encodeURIComponent(day)}&endDate=${encodeURIComponent(day)}`,
        ),
      ])
      setEvents(evs.filter((e) => e.status !== 'CANCELLED' && e.type === 'CLASE'))
      setAttendances(atts)
    } catch (err) {
      setMessage(formatValidationErrorFromApi(err))
      setEvents([])
      setAttendances([])
    } finally {
      setLoading(false)
    }
  }, [day, userId])

  useEffect(() => {
    void load()
  }, [load])

  function hasType(event: DayEvent, type: 'CHECK_IN' | 'CHECK_OUT') {
    // `Attendance.eventId` guarda el uuid de la serie, nunca el id compuesto de la ocurrencia.
    const realId = resolveRealEventId(event)
    return attendances.some((a) => a.eventId === realId && a.type === type)
  }

  async function mark(event: DayEvent, type: 'CHECK_IN' | 'CHECK_OUT') {
    const key = `${event.id}:${type}`
    setMarking(key)
    setMessage(null)
    try {
      const instant = toIsoDateTime(day, type === 'CHECK_OUT' ? event.endTime : event.startTime)
      await api('/attendance/register', {
        method: 'POST',
        body: JSON.stringify({
          type,
          date: instant,
          time: instant,
          eventId: resolveRealEventId(event),
        }),
      })
      setMessage(type === 'CHECK_IN' ? 'Entrada registrada' : 'Salida registrada')
      await load()
      onMarked?.()
    } catch (err) {
      setMessage(formatValidationErrorFromApi(err))
    } finally {
      setMarking(null)
    }
  }

  return (
    <section className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-4 shadow-sm">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-emerald-700" aria-hidden />
          <h2 className="text-base font-semibold text-slate-900">Marcar asistencia hoy</h2>
        </div>
        <DateField
          value={day}
          onChange={setDay}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm"
          aria-label="Día a marcar"
        />
      </div>

      {message ? (
        <p className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">{message}</p>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-slate-600">No tenés clases asignadas para este día.</p>
      ) : (
        <ul className="space-y-2">
          {events.map((ev) => (
            <li
              key={ev.id}
              className="flex flex-col gap-2 rounded-lg border border-white bg-white px-3 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{ev.title}</p>
                <p className="text-xs text-slate-500">
                  {formatDateInUruguay(ev.startDate)}
                  {ev.startTime ? ` · ${formatTimeInUruguay(ev.startTime)}` : ''}
                  {ev.endTime ? ` – ${formatTimeInUruguay(ev.endTime)}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={hasType(ev, 'CHECK_IN') || marking !== null}
                  onClick={() => void mark(ev, 'CHECK_IN')}
                  className="btn-primary text-xs disabled:opacity-50"
                >
                  {marking === `${ev.id}:CHECK_IN` ? '…' : hasType(ev, 'CHECK_IN') ? 'Entrada ✓' : 'Entrada'}
                </button>
                <button
                  type="button"
                  disabled={hasType(ev, 'CHECK_OUT') || marking !== null}
                  onClick={() => void mark(ev, 'CHECK_OUT')}
                  className="btn-secondary text-xs disabled:opacity-50"
                >
                  {marking === `${ev.id}:CHECK_OUT` ? '…' : hasType(ev, 'CHECK_OUT') ? 'Salida ✓' : 'Salida'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
