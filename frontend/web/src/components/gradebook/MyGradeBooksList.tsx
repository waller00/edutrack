'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { BookOpen, Loader2, Users } from 'lucide-react'
import { api } from '@/lib/api/client'
import { gradeBookTitle, groupByCourse } from '@/lib/gradebook/labels'
import type { GradeBookHeader } from '@/lib/gradebook/types'

export default function MyGradeBooksList() {
  const [books, setBooks] = useState<GradeBookHeader[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api<{ data: GradeBookHeader[] }>('/gradebook/mine')
      setBooks(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las libretas')
    } finally {
      setLoading(false)
    }
  }, [])

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

  if (error) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        {error}
      </p>
    )
  }

  if (books.length === 0) {
    return (
      <p className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
        No tenés libretas asignadas en este ciclo. Se generan a partir de tus clases del horario;
        si falta alguna, avisá a administración.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {groupByCourse(books).map((group) => (
        <section key={group.course}>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">{group.course}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {group.books.map((book) => (
              <li key={book.id}>
                <Link
                  href={`/me/gradebook/${book.id}`}
                  className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 transition hover:border-emerald-300 hover:shadow-sm"
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                    <BookOpen className="h-5 w-5 text-emerald-600" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900">{book.subject.name}</span>
                    <span className="block text-xs text-gray-600">{gradeBookTitle(book)}</span>
                    {book.status === 'ARCHIVED' && (
                      <span className="mt-1 inline-block rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-600">
                        Ciclo cerrado · sólo lectura
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="flex items-center gap-2 text-xs text-gray-500">
        <Users className="h-3.5 w-3.5" aria-hidden />
        {books.length} libreta{books.length === 1 ? '' : 's'} en el ciclo.
      </p>
    </div>
  )
}
