'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, BookMarked, ChevronDown, ChevronLeft, ChevronRight, GraduationCap, Loader2, Search, SlidersHorizontal, User } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { gradeBookTitle } from '@/lib/gradebook/labels'
import type { GradeBookHeader } from '@/lib/gradebook/types'
import { formatDateInUruguay } from '@/lib/forms/datetime-uy'

const PAGE_SIZES = [12, 24, 50]
const EMPTY_FILTERS = { libreta: '', asignatura: '', docente: '', search: '', course: '', status: 'ALL' }
const FIELD_CLASS = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100'

/** Nombre corto de la libreta, como en la tapa: "1-EMS A · FÍSICA". */
export function libretaCode(book: GradeBookHeader): string {
  const course = book.course.code ?? book.course.name
  const orientation = book.orientation ? ` ${book.orientation}` : ''
  return `${course}${orientation} · ${book.subject.name.toUpperCase()}`
}

/** La búsqueda general y los filtros específicos ignoran acentos y mayúsculas. */
export function filterLibretas(
  books: readonly GradeBookHeader[],
  filters: { libreta: string; asignatura: string; docente: string; search?: string },
): GradeBookHeader[] {
  const norm = (value: string) =>
    value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  const match = (haystack: string, needle: string) =>
    needle.trim() === '' || norm(haystack).includes(norm(needle))

  return books.filter(
    (book) =>
      match(libretaCode(book), filters.libreta) &&
      match(book.subject.name, filters.asignatura) &&
      match(book.teacher?.name ?? '', filters.docente) &&
      match([
        book.subject.name, book.subject.code, book.course.name, book.course.code,
        book.orientation, book.teacher?.name, book.teacher?.username, book.schoolYear.code,
      ].filter((value) => value != null).join(' '), filters.search ?? ''),
  )
}

function LibretaCard({ book }: { book: GradeBookHeader }) {
  return (
    <Link
      href={`/libreta/${book.id}`}
      aria-label={`Abrir libreta de ${gradeBookTitle(book)} (${book.schoolYear.code})`}
      className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 transition duration-200 hover:border-emerald-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 transition-colors group-hover:bg-emerald-100">
          <BookMarked className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-lg font-semibold tracking-tight text-slate-900">{book.subject.name}</h2>
          <p className="mt-0.5 text-xs text-slate-500">Ciclo {book.schoolYear.code}</p>
        </div>
      </div>
      <dl className="my-5 space-y-3 text-sm text-slate-600">
        <div className="flex items-start gap-2">
          <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <dt className="sr-only">Curso y orientación</dt>
          <dd className="min-w-0 break-words">
            {book.course.code ? `${book.course.code} · ${book.course.name}` : book.course.name}
            {book.orientation && <span className="mt-0.5 block text-xs text-slate-500">{book.orientation}</span>}
          </dd>
        </div>
        <div className="flex items-start gap-2">
          <User className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <dt className="sr-only">Docente</dt>
          <dd className="min-w-0 break-words">{book.teacher?.name ?? 'Sin titular asignado'}</dd>
        </div>
      </dl>
      <div className="mt-auto space-y-3">
        {book.status === 'ARCHIVED' && (
          <p className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">Ciclo cerrado · sólo lectura</p>
        )}
        {book.substitution && (
          <p className="rounded-md bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800 ring-1 ring-sky-200">
            Suplencia · cargás tus notas hasta el {formatDateInUruguay(book.substitution.until)}
          </p>
        )}
        <span className="flex min-h-11 items-center justify-between border-t border-slate-100 pt-4 text-sm font-semibold text-emerald-700">
          Abrir libreta <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>
    </Link>
  )
}

export default function MisLibretas() {
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const [books, setBooks] = useState<GradeBookHeader[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [showOptions, setShowOptions] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const requestId = useRef(0)
  const optionsId = useId()
  const courseId = useId()
  const pageSizeId = useId()

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const res = await api<{ data: GradeBookHeader[] }>(withSchoolYear('/gradebook/mine', query))
      if (requestId.current === currentRequest) setBooks(res.data)
    } catch (err) {
      if (requestId.current === currentRequest) {
        setError(err instanceof Error ? err.message : 'No se pudieron cargar las libretas')
      }
    } finally {
      if (requestId.current === currentRequest) setLoading(false)
    }
  }, [query])

  const cancelPendingLoad = useCallback(() => { requestId.current++ }, [])

  useEffect(() => {
    setPage(1)
    setFilters((previous) => ({ ...previous, course: '' }))
    void load()
    return cancelPendingLoad
  }, [load, cancelPendingLoad])

  const courses = useMemo(() => {
    const unique = new Map(books.map((book) => [book.course.id, book.course]))
    return [...unique.values()].sort((a, b) =>
      (a.code ?? a.name).localeCompare(b.code ?? b.name, 'es', { numeric: true }))
  }, [books])
  const filtered = useMemo(() => filterLibretas(books, filters).filter((book) =>
    (!filters.course || book.course.id === filters.course) &&
    (filters.status === 'ALL' || book.status === filters.status)), [books, filters])
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, totalPages)
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize)
  const hasFilters = Object.entries(filters).some(([key, value]) => key === 'status' ? value !== 'ALL' : value.trim() !== '')
  const advancedCount = [filters.asignatura, filters.docente].filter((value) => value.trim()).length

  function updateFilter(key: keyof typeof EMPTY_FILTERS, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value }))
    setPage(1)
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS)
    setPage(1)
  }

  return (
    <div className="space-y-4">
      <section aria-label="Filtros de libretas" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(200px,280px)]">
          <label className="min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Buscar libreta</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
              <input type="search" value={filters.search} onChange={(e) => updateFilter('search', e.target.value)}
                placeholder="Asignatura, curso o docente" className={`${FIELD_CLASS} pl-9`} />
            </div>
          </label>
          <div className="min-w-0">
            <label htmlFor={courseId} className="mb-1.5 block text-sm font-medium text-slate-700">Curso</label>
            <select id={courseId} value={filters.course} onChange={(e) => updateFilter('course', e.target.value)} className={FIELD_CLASS}>
              <option value="">Todos los cursos</option>
              {courses.map((course) => <option key={course.id} value={course.id}>{course.code ? `${course.code} · ${course.name}` : course.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Estado de las libretas" className="inline-flex max-w-full gap-1 rounded-lg bg-slate-100 p-1">
            {([['ALL', 'Todas'], ['ACTIVE', 'Activas'], ['ARCHIVED', 'Cerradas']] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={filters.status === value} onClick={() => updateFilter('status', value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${filters.status === value ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:bg-white/60'}`}>{label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {hasFilters && <button type="button" onClick={clearFilters} className="text-sm font-medium text-emerald-700 hover:underline">Limpiar filtros</button>}
            <button type="button" aria-expanded={showOptions} aria-controls={optionsId} onClick={() => setShowOptions(!showOptions)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              Más filtros y opciones{advancedCount > 0 && ` (${advancedCount})`}
              <ChevronDown className={`h-4 w-4 transition ${showOptions ? 'rotate-180' : ''}`} aria-hidden />
            </button>
          </div>
        </div>
        {showOptions && <div id={optionsId} className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
          {([['asignatura', 'Asignatura'], ['docente', 'Docente']] as const).map(([key, label]) => (
            <label key={key} className="min-w-0">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
              <input value={filters[key]} onChange={(e) => updateFilter(key, e.target.value)} className={FIELD_CLASS} />
            </label>
          ))}
          <div>
            <label htmlFor={pageSizeId} className="mb-1.5 block text-sm font-medium text-slate-700">Libretas por página</label>
            <select id={pageSizeId} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }} className={FIELD_CLASS}>
              {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </div>
        </div>}
        {!showOptions && advancedCount > 0 && <p className="text-xs text-slate-500">
          {[filters.asignatura.trim() && `Asignatura: ${filters.asignatura.trim()}`, filters.docente.trim() && `Docente: ${filters.docente.trim()}`].filter(Boolean).join(' · ')}
        </p>}
      </section>

      {loading ? (
        <p role="status" className="flex items-center gap-2 py-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />Cargando libretas…
        </p>
      ) : error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="rounded-lg border border-red-200 bg-white px-3 py-2 font-medium hover:bg-red-100">Reintentar</button>
        </div>
      ) : (
        <>
          <p role="status" className="text-sm text-slate-500">
            {filtered.length > 0 ? `Mostrando ${(current - 1) * pageSize + 1}–${Math.min(current * pageSize, filtered.length)} de ${filtered.length} libretas` : '0 libretas'}
          </p>
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center">
              <BookMarked className="mx-auto h-8 w-8 text-slate-300" aria-hidden />
              <p className="mx-auto mt-3 max-w-lg text-sm text-slate-600">
                {books.length === 0
                  ? 'No tenés libretas en este ciclo. Se generan desde tus clases del horario; si falta alguna, avisá a administración.'
                  : 'Ninguna libreta coincide con el filtro.'}
              </p>
              {hasFilters && <button type="button" onClick={clearFilters} className="mt-4 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">Ver todas las libretas</button>}
            </div>
          ) : <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((book) => <li key={book.id} className="min-w-0"><LibretaCard book={book} /></li>)}
          </ul>}
          {totalPages > 1 && <nav aria-label="Páginas de libretas" className="flex flex-wrap items-center justify-end gap-2 text-sm text-slate-600">
            <button type="button" onClick={() => setPage(current - 1)} disabled={current === 1} aria-label="Página anterior"
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" aria-hidden />Anterior
            </button>
            <span>Página {current} de {totalPages}</span>
            <button type="button" onClick={() => setPage(current + 1)} disabled={current === totalPages} aria-label="Página siguiente"
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50 disabled:opacity-40">
              Siguiente<ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </nav>}
        </>
      )}
    </div>
  )
}
