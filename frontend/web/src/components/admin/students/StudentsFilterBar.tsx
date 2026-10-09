'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react'
import type { CourseOpt, OrientationOpt } from './student-types'

export type StudentFilters = {
  draftQ: string
  courseId: string
  orientationId: string
  status: string
}

type Props = {
  filters: StudentFilters
  courses: CourseOpt[]
  orientations: OrientationOpt[]
  activeFilterCount: number
  onChange: (patch: Partial<StudentFilters>) => void
  onClear: () => void
}

export default function StudentsFilterBar({ filters, courses, orientations, activeFilterCount, onChange, onClear }: Props) {
  const [moreOpen, setMoreOpen] = useState(false)
  const selectedOrientation = orientations.find((row) => row.orientationId === filters.orientationId)

  return (
    <div className="space-y-3">
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
        <div className="min-w-0">
          <label htmlFor="student-search" className="mb-1 block text-xs font-medium text-gray-600">Buscar estudiante</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
            <input id="student-search" type="search" className="min-h-10 w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500" value={filters.draftQ} onChange={(e) => onChange({ draftQ: e.target.value })} placeholder="Nombre, apellido o documento" />
          </div>
        </div>
        <div className="min-w-0">
          <label htmlFor="student-course" className="mb-1 block text-xs font-medium text-gray-600">Curso</label>
          <select id="student-course" className="select-field min-h-10 text-sm" value={filters.courseId} onChange={(e) => onChange({ courseId: e.target.value, orientationId: '' })}>
            <option value="">Todos los cursos</option>
            {courses.map((course) => <option key={course.id} value={course.id}>{course.name}{course.code ? ` (${course.code})` : ''}{course.isActive === false ? ' — inactivo' : ''}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {filters.courseId && orientations.length > 0 ? (
          <button type="button" aria-expanded={moreOpen} aria-controls="student-more-filters" onClick={() => setMoreOpen((value) => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            <SlidersHorizontal className="h-4 w-4" aria-hidden />Más filtros
            {filters.orientationId ? <span className="rounded-full bg-emerald-100 px-2 text-xs text-emerald-800">1</span> : null}
            {moreOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
          </button>
        ) : null}
        {selectedOrientation ? (
          <button type="button" onClick={() => onChange({ orientationId: '' })} className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800" aria-label={`Quitar filtro de orientación ${selectedOrientation.orientation.name}`}>
            <span className="min-w-0 break-words">{selectedOrientation.orientation.name}</span><X className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </button>
        ) : null}
        {activeFilterCount > 0 ? (
          <button type="button" onClick={onClear} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            <X className="h-4 w-4" aria-hidden />Limpiar filtros
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-100 px-1 text-xs font-medium">{activeFilterCount}</span>
          </button>
        ) : null}
      </div>
      {moreOpen && filters.courseId && orientations.length > 0 ? (
        <div id="student-more-filters" className="rounded-lg bg-gray-50 p-3">
          <label htmlFor="student-orientation" className="mb-1 block text-xs font-medium text-gray-600">Orientación</label>
          <select id="student-orientation" className="select-field min-h-10 text-sm sm:max-w-sm" value={filters.orientationId} onChange={(e) => onChange({ orientationId: e.target.value })}>
            <option value="">Todas las orientaciones</option>
            {orientations.map((row) => <option key={row.orientationId} value={row.orientationId}>{row.orientation.name}{row.orientation.code ? ` (${row.orientation.code})` : ''}</option>)}
          </select>
        </div>
      ) : null}
    </div>
  )
}
