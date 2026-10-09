'use client'

import Link from 'next/link'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { CalendarDays, Loader2, Settings2 } from 'lucide-react'
import { useAdminSchoolYear, type SchoolYearApiRow } from '@/contexts/AdminSchoolYearContext'
import { useSidebarSlot } from '@/components/navigation/sidebar-slot'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'

const SCHOOL_YEAR_SCOPED_ADMIN_ROUTES = [
  '/admin/attendance',
  '/admin/events',
  '/admin/courses',
  '/admin/students',
  '/admin/student-attendance',
  '/libreta',
  '/admin/analytics',
  '/admin/licenses',
]

/** "Todos los ciclos" es una opción más del selector: antes era una casilla aparte. */
const ALL_YEARS_VALUE = '__all__'

export function adminRouteUsesSchoolYear(pathname: string | null): boolean {
  if (!pathname) return false
  return SCHOOL_YEAR_SCOPED_ADMIN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

function yearOptionLabel(year: SchoolYearApiRow): string {
  return `${year.code} — ${year.label}${year.status === 'ACTIVE' ? ' · activo' : ''}`
}

function SchoolYearSelect({ id, className, ariaLabel }: { id: string; className: string; ariaLabel?: string }) {
  const { loading, years, activeId, selectedId, allYears, setSelectedId, setAllYears } = useAdminSchoolYear()
  if (loading) return <Loader2 className="h-4 w-4 animate-spin text-emerald-600" aria-hidden />
  return (
    <select
      id={id}
      className={className}
      value={allYears ? ALL_YEARS_VALUE : selectedId ?? activeId ?? ''}
      onChange={(e) => {
        if (e.target.value === ALL_YEARS_VALUE) {
          setAllYears(true)
          return
        }
        setAllYears(false)
        setSelectedId(e.target.value || null)
      }}
      aria-label={ariaLabel}
    >
      {years.map((year) => (
        <option key={year.id} value={year.id}>
          {yearOptionLabel(year)}
        </option>
      ))}
      <option value={ALL_YEARS_VALUE}>Todos los ciclos (sin filtrar)</option>
    </select>
  )
}

/**
 * El ciclo lectivo en el menú lateral, arriba y en chico. Con el menú contraído queda el año en un
 * botón que lo vuelve a abrir.
 */
function SidebarSchoolYearPicker() {
  const auth = useOptionalAuth()
  const canManage = hasPermission(auth?.me, 'school-years.manage', 'all')
  const { rail, expand } = useSidebarSlot()
  const { years, activeId, selectedId, allYears } = useAdminSchoolYear()

  if (rail) {
    const current = years.find((year) => year.id === (selectedId ?? activeId))
    const short = allYears ? 'Todos' : String(current?.code ?? '—')
    const label = `Ciclo lectivo: ${allYears ? 'todos' : current ? yearOptionLabel(current) : 'sin elegir'}. Abrir el menú para cambiarlo`
    return (
      <button
        type="button"
        onClick={expand}
        title={label}
        aria-label={label}
        className="mx-auto flex w-12 flex-col items-center gap-0.5 rounded-lg border border-emerald-200 bg-emerald-50 py-1.5 text-emerald-800 transition-colors hover:bg-emerald-100"
      >
        <CalendarDays className="h-4 w-4" aria-hidden />
        <span className="text-[10px] font-semibold leading-none">{short}</span>
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/80 px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor="sidebar-school-year" className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Ciclo lectivo
        </label>
        {canManage && <Link
          href="/admin/school-years"
          title="Gestionar ciclos"
          aria-label="Gestionar ciclos"
          className="text-gray-400 transition-colors hover:text-emerald-700"
        >
          <Settings2 className="h-3.5 w-3.5" aria-hidden />
        </Link>}
      </div>
      <SchoolYearSelect
        id="sidebar-school-year"
        className="w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm"
      />
    </div>
  )
}

/** Una sola línea arriba del contenido: en el celular (el menú está cerrado) o si no hay menú. */
function InlineSchoolYearBar({ className = '' }: { className?: string }) {
  const auth = useOptionalAuth()
  const canManage = hasPermission(auth?.me, 'school-years.manage', 'all')
  return (
    <div className={`border-b border-gray-200 bg-white ${className}`}>
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2">
        <label htmlFor="inline-school-year" className="shrink-0 text-xs font-semibold text-gray-700">
          Ciclo lectivo
        </label>
        <SchoolYearSelect
          id="inline-school-year"
          ariaLabel="Seleccionar ciclo lectivo"
          className="min-w-0 flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm sm:max-w-xs sm:flex-none"
        />
        {canManage && <Link href="/admin/school-years" className="ml-auto shrink-0 text-xs text-emerald-700 hover:underline">
          Gestionar ciclos
        </Link>}
      </div>
    </div>
  )
}

/**
 * Marco de las secciones que filtran por ciclo lectivo. El selector va en el menú lateral (por
 * portal, ver `sidebar-slot`): antes ocupaba una barra entera arriba de cada pantalla.
 */
export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { slot } = useSidebarSlot()
  const showSchoolYearFilter = adminRouteUsesSchoolYear(pathname)

  return (
    <div className="min-h-screen bg-slate-50/80">
      {showSchoolYearFilter && slot && createPortal(<SidebarSchoolYearPicker />, slot)}
      {showSchoolYearFilter && <InlineSchoolYearBar className={slot ? 'lg:hidden' : ''} />}
      {children}
    </div>
  )
}
