'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { libretaCode } from './MisLibretas'
import type { GradeBookHeader } from '@/lib/gradebook/types'
import type { LibretaSectionId } from '@/lib/libreta/menu'

/**
 * Selector de libreta para las entradas globales del menú.
 *
 * En SIGED estas pantallas arrancan con un desplegable de libreta arriba. Acá se resuelve igual,
 * y con una sola libreta se entra derecho: obligar a elegir cuando no hay opción es fricción pura.
 */
export default function ElegirLibreta({
  section,
  title,
  hint,
}: {
  section: LibretaSectionId
  title: string
  hint: string
}) {
  const router = useRouter()
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const [books, setBooks] = useState<GradeBookHeader[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ data: GradeBookHeader[] }>(withSchoolYear('/gradebook/mine', query))
      setBooks(res.data)
      if (res.data.length === 1) router.replace(`/libreta/${res.data[0].id}/${section}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las libretas')
    } finally {
      setLoading(false)
    }
  }, [query, router, section])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando libretas…
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <header className="border-b border-gray-200 pb-2">
        <h1 className="text-lg font-bold uppercase tracking-wide text-slate-700">{title}</h1>
        <p className="text-sm text-gray-600">{hint}</p>
      </header>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {books.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
          No tenés libretas en este ciclo.
        </p>
      ) : (
        <>
          <p className="text-sm text-gray-700">Elegí la libreta:</p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {books.map((book) => (
              <li key={book.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/libreta/${book.id}/${section}`)}
                  className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left transition hover:border-emerald-300 hover:shadow-sm"
                >
                  <span className="block text-sm font-medium text-gray-900">{libretaCode(book)}</span>
                  <span className="block text-xs text-gray-500">{book.teacher?.name ?? 'Sin titular'}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
