'use client'

import { useCallback, useState } from 'react'
import { Bell, BookOpen, CalendarRange, ListChecks, Ruler } from 'lucide-react'
import PeriodsTab from './PeriodsTab'
import ScalesTab from './ScalesTab'
import ActivityTypesTab from './ActivityTypesTab'
import AlertRulesTab from './AlertRulesTab'
import GradeBooksTab from './GradeBooksTab'

const TABS = [
  { id: 'periods', label: 'Períodos', icon: CalendarRange },
  { id: 'scales', label: 'Escalas', icon: Ruler },
  { id: 'activity-types', label: 'Tipos de actividad', icon: ListChecks },
  { id: 'alerts', label: 'Alertas', icon: Bell },
  { id: 'gradebooks', label: 'Libretas', icon: BookOpen },
] as const

type TabId = (typeof TABS)[number]['id']

export default function AcademicConfigPanel() {
  const [tab, setTab] = useState<TabId>('periods')
  const [error, setError] = useState<string | null>(null)

  // Referencia estable: los tabs la reciben como dependencia de su `useCallback` de carga y,
  // sin memoizar, cada render dispararía un fetch nuevo.
  const onError = useCallback((message: string) => setError(message), [])

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <div
        role="tablist"
        aria-label="Secciones de configuración académica"
        className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-2 sm:grid-cols-5"
      >
        {TABS.map((item) => {
          const selected = tab === item.id
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onKeyDown={(event) => {
                const index = TABS.findIndex((entry) => entry.id === tab)
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? TABS.length - 1
                      : event.key === 'ArrowRight'
                        ? (index + 1) % TABS.length
                        : event.key === 'ArrowLeft'
                          ? (index + TABS.length - 1) % TABS.length
                          : null
                if (next === null) return
                event.preventDefault()
                setError(null)
                setTab(TABS[next].id)
                document.getElementById(`tab-${TABS[next].id}`)?.focus()
              }}
              onClick={() => {
                setError(null)
                setTab(item.id)
              }}
              className={`${item.id === 'gradebooks' ? 'col-span-2 sm:col-span-1' : ''} flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm font-medium transition ${
                selected
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {item.label}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'periods' && <PeriodsTab onError={onError} />}
        {tab === 'scales' && <ScalesTab onError={onError} />}
        {tab === 'activity-types' && <ActivityTypesTab onError={onError} />}
        {tab === 'alerts' && <AlertRulesTab onError={onError} />}
        {tab === 'gradebooks' && <GradeBooksTab onError={onError} />}
      </div>
    </div>
  )
}
