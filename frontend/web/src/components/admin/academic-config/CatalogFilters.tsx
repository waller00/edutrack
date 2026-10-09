'use client'

import { Search } from 'lucide-react'
import { useId } from 'react'

export type CatalogStatus = 'active' | 'inactive' | 'all'

export function matchesCatalog(
  item: { name: string; code: string; isActive: boolean },
  search: string,
  status: CatalogStatus,
) {
  const normalize = (text: string) =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
  return (
    (status === 'all' || item.isActive === (status === 'active')) &&
    normalize(`${item.name} ${item.code}`).includes(normalize(search))
  )
}

export default function CatalogFilters({
  items,
  search,
  status,
  onSearch,
  onStatus,
  label,
}: {
  items: { isActive: boolean }[]
  search: string
  status: CatalogStatus
  onSearch: (value: string) => void
  onStatus: (value: CatalogStatus) => void
  label: string
}) {
  const id = useId()
  const active = items.filter((item) => item.isActive).length
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="w-full sm:max-w-sm">
        <label
          htmlFor={id}
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          {label}
        </label>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400"
          />
          <input
            id={id}
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Nombre o código"
            className="input-field min-h-11 !pl-9 text-sm"
          />
        </div>
      </div>
      <div
        role="group"
        aria-label="Estado"
        className="flex flex-wrap gap-1 rounded-lg bg-slate-50 p-1"
      >
        {(
          [
            ['all', 'Todos', items.length],
            ['active', 'Activos', active],
            ['inactive', 'Inactivos', items.length - active],
          ] as const
        ).map(([value, text, count]) => (
          <button
            key={value}
            type="button"
            aria-pressed={status === value}
            onClick={() => onStatus(value)}
            className={`rounded-md px-3 py-2 text-sm transition ${status === value ? 'bg-emerald-50 font-medium text-emerald-700 shadow-sm' : 'text-slate-600 hover:bg-white'}`}
          >
            {text} <span className="text-xs">({count})</span>
          </button>
        ))}
      </div>
    </div>
  )
}
