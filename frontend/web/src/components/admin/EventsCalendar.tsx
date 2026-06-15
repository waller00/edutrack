'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getTodayYmdInUruguay, formatClockHhMmInUruguayFromIso } from '@/lib/forms/datetime-uy'
import { getAdminEventStatusStyle } from '@/lib/admin/events-display'
import {
  addDaysToYmd,
  getOccurrencesForYmd,
  weekdayNumberInUruguay,
  type EventOccurrence,
  type OccurrenceEvent,
} from '@/lib/admin/event-occurrences'

export type CalendarEvent = OccurrenceEvent & {
  type?: string
  status?: string
  assignedUserId?: string | null
  assignedUser?: { id?: string; name?: string; username?: string } | null
}

const WEEKDAY_HEADERS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** Índice de columna (0=Lun … 6=Dom) para un YYYY-MM-DD. */
function mondayIndex(ymd: string): number {
  const wd = weekdayNumberInUruguay(ymd) // 0=Dom … 6=Sáb
  return wd === null ? 0 : (wd + 6) % 7
}

function firstOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`
}

function monthLabel(ymd: string): string {
  const m = Number(ymd.slice(5, 7)) - 1
  return `${MONTHS[m] ?? ''} ${ymd.slice(0, 4)}`
}

/** 42 días (6 semanas) que cubren el mes de `anchor`, empezando lunes. */
function buildMonthGrid(anchor: string): string[] {
  const first = firstOfMonth(anchor)
  const start = addDaysToYmd(first, -mondayIndex(first))
  return Array.from({ length: 42 }, (_, i) => addDaysToYmd(start, i))
}

/** 7 días de la semana de `anchor`, empezando lunes. */
function buildWeekGrid(anchor: string): string[] {
  const start = addDaysToYmd(anchor, -mondayIndex(anchor))
  return Array.from({ length: 7 }, (_, i) => addDaysToYmd(start, i))
}

function weekRangeLabel(anchor: string): string {
  const days = buildWeekGrid(anchor)
  const a = days[0]
  const b = days[6]
  return `${a.slice(8, 10)}/${a.slice(5, 7)} – ${b.slice(8, 10)}/${b.slice(5, 7)}/${b.slice(0, 4)}`
}

export default function EventsCalendar({
  events,
  nonWorkingYmds,
  onSelectOccurrence,
}: {
  events: CalendarEvent[]
  nonWorkingYmds?: Set<string>
  onSelectOccurrence?: (occ: EventOccurrence<CalendarEvent>) => void
}) {
  const today = getTodayYmdInUruguay()
  const [mode, setMode] = useState<'month' | 'week'>('month')
  const [anchor, setAnchor] = useState<string>(today)

  const days = useMemo(() => (mode === 'month' ? buildMonthGrid(anchor) : buildWeekGrid(anchor)), [mode, anchor])
  const occByDay = useMemo(() => {
    const map = new Map<string, EventOccurrence<CalendarEvent>[]>()
    for (const ymd of days) map.set(ymd, getOccurrencesForYmd(events, ymd))
    return map
  }, [days, events])

  const currentMonth = anchor.slice(0, 7)
  const step = mode === 'month' ? null : 7

  function go(delta: number) {
    if (mode === 'week') {
      setAnchor((cur) => addDaysToYmd(cur, delta * (step as number)))
      return
    }
    // Mes: avanzar al día 15 del mes vecino para no caer en bordes.
    const d = new Date(`${firstOfMonth(anchor)}T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() + delta)
    setAnchor(`${d.toISOString().slice(0, 7)}-15`)
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-100 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            aria-label="Anterior"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setAnchor(today)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            aria-label="Siguiente"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          <h2 className="ml-1 text-base font-semibold capitalize text-gray-900">
            {mode === 'month' ? monthLabel(anchor) : weekRangeLabel(anchor)}
          </h2>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-sm">
          {(['month', 'week'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 font-medium ${
                mode === m ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {m === 'month' ? 'Mes' : 'Semana'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-gray-100 bg-slate-50 text-center text-xs font-semibold text-slate-500">
        {WEEKDAY_HEADERS.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>

      <div className={`grid grid-cols-7 ${mode === 'month' ? '' : 'min-h-[60vh]'}`}>
        {days.map((ymd) => {
          const occ = occByDay.get(ymd) ?? []
          const inMonth = mode === 'week' || ymd.slice(0, 7) === currentMonth
          const isToday = ymd === today
          const nonWorking = nonWorkingYmds?.has(ymd)
          return (
            <div
              key={ymd}
              className={`min-h-[92px] border-b border-r border-gray-100 p-1.5 ${
                inMonth ? '' : 'bg-gray-50/60'
              } ${nonWorking ? 'bg-amber-50/70' : ''}`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${
                    isToday ? 'bg-emerald-600 text-white' : inMonth ? 'text-gray-700' : 'text-gray-400'
                  }`}
                >
                  {ymd.slice(8, 10)}
                </span>
                {nonWorking ? <span className="text-[10px] font-medium text-amber-700">No laborable</span> : null}
              </div>
              <div className="space-y-1">
                {occ.map((o) => {
                  const time = o.startTime ? formatClockHhMmInUruguayFromIso(o.startTime) : ''
                  return (
                    <button
                      key={`${o.event.id}_${ymd}`}
                      type="button"
                      onClick={() => onSelectOccurrence?.(o)}
                      className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium ${getAdminEventStatusStyle(
                        o.status ?? 'SCHEDULED',
                      )} ${o.suspended ? 'line-through opacity-60' : ''}`}
                      title={`${time} ${o.title}`}
                    >
                      {time ? <span className="tabular-nums">{time}</span> : null} {o.title}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
