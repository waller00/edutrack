'use client'

import Link from 'next/link'
import { useAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { Loader2 } from 'lucide-react'

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { loading, years, activeId, selectedId, allYears, setSelectedId, setAllYears, schoolYearQuery } =
    useAdminSchoolYear()

  return (
    <div className="min-h-screen bg-slate-50/80">
      <div className="border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <span className="text-sm font-semibold text-gray-800 shrink-0">Ciclo lectivo</span>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-emerald-600" aria-hidden />
            ) : (
              <select
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm min-w-[200px] max-w-full disabled:opacity-50"
                disabled={allYears}
                value={selectedId ?? activeId ?? ''}
                onChange={(e) => setSelectedId(e.target.value || null)}
                aria-label="Seleccionar ciclo lectivo"
              >
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.code} — {y.label}
                    {y.status === 'ACTIVE' ? ' (activo institucional)' : ''}
                  </option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={allYears} onChange={(e) => setAllYears(e.target.checked)} />
              Ver todos los ciclos (sin filtrar)
            </label>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="hidden sm:inline">Filtro API:</span>
            <code className="rounded bg-slate-100 px-2 py-0.5 max-w-[220px] truncate">{schoolYearQuery || '—'}</code>
            <Link href="/admin/school-years/compare" className="text-emerald-700 hover:underline shrink-0">
              Comparar ciclos
            </Link>
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}
