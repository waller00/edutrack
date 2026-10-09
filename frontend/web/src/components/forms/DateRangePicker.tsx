'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { getTodayYmdInUruguay } from '@/lib/forms/datetime-uy'
import { ymdToDmy } from '@/lib/forms/date-mask'
import DateField from './DateField'

type DateRange = { startDate: string; endDate: string }

type Props = DateRange & {
  onChange: (range: DateRange) => void
  presets?: Array<DateRange & { label: string }>
}

// UTC keeps calendar arithmetic independent of the browser's timezone.
function calendarDate(value: string) {
  return new Date(`${value}T12:00:00Z`)
}

function ymd(date: Date) {
  return date.toISOString().slice(0, 10)
}

function rangeLabel({ startDate, endDate }: DateRange) {
  if (startDate && endDate) return startDate === endDate ? ymdToDmy(startDate) : `${ymdToDmy(startDate)} – ${ymdToDmy(endDate)}`
  if (startDate) return `Desde ${ymdToDmy(startDate)}`
  if (endDate) return `Hasta ${ymdToDmy(endDate)}`
  return 'Todo el período'
}

export default function DateRangePicker({ startDate, endDate, onChange, presets: customPresets }: Props) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange>({ startDate, endDate })
  const [choosingEnd, setChoosingEnd] = useState(false)
  const [month, setMonth] = useState(() => calendarDate(startDate || endDate || getTodayYmdInUruguay()))
  const today = getTodayYmdInUruguay()
  const invalid = !!(draft.startDate && draft.endDate && draft.startDate > draft.endDate)
  const monthLabel = new Intl.DateTimeFormat('es-UY', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(month)
  const year = month.getUTCFullYear()
  const monthIndex = month.getUTCMonth()
  const offset = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7
  const dayCount = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()

  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  function apply(range: DateRange) {
    onChange(range)
    setOpen(false)
    trigger.current?.focus()
  }

  function selectDay(value: string) {
    if (!choosingEnd || !draft.startDate) {
      setDraft({ startDate: value, endDate: '' })
      setChoosingEnd(true)
    } else {
      setDraft({ startDate: value < draft.startDate ? value : draft.startDate, endDate: value < draft.startDate ? draft.startDate : value })
      setChoosingEnd(false)
    }
  }

  const todayDate = calendarDate(today)
  const weekStart = new Date(todayDate)
  weekStart.setUTCDate(weekStart.getUTCDate() - (weekStart.getUTCDay() + 6) % 7)
  const thirtyDaysAgo = new Date(todayDate)
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 29)
  const presets = customPresets ?? [
    { label: 'Hoy', startDate: today, endDate: today },
    { label: 'Esta semana', startDate: ymd(weekStart), endDate: today },
    { label: 'Este mes', startDate: `${today.slice(0, 7)}-01`, endDate: today },
    { label: 'Últimos 30 días', startDate: ymd(thirtyDaysAgo), endDate: today },
  ]

  return (
    <div ref={root} className="relative min-w-0">
      <span id={`${id}-label`} className="mb-1 block text-sm font-medium text-slate-700">Período</span>
      <button
        ref={trigger}
        type="button"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => {
          if (!open) {
            setDraft({ startDate, endDate })
            setChoosingEnd(false)
            setMonth(calendarDate(startDate || endDate || today))
          }
          setOpen(!open)
        }}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:border-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        <span id={`${id}-value`} className="min-w-0 flex-1">{rangeLabel({ startDate, endDate })}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      </button>
      {open && (
        <div
          ref={panel}
          id={`${id}-panel`}
          role="dialog"
          aria-label="Elegir período"
          onBlur={(event) => {
            if (event.relatedTarget && !root.current?.contains(event.relatedTarget as Node)) setOpen(false)
          }}
          className="absolute left-0 z-30 mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 shadow-xl sm:w-80"
        >
          <div className="grid grid-cols-2 gap-2">
            {presets.map((preset) => (
              <button key={preset.label} type="button" onClick={() => apply({ startDate: preset.startDate, endDate: preset.endDate })} className="min-h-9 rounded-lg bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-emerald-50 hover:text-emerald-800">
                {preset.label}
              </button>
            ))}
          </div>
          <div className="my-3 flex items-center justify-between border-t border-slate-100 pt-3">
            <button type="button" aria-label="Mes anterior" onClick={() => setMonth(new Date(Date.UTC(year, monthIndex - 1, 1, 12)))} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
            <p className="text-sm font-semibold text-slate-800 first-letter:uppercase" aria-live="polite">{monthLabel}</p>
            <button type="button" aria-label="Mes siguiente" onClick={() => setMonth(new Date(Date.UTC(year, monthIndex + 1, 1, 12)))} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><ChevronRight className="h-4 w-4" aria-hidden /></button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs text-slate-500" aria-hidden>
            {['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'].map((day) => <span key={day} className="py-1">{day}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-y-1" role="group" aria-label={`Calendario de ${monthLabel}`}>
            {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} aria-hidden />)}
            {Array.from({ length: dayCount }, (_, index) => {
              const date = new Date(Date.UTC(year, monthIndex, index + 1, 12))
              const value = ymd(date)
              const edge = value === draft.startDate || value === draft.endDate
              const within = !!(draft.startDate && draft.endDate && value > draft.startDate && value < draft.endDate)
              return (
                <button
                  key={value}
                  type="button"
                  aria-label={new Intl.DateTimeFormat('es-UY', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)}
                  aria-pressed={edge || within}
                  aria-current={value === today ? 'date' : undefined}
                  onClick={() => selectDay(value)}
                  className={`min-h-9 rounded-lg text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 ${edge ? 'bg-emerald-600 font-semibold text-white' : within ? 'bg-emerald-50 text-emerald-800' : 'text-slate-700 hover:bg-slate-100'} ${value === today && !edge ? 'font-semibold underline decoration-emerald-500 underline-offset-4' : ''}`}
                >{index + 1}</button>
              )
            })}
          </div>
          <p className="my-2 text-xs text-slate-500" aria-live="polite">{choosingEnd ? 'Elegí la fecha de fin.' : 'Elegí el inicio y el fin del período.'}</p>
          <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
            <div>
              <label htmlFor={`${id}-start`} className="mb-1 block text-xs font-medium text-slate-600">Fecha inicio</label>
              <DateField id={`${id}-start`} value={draft.startDate} onChange={(value) => { setDraft({ ...draft, startDate: value }); setChoosingEnd(true) }} className="w-full min-w-0 rounded-lg border border-slate-200 px-1.5 py-2 text-xs text-slate-700" />
            </div>
            <div>
              <label htmlFor={`${id}-end`} className="mb-1 block text-xs font-medium text-slate-600">Fecha fin</label>
              <DateField id={`${id}-end`} value={draft.endDate} min={draft.startDate || undefined} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} onChange={(value) => { setDraft({ ...draft, endDate: value }); setChoosingEnd(false) }} className="w-full min-w-0 rounded-lg border border-slate-200 px-1.5 py-2 text-xs text-slate-700" />
            </div>
          </div>
          {invalid && <p id={`${id}-error`} role="alert" className="mt-2 text-xs text-red-700">La fecha de fin debe ser igual o posterior al inicio.</p>}
          <div className="mt-3 flex items-center justify-between gap-2">
            <button type="button" onClick={() => apply({ startDate: '', endDate: '' })} className="shrink-0 whitespace-nowrap text-xs font-medium text-slate-600 hover:underline">Quitar fechas</button>
            <button type="button" disabled={invalid} onClick={() => apply(draft)} className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50">Aplicar</button>
          </div>
        </div>
      )}
    </div>
  )
}
