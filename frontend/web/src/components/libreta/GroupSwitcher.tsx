'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { libretaCode } from './MisLibretas'
import type { GradeBookHeader } from '@/lib/gradebook/types'

/**
 * Selector de grupo dentro de la libreta.
 *
 * El liceo pidió "tener todo en una sola libreta": el docente entra una vez y cambia de grupo sin
 * salir. Los datos siguen siendo por materia —las notas lo son—, así que lo que se unifica es la
 * navegación, no el modelo: `GradeBook.scopeKey` está atado al curso de Moodle y moverlo rompería
 * la integración.
 *
 * Cambiar de grupo **conserva la sección abierta**: si estabas en Evaluaciones de 1.º A, pasás a
 * Evaluaciones de 1.º B. Es lo que hace que se sienta una libreta y no seis.
 */
export default function GroupSwitcher({
  gradeBookId,
  section,
}: {
  gradeBookId: string
  /** Sección abierta, para no perderla al cambiar de grupo. */
  section: string | null
}) {
  const router = useRouter()
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const [books, setBooks] = useState<GradeBookHeader[]>([])

  useEffect(() => {
    let alive = true
    api<{ data: GradeBookHeader[] }>(withSchoolYear('/gradebook/mine', query))
      .then((res) => {
        if (alive) setBooks(res.data ?? [])
      })
      .catch(() => {
        // Sin la lista el selector no aparece; la libreta abierta sigue funcionando igual.
      })
    return () => {
      alive = false
    }
  }, [query])

  // Con una sola libreta no hay nada que elegir: mostrar un desplegable de un ítem es ruido.
  if (books.length < 2) return null

  return (
    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm sm:flex-initial">
      <span className="sr-only">Grupo</span>
      <select
        aria-label="Cambiar de grupo"
        className="min-h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3 pr-8 text-sm font-medium text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100 sm:max-w-xs"
        value={gradeBookId}
        onChange={(e) => router.push(`/libreta/${e.target.value}${section ? `/${section}` : ''}`)}
      >
        {books.map((book) => (
          <option key={book.id} value={book.id}>
            {libretaCode(book)}
          </option>
        ))}
      </select>
    </label>
  )
}
