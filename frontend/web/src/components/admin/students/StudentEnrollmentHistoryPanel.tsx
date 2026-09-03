'use client'

import { useEffect, useState } from 'react'
import { History, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { getStudentStatusBadgeClass, getStudentStatusLabel } from '@/lib/admin/students-display'
import type { StudentEnrollmentHistoryRow } from './student-types'

/**
 * Recorrido académico del estudiante, un registro por ciclo.
 * El detalle solo trae la matrícula del ciclo seleccionado, así que sin esto no había forma
 * de ver que un alumno estuvo en 3ºB en 2025 y en 4ºA en 2026.
 */
export default function StudentEnrollmentHistoryPanel({ studentId }: { studentId: string }) {
  const [rows, setRows] = useState<StudentEnrollmentHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api<StudentEnrollmentHistoryRow[]>(`/admin/students/${studentId}/enrollments`)
      .then((data) => {
        if (!cancelled) setRows(Array.isArray(data) ? data : [])
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudo cargar el historial')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [studentId])

  return (
    <section className="space-y-2 border-t border-gray-100 pt-4">
      <h3 className="inline-flex items-center gap-2 font-medium text-gray-900">
        <History className="h-4 w-4 text-emerald-600" aria-hidden />
        Historial de matrículas
      </h3>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando historial…
        </p>
      ) : error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">Sin matrículas registradas.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {row.schoolYearCode ?? row.schoolYearName ?? 'Ciclo'} · {row.courseName ?? 'Sin curso'}
                  {row.orientationName ? ` — ${row.orientationName}` : ''}
                </p>
                {row.withdrawnAt ? (
                  <p className="text-xs text-gray-500">Baja: {row.withdrawnAt.slice(0, 10)}</p>
                ) : null}
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${getStudentStatusBadgeClass(
                  row.enrollmentStatus,
                )}`}
              >
                {getStudentStatusLabel(row.enrollmentStatus)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
