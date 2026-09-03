'use client'

import { Search, X } from 'lucide-react'
import { TUITION_MONTHS } from '@/lib/admin/students-filters'
import type { CourseOpt, OrientationOpt } from './student-types'
import { STUDENT_STATUS_OPTIONS } from './student-types'

export type StudentFilters = {
  draftQ: string
  courseId: string
  orientationId: string
  status: string
  tuitionYear: string
  tuitionMonth: string
  tuitionPaid: string
}

type Props = {
  filters: StudentFilters
  courses: CourseOpt[]
  orientations: OrientationOpt[]
  activeFilterCount: number
  onChange: (patch: Partial<StudentFilters>) => void
  onClear: () => void
}

/**
 * Barra de filtros. Todos los controles (incluida la búsqueda, que va con debounce en el
 * contenedor) se aplican solos: antes el texto exigía Enter o un botón "Aplicar" mientras
 * los selects filtraban al instante, dos modelos de interacción en la misma barra.
 */
export default function StudentsFilterBar({
  filters,
  courses,
  orientations,
  activeFilterCount,
  onChange,
  onClear,
}: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
      <div className="min-w-0 lg:min-w-[220px] lg:flex-1">
        <label htmlFor="student-search" className="mb-1 block text-xs font-medium text-gray-600">
          Buscar
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            id="student-search"
            type="search"
            className="input-field w-full pl-9 text-sm"
            value={filters.draftQ}
            onChange={(e) => onChange({ draftQ: e.target.value })}
            placeholder="Nombre, apellido o documento"
          />
        </div>
      </div>

      <div className="min-w-0 lg:min-w-[170px]">
        <label htmlFor="student-course" className="mb-1 block text-xs font-medium text-gray-600">
          Curso
        </label>
        <select
          id="student-course"
          className="select-field w-full text-sm"
          value={filters.courseId}
          onChange={(e) => onChange({ courseId: e.target.value, orientationId: '' })}
        >
          <option value="">Todos</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.code ? ` (${c.code})` : ''}
              {c.isActive === false ? ' — inactivo' : ''}
            </option>
          ))}
        </select>
      </div>

      {filters.courseId && orientations.length > 0 ? (
        <div className="min-w-0 lg:min-w-[170px]">
          <label htmlFor="student-orientation" className="mb-1 block text-xs font-medium text-gray-600">
            Orientación
          </label>
          <select
            id="student-orientation"
            className="select-field w-full text-sm"
            value={filters.orientationId}
            onChange={(e) => onChange({ orientationId: e.target.value })}
          >
            <option value="">Todas</option>
            {orientations.map((o) => (
              <option key={o.orientationId} value={o.orientationId}>
                {o.orientation.name}
                {o.orientation.code ? ` (${o.orientation.code})` : ''}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="min-w-0 lg:min-w-[150px]">
        <label htmlFor="student-status" className="mb-1 block text-xs font-medium text-gray-600">
          Estado
        </label>
        <select
          id="student-status"
          className="select-field w-full text-sm"
          value={filters.status}
          onChange={(e) => onChange({ status: e.target.value })}
        >
          <option value="">Todos</option>
          {STUDENT_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="w-full lg:w-24">
        <label htmlFor="student-year" className="mb-1 block text-xs font-medium text-gray-600">
          Año cuotas
        </label>
        <input
          id="student-year"
          className="input-field w-full text-sm"
          inputMode="numeric"
          value={filters.tuitionYear}
          onChange={(e) => onChange({ tuitionYear: e.target.value })}
          placeholder="2026"
        />
      </div>

      <div className="w-full lg:w-24">
        <label htmlFor="student-month" className="mb-1 block text-xs font-medium text-gray-600">
          Mes
        </label>
        <select
          id="student-month"
          className="select-field w-full text-sm"
          value={filters.tuitionMonth}
          onChange={(e) => onChange({ tuitionMonth: e.target.value })}
        >
          <option value="">Todos</option>
          {TUITION_MONTHS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-0 lg:min-w-[120px]">
        <label htmlFor="student-paid" className="mb-1 block text-xs font-medium text-gray-600">
          Pago
        </label>
        <select
          id="student-paid"
          className="select-field w-full text-sm"
          value={filters.tuitionPaid}
          onChange={(e) => onChange({ tuitionPaid: e.target.value })}
        >
          <option value="">—</option>
          <option value="true">Sí</option>
          <option value="false">No</option>
        </select>
      </div>

      {activeFilterCount > 0 ? (
        <button type="button" className="btn-secondary text-sm" onClick={onClear}>
          <X className="h-4 w-4" aria-hidden />
          Limpiar
          <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1 text-xs font-semibold text-white">
            {activeFilterCount}
          </span>
        </button>
      ) : null}
    </div>
  )
}
