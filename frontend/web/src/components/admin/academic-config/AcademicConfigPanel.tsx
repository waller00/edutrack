'use client'

import { useCallback, useState } from 'react'
import PeriodsTab from './PeriodsTab'
import ScalesTab from './ScalesTab'
import ActivityTypesTab from './ActivityTypesTab'

const TABS = [
  { id: 'periods', label: 'Períodos' },
  { id: 'scales', label: 'Escalas' },
  { id: 'activity-types', label: 'Tipos de actividad' },
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
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div role="tablist" aria-label="Secciones de configuración académica" className="flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((item) => {
          const selected = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`panel-${item.id}`}
              onClick={() => {
                setError(null)
                setTab(item.id)
              }}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                selected
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'periods' && <PeriodsTab onError={onError} />}
        {tab === 'scales' && <ScalesTab onError={onError} />}
        {tab === 'activity-types' && <ActivityTypesTab onError={onError} />}
      </div>
    </div>
  )
}
