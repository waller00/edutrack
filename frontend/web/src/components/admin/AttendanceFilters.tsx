'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import DateRangePicker from '@/components/forms/DateRangePicker'
import { normalizeSearch } from '@/components/forms/StudentCombobox'
import { getAdminAttendanceStatusLabel, type AdminAttendanceListFilters, type AdminAttendanceStatus } from '@/lib/admin/attendance-display'
import { ymdToDmy } from '@/lib/forms/date-mask'

type Option = { id: string; label: string; detail?: string; search?: string }
type Props = {
  filters: AdminAttendanceListFilters
  users: { id: string; name: string; email: string; username?: string }[]
  events: { id: string; title: string; type: string }[]
  onChange: (filters: AdminAttendanceListFilters) => void
}

const EMPTY_FILTERS: AdminAttendanceListFilters = {
  startDate: '', endDate: '', userId: '', eventId: '', eventType: '', type: '', status: '', role: '',
}
const EVENT_TYPES = [['JORNADA_LABORAL', 'Jornada laboral'], ['REUNION', 'Reunión'], ['CLASE', 'Clase']]
const ROLES = [['ADMIN', 'Administración'], ['TEACHER', 'Docente'], ['STAFF', 'Personal']]
const fieldClass = 'min-h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400'

function SearchSelect({ label, placeholder, options, value, onChange, disabled = false }: {
  label: string; placeholder: string; options: Option[]; value: string; onChange: (value: string) => void; disabled?: boolean
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const selected = options.find(option => option.id === value)
  const matching = options.filter(option => normalizeSearch(`${option.label} ${option.detail ?? ''} ${option.search ?? ''}`).includes(normalizeSearch(query)))
  const choices = [{ id: '', label: 'Todos' }, ...matching]
  function choose(next: string) { onChange(next); setOpen(false); setQuery('') }
  function show() { setOpen(true); setQuery(''); setActive(0) }
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active, open, id])

  return (
    <div className="relative min-w-0" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setQuery('') }
    }}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-slate-600">{label}</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input ref={input} id={id} role="combobox" autoComplete="off" disabled={disabled}
          aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list"
          aria-activedescendant={open && choices[active] ? `${id}-${active}` : undefined}
          placeholder={placeholder} value={open ? query : selected?.label ?? ''}
          onFocus={show} onClick={() => { if (!open) show() }}
          onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true) }}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false) }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (!open) show()
              else setActive(current => Math.max(0, Math.min(choices.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))))
            }
            if (event.key === 'Enter' && open) { event.preventDefault(); if (choices[active]) choose(choices[active].id) }
          }} className={`${fieldClass} pl-9 pr-10`} />
        <button type="button" tabIndex={-1} disabled={disabled} aria-label={`Mostrar opciones de ${label.toLowerCase()}`}
          onMouseDown={event => event.preventDefault()}
          onClick={() => { input.current?.focus(); if (open) setOpen(false); else show() }}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 disabled:cursor-not-allowed">
          <ChevronDown className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {open && !disabled && (
        <div id={`${id}-options`} role="listbox" aria-label={label} className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          {choices.map((option, index) => (
            <div key={option.id} id={`${id}-${index}`} role="option" aria-label={`${option.label}${option.detail ? ` ${option.detail}` : ''}`} aria-selected={option.id === value}
              onMouseDown={event => event.preventDefault()} onClick={() => choose(option.id)}
              className={`cursor-pointer rounded-lg px-3 py-2 text-sm ${active === index ? 'bg-emerald-50 text-emerald-900' : 'text-slate-700 hover:bg-slate-50'}`}>
              <span className="block font-medium">{option.label}</span>
              {option.detail && <span className="block text-xs text-slate-500">{option.detail}</span>}
            </div>
          ))}
          {matching.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">No hay coincidencias.</p>}
        </div>
      )}
    </div>
  )
}

export default function AttendanceFilters({ filters, users, events, onChange }: Props) {
  function update(patch: Partial<AdminAttendanceListFilters>) { onChange({ ...filters, ...patch }) }
  const moreCount = [filters.eventId, filters.eventType, filters.role].filter(Boolean).length
  const selectedUser = users.find(user => user.id === filters.userId)
  const chips: { key: string; label: string; clear: Partial<AdminAttendanceListFilters> }[] = []
  if (filters.startDate || filters.endDate) chips.push({ key: 'dates', label: [filters.startDate && `Desde ${ymdToDmy(filters.startDate)}`, filters.endDate && `hasta ${ymdToDmy(filters.endDate)}`].filter(Boolean).join(' '), clear: { startDate: '', endDate: '' } })
  if (filters.userId) chips.push({ key: 'person', label: selectedUser?.name || 'Persona seleccionada', clear: { userId: '', eventId: '' } })
  if (filters.type) chips.push({ key: 'type', label: filters.type === 'CHECK_IN' ? 'Entradas' : 'Salidas', clear: { type: '', status: '' } })
  if (filters.status) chips.push({ key: 'status', label: filters.status === 'ABSENCES' ? 'Todas las ausencias' : getAdminAttendanceStatusLabel(filters.status as AdminAttendanceStatus), clear: { status: '' } })
  if (filters.eventId) chips.push({ key: 'event', label: events.find(event => event.id === filters.eventId)?.title || 'Evento seleccionado', clear: { eventId: '' } })
  if (filters.eventType) chips.push({ key: 'activity', label: EVENT_TYPES.find(([key]) => key === filters.eventType)?.[1] || filters.eventType, clear: { eventType: '' } })
  if (filters.role) chips.push({ key: 'role', label: ROLES.find(([key]) => key === filters.role)?.[1] || filters.role, clear: { role: '' } })

  return (
    <section aria-label="Filtros de asistencia" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><SlidersHorizontal className="h-4 w-4 text-slate-400" aria-hidden />Filtrar registros</h2>
        <span className="text-xs text-slate-500">Los filtros se aplican al seleccionar</span>
      </div>
      <div className="grid grid-cols-2 items-start gap-4 xl:grid-cols-[1.1fr_1.3fr_0.8fr_1fr]">
        <div className="col-span-2 min-w-0 sm:col-span-1"><DateRangePicker startDate={filters.startDate} endDate={filters.endDate} onChange={update} /></div>
        <div className="col-span-2 min-w-0 sm:col-span-1"><SearchSelect label="Persona" placeholder="Buscar por nombre o usuario" value={filters.userId}
          options={users.map(user => ({ id: user.id, label: user.name || user.email, detail: user.username ? `@${user.username}` : user.email, search: user.email }))}
          onChange={userId => update({ userId, eventId: '' })} /></div>
        <div>
          <label htmlFor="attendance-type" className="mb-1.5 block text-xs font-medium text-slate-600">Tipo de registro</label>
          <select id="attendance-type" value={filters.type} onChange={event => update({ type: event.target.value, status: '' })} className={fieldClass}>
            <option value="">Entradas y salidas</option><option value="CHECK_IN">Entradas</option><option value="CHECK_OUT">Salidas</option>
          </select>
        </div>
        <div>
          <label htmlFor="attendance-status" className="mb-1.5 block text-xs font-medium text-slate-600">Estado</label>
          <select id="attendance-status" value={filters.status} onChange={event => update({ status: event.target.value })} disabled={!filters.type} aria-describedby={!filters.type ? 'attendance-status-help' : undefined} className={fieldClass}>
            <option value="">Todos los estados</option>
            {(filters.type === 'CHECK_IN'
              ? [['ABSENCES', 'Todas las ausencias'], ['PRESENT', 'Presente'], ['LATE', 'Tarde'], ['ABSENT_NOT_JUSTIFIED', 'Ausente sin justificar'], ['SUBSTITUTED', 'Suplida (ausencia cubierta)'], ['JUSTIFIED', 'Justificado'], ['ABSENT_JUSTIFIED', 'Ausente justificada']]
              : [['EXIT', 'Salida'], ['EARLY_EXIT', 'Salida anticipada']]
            ).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {!filters.type && <p id="attendance-status-help" className="mt-1.5 text-xs text-slate-500">Elegí entradas o salidas para filtrar por estado.</p>}
        </div>
      </div>
      <details className="group mt-4 border-t border-slate-100 pt-3">
        <summary className="flex min-h-9 w-fit cursor-pointer list-none items-center gap-2 rounded text-xs font-medium text-slate-600 hover:text-emerald-700 [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />Más filtros
          {moreCount > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">{moreCount} activos</span>}
          <span className="hidden font-normal text-slate-400 sm:inline">Evento, actividad y perfil</span>
        </summary>
        <div className="grid gap-4 pb-1 pt-3 sm:grid-cols-3">
          <div>
            <SearchSelect label="Evento" placeholder="Buscar evento" value={filters.eventId} disabled={!filters.userId}
              options={events.map(event => ({ id: event.id, label: event.title, detail: EVENT_TYPES.find(([key]) => key === event.type)?.[1] || event.type }))}
              onChange={eventId => update({ eventId })} />
            {!filters.userId && <p className="mt-1.5 text-xs text-slate-500">Seleccioná una persona primero.</p>}
          </div>
          {[{ id: 'event-type', label: 'Tipo de actividad', value: filters.eventType, options: EVENT_TYPES, change: (eventType: string) => update({ eventType }) },
            { id: 'role', label: 'Perfil', value: filters.role, options: ROLES, change: (role: string) => update({ role }) }].map(field => (
            <div key={field.id}>
              <label htmlFor={`attendance-${field.id}`} className="mb-1.5 block text-xs font-medium text-slate-600">{field.label}</label>
              <select id={`attendance-${field.id}`} value={field.value} onChange={event => field.change(event.target.value)} className={fieldClass}>
                <option value="">Todos</option>{field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          ))}
        </div>
      </details>
      {chips.length > 0 && <div aria-label="Filtros activos" className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {chips.map(chip => <button key={chip.key} type="button" aria-label={`Quitar filtro: ${chip.label}`} onClick={() => update(chip.clear)} className="inline-flex min-h-8 max-w-full items-center gap-2 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100">
          <span className="truncate">{chip.label}</span><X className="h-3 w-3 shrink-0" aria-hidden />
        </button>)}
        <button type="button" onClick={() => onChange({ ...EMPTY_FILTERS })} className="min-h-8 px-2 text-xs font-medium text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-slate-900">Limpiar filtros</button>
      </div>}
    </section>
  )
}
