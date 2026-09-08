'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { BookMarked, GraduationCap, Loader2, User } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { gradeBookTitle } from '@/lib/gradebook/labels'
import type { GradeBookHeader } from '@/lib/gradebook/types'

const PAGE_SIZES = [12, 24, 50]

/** Nombre corto de la libreta, como en la tapa: "1-EMS A · FÍSICA". */
export function libretaCode(book: GradeBookHeader): string {
  const course = book.course.code ?? book.course.name
  const orientation = book.orientation ? ` ${book.orientation}` : ''
  return `${course}${orientation} · ${book.subject.name.toUpperCase()}`
}

/** Filtra por los tres campos de la barra, sin distinguir acentos ni mayúsculas. */
export function filterLibretas(
  books: readonly GradeBookHeader[],
  filters: { libreta: string; asignatura: string; docente: string },
): GradeBookHeader[] {
  const norm = (value: string) =>
    value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  const match = (haystack: string, needle: string) =>
    needle.trim() === '' || norm(haystack).includes(norm(needle))

  return books.filter(
    (book) =>
      match(libretaCode(book), filters.libreta) &&
      match(book.subject.name, filters.asignatura) &&
      match(book.teacher?.name ?? '', filters.docente),
  )
}

function LibretaCard({ book }: { book: GradeBookHeader }) {
  return (
    <Link
      href={`/libreta/${book.id}`}
      className="flex flex-col gap-2 rounded-lg border border-gray-300 bg-white p-3 transition hover:border-emerald-400 hover:shadow-md"
    >
      <div className="flex items-start gap-2">
        <span className="flex h-9 w-8 shrink-0 items-center justify-center rounded-sm bg-gradient-to-b from-amber-700 to-amber-900 text-xs font-bold text-amber-100 shadow-inner">
          @
        </span>
        <span className="text-sm font-semibold leading-tight text-gray-900">{libretaCode(book)}</span>
      </div>

      <dl className="space-y-1 border-t border-gray-100 pt-2 text-xs text-gray-600">
        <div className="flex items-center gap-1.5">
          <GraduationCap className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
          <dt className="sr-only">Asignatura</dt>
          <dd className="truncate">{book.subject.name}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <User className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
          <dt className="sr-only">Docente</dt>
          <dd className="truncate">{book.teacher?.name ?? 'Sin titular asignado'}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 shrink-0 rounded-sm bg-emerald-600" aria-hidden />
          <dt className="sr-only">Grupo</dt>
          <dd className="truncate">{gradeBookTitle(book)}</dd>
        </div>
      </dl>

      {book.status === 'ARCHIVED' && (
        <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-center text-xs text-gray-600">
          Ciclo cerrado · sólo lectura
        </span>
      )}
    </Link>
  )
}

export default function MisLibretas() {
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const [books, setBooks] = useState<GradeBookHeader[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [draft, setDraft] = useState({ libreta: '', asignatura: '', docente: '' })
  const [filters, setFilters] = useState(draft)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[1])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ data: GradeBookHeader[] }>(withSchoolYear('/gradebook/mine', query))
      setBooks(res.data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las libretas')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => filterLibretas(books, filters), [books, filters])
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, totalPages)
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize)

  function applyFilters() {
    setFilters(draft)
    setPage(1)
  }

  function clearFilters() {
    const empty = { libreta: '', asignatura: '', docente: '' }
    setDraft(empty)
    setFilters(empty)
    setPage(1)
  }

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          applyFilters()
        }}
      >
        {([
          ['libreta', 'Libreta'],
          ['asignatura', 'Asignatura'],
          ['docente', 'Docente'],
        ] as const).map(([key, label]) => (
          <label key={key} className="flex-1 min-w-[180px]">
            <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
            <input
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
        ))}
        <button type="button" onClick={clearFilters} className="px-3 py-1.5 text-sm font-medium text-emerald-700 hover:underline">
          LIMPIAR
        </button>
        <button type="submit" className="rounded bg-slate-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-800">
          BUSCAR
        </button>
      </form>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {loading ? (
        <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando libretas…
        </p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center">
          <BookMarked className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
          <p className="mt-2 text-sm text-gray-600">
            {books.length === 0
              ? 'No tenés libretas en este ciclo. Se generan desde tus clases del horario; si falta alguna, avisá a administración.'
              : 'Ninguna libreta coincide con el filtro.'}
          </p>
        </div>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((book) => (
              <li key={book.id}>
                <LibretaCard book={book} />
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
            <button type="button" onClick={() => setPage(1)} disabled={current === 1} className="px-1 disabled:opacity-30" aria-label="Primera página">|◀</button>
            <button type="button" onClick={() => setPage(current - 1)} disabled={current === 1} className="px-1 disabled:opacity-30" aria-label="Página anterior">◀</button>
            <span>Página {current} de {totalPages}</span>
            <button type="button" onClick={() => setPage(current + 1)} disabled={current === totalPages} className="px-1 disabled:opacity-30" aria-label="Página siguiente">▶</button>
            <button type="button" onClick={() => setPage(totalPages)} disabled={current === totalPages} className="px-1 disabled:opacity-30" aria-label="Última página">▶|</button>

            <label className="ml-2 flex items-center gap-1">
              Por página:
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
                className="rounded border border-gray-300 px-1 py-0.5"
              >
                {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <span className="ml-auto">Cantidad: {filtered.length}</span>
          </div>
        </>
      )}
    </div>
  )
}
