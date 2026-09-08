'use client'

import Link from 'next/link'
import { CalendarX2, Clock, ExternalLink } from 'lucide-react'
import { useLibreta } from '@/contexts/LibretaContext'
import { studentFullName } from '@/lib/gradebook/labels'
import { absenceTone } from '@/lib/libreta/badges'

/**
 * Inasistencias acumuladas del grupo en esta asignatura.
 *
 * Es **lectura**: las faltas se cargan pasando lista, no acá. Duplicar la escritura daría dos
 * lugares donde marcar lo mismo y ninguna forma de saber cuál vale, así que se enlaza al pase de
 * lista en vez de reimplementarlo.
 */
export default function InasistenciasSection() {
  const { detail } = useLibreta()
  if (!detail) return null

  const rows = [...detail.students].sort(
    (a, b) => (b.absences ?? 0) - (a.absences ?? 0) || a.lastName.localeCompare(b.lastName, 'es'),
  )
  const totalAbsences = rows.reduce((acc, s) => acc + (s.absences ?? 0), 0)
  const totalLates = rows.reduce((acc, s) => acc + (s.lates ?? 0), 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <p className="text-gray-600">
          Acumulado de esta asignatura. Se ordena por quien más faltó.
        </p>
        <p className="font-medium text-slate-700">
          {totalAbsences} falta{totalAbsences === 1 ? '' : 's'} · {totalLates} llegada{totalLates === 1 ? '' : 's'} tarde
        </p>
      </div>

      <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
        Las faltas se registran pasando lista, no desde acá.{' '}
        <Link href="/me/roll-call" className="inline-flex items-center gap-1 text-emerald-700 hover:underline">
          Ir al pase de lista
          <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      </p>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
          El grupo no tiene estudiantes matriculados.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">N.º</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Estudiante</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Faltas</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Llegadas tarde</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((student, index) => (
                <tr key={student.studentId}>
                  <td className="px-3 py-1.5 text-xs text-gray-400">{index + 1}</td>
                  <td className="px-3 py-1.5 text-gray-900">{studentFullName(student)}</td>
                  <td className={`px-3 py-1.5 ${absenceTone(student.absences ?? 0)}`}>
                    <span className="inline-flex items-center gap-1">
                      <CalendarX2 className="h-3.5 w-3.5" aria-hidden />
                      {student.absences ?? 0}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-gray-700">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" aria-hidden />
                      {student.lates ?? 0}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
