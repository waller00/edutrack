'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowUpRight, CalendarX2, Clock, Search, X } from 'lucide-react'
import { useStudentPhoto } from '@/lib/hooks/useStudentPhoto'
import { absenceTone } from '@/lib/libreta/badges'
import { studentFullName } from '@/lib/gradebook/labels'
import type { RosterStudent } from '@/lib/gradebook/types'
import StudentBadges, { type StudentBadgeFocus } from './StudentBadges'

/** Iniciales para el avatar cuando no hay foto cargada en administración. */
export function initialsOf(student: Pick<RosterStudent, 'firstName' | 'lastName'>): string {
  return `${student.lastName[0] ?? ''}${student.firstName[0] ?? ''}`.toUpperCase()
}

function StudentAvatar({
  gradeBookId,
  student,
}: {
  gradeBookId: string
  student: RosterStudent
}) {
  const url = useStudentPhoto(gradeBookId, student.studentId, student.hasPhoto)

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        className="h-10 w-10 shrink-0 rounded-full border border-slate-200 object-cover"
      />
    )
  }

  return (
    <span
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600"
    >
      {initialsOf(student)}
    </span>
  )
}

/**
 * Grilla del grupo, como la tapa del Libro del Profesor.
 *
 * Muestra faltas y llegadas tarde junto a cada alumno porque es el dato que el docente mira
 * primero al abrir la libreta. El número va siempre escrito: el color sólo lo refuerza.
 * El nombre abre la hoja del estudiante (adecuaciones, etc.); la foto viene de administración.
 * También hay acceso directo a la ficha de evaluaciones.
 */
export default function StudentGrid({
  gradeBookId,
  students,
  onOpenStudent,
}: {
  gradeBookId: string
  students: readonly RosterStudent[]
  /** Abre la hoja del estudiante. Si no viene, la grilla es sólo de lectura. */
  onOpenStudent?: (studentId: string, focus?: StudentBadgeFocus) => void
}) {
  const [search, setSearch] = useState('')
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  const query = normalize(search)
  const documentQuery = query.replace(/[.\s-]/g, '')
  const visible = students.map((student, index) => ({ student, index })).filter(({ student }) =>
    normalize(`${studentFullName(student)} ${student.documentId ?? ''}`).includes(query) ||
    (/^\d+$/.test(documentQuery) && (student.documentId ?? '').replace(/\D/g, '').includes(documentQuery)),
  )
  if (students.length === 0) {
    return (
      <p className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
        El grupo no tiene estudiantes matriculados en este ciclo.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="relative w-full sm:max-w-sm">
          <span className="sr-only">Buscar estudiante</span>
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" aria-hidden />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o documento" className="min-h-11 w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100" />
        </label>
        <p role="status" className="text-xs text-slate-500">{visible.length} de {students.length} estudiantes</p>
      </div>
      {visible.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
          <p className="text-sm text-slate-600">No hay estudiantes que coincidan con la búsqueda.</p>
          <button type="button" onClick={() => setSearch('')} className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50"><X className="h-4 w-4" aria-hidden />Limpiar búsqueda</button>
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {visible.map(({ student, index }) => {
          const absences = student.absences ?? '0'
          const absenceHundredths = student.absenceHundredths ?? 0
          const lates = student.lates ?? 0
          const evaluacionesHref = `/libreta/${gradeBookId}/evaluaciones?alumno=${encodeURIComponent(student.studentId)}`
          return (
            <li
              key={student.studentId}
              className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-emerald-300"
            >
              <StudentAvatar gradeBookId={gradeBookId} student={student} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-tight text-gray-900">
                  <span aria-label={`Número ${index + 1}`} className="mb-1 block text-[10px] font-medium tabular-nums text-slate-400">{index + 1}</span>
                  {onOpenStudent ? (
                    <button
                      type="button"
                      onClick={() => onOpenStudent(student.studentId)}
                      className="min-h-6 text-left font-semibold text-slate-900 hover:text-emerald-700 hover:underline"
                    >
                      {studentFullName(student)}
                    </button>
                  ) : (
                    studentFullName(student)
                  )}
                </p>
                {student.documentId && (
                  <p className="font-mono text-xs text-gray-500">{student.documentId}</p>
                )}
                <StudentBadges
                  className="mt-1.5"
                  codes={student.badges}
                  onSelect={
                    onOpenStudent
                      ? (_code, focus) => onOpenStudent(student.studentId, focus)
                      : undefined
                  }
                />
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-xs">
                  <span
                    className={`inline-flex items-center gap-1 ${absenceTone(absenceHundredths)}`}
                    title="Faltas del ciclo en todo el liceo, contando las medias faltas"
                  >
                    <CalendarX2 className="h-3.5 w-3.5" aria-hidden />
                    {absences} falta{absenceHundredths === 100 ? '' : 's'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-gray-500" title="Llegadas tarde acumuladas">
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    {lates} tarde{lates === 1 ? '' : 's'}
                  </span>
                </div>
                <Link
                  href={evaluacionesHref}
                  className="mt-3 inline-flex min-h-8 items-center gap-1 rounded-md text-xs font-medium text-emerald-700 hover:underline"
                >
                  Evaluaciones
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
