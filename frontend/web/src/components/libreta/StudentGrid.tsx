'use client'

import { CalendarX2, Clock } from 'lucide-react'
import { absenceTone } from '@/lib/libreta/badges'
import { studentFullName } from '@/lib/gradebook/labels'
import type { RosterStudent } from '@/lib/gradebook/types'

/** Iniciales para el avatar; EduTrack no guarda foto del estudiante. */
export function initialsOf(student: Pick<RosterStudent, 'firstName' | 'lastName'>): string {
  return `${student.lastName[0] ?? ''}${student.firstName[0] ?? ''}`.toUpperCase()
}

/**
 * Grilla del grupo, como la tapa del Libro del Profesor.
 *
 * Muestra faltas y llegadas tarde junto a cada alumno porque es el dato que el docente mira
 * primero al abrir la libreta. El número va siempre escrito: el color sólo lo refuerza.
 */
export default function StudentGrid({ students }: { students: readonly RosterStudent[] }) {
  if (students.length === 0) {
    return (
      <p className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
        El grupo no tiene estudiantes matriculados en este ciclo.
      </p>
    )
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {students.map((student, index) => {
        const absences = student.absences ?? 0
        const lates = student.lates ?? 0
        return (
          <li
            key={student.studentId}
            className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-2"
          >
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600"
            >
              {initialsOf(student)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-tight text-gray-900">
                <span className="mr-1 text-xs text-gray-400">{index + 1}</span>
                {studentFullName(student)}
              </p>
              {student.documentId && (
                <p className="font-mono text-xs text-gray-500">{student.documentId}</p>
              )}
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className={`inline-flex items-center gap-1 ${absenceTone(absences)}`} title="Faltas acumuladas en esta asignatura">
                  <CalendarX2 className="h-3.5 w-3.5" aria-hidden />
                  {absences} falta{absences === 1 ? '' : 's'}
                </span>
                <span className="inline-flex items-center gap-1 text-gray-500" title="Llegadas tarde acumuladas">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  {lates} tarde{lates === 1 ? '' : 's'}
                </span>
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
