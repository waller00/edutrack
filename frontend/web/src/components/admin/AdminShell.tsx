'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { Loader2 } from 'lucide-react'

const SCHOOL_YEAR_SCOPED_ADMIN_ROUTES = [
  '/admin/attendance',
  '/admin/events',
  '/admin/courses',
  '/admin/students',
  '/admin/analytics',
]

export function adminRouteUsesSchoolYear(pathname: string | null): boolean {
  if (!pathname) return false
  return SCHOOL_YEAR_SCOPED_ADMIN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { loading, years, activeId, selectedId, allYears, setSelectedId, setAllYears } = useAdminSchoolYear()
  const pathname = usePathname()
  const showSchoolYearFilter = adminRouteUsesSchoolYear(pathname)

  return (
    <div className="min-h-screen bg-slate-50/80">
      {showSchoolYearFilter ? (
        <div className="border-b border-gray-200 bg-white shadow-sm">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <span className="text-sm font-semibold text-gray-800 shrink-0">Ciclo lectivo</span>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin text-emerald-600" aria-hidden />
              ) : (
                <select
                  className="w-full min-w-0 rounded-lg border border-gray-200 px-3 py-1.5 text-sm disabled:opacity-50 sm:w-auto sm:min-w-[200px]"
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
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
              <Link href="/admin/school-years" className="text-emerald-700 hover:underline shrink-0">
                Gestionar ciclos
              </Link>
            </div>
          </div>
        </div>
      ) : null}
      {children}
    </div>
  )
}
