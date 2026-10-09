'use client'

import { Loader2 } from 'lucide-react'
import { getStudentStatusBadgeClass, getStudentStatusLabel } from '@/lib/admin/students-display'
import StudentActionsMenu from './StudentActionsMenu'
import StudentMoodleBadge from './StudentMoodleBadge'
import type { StudentListRow } from './student-types'

type Props = {
  rows: StudentListRow[]
  loading: boolean
  allYears: boolean
  resendingId: string | null
  onOpen: (row: StudentListRow) => void
  onDelete: (row: StudentListRow) => void
  onResendMoodle: (row: StudentListRow) => void
}

/** Misma información que la tabla, apilada para pantallas chicas. */
export default function StudentsCardList({
  rows,
  loading,
  allYears,
  resendingId,
  onOpen,
  onDelete,
  onResendMoodle,
}: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500 md:hidden">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-600" aria-hidden />
        Cargando…
      </div>
    )
  }
  if (rows.length === 0) {
    return <div className="py-6 text-center text-sm text-gray-500 md:hidden">No hay registros con estos filtros.</div>
  }

  return (
    <ul className="space-y-3 border-t border-gray-100 pt-4 md:hidden">
      {rows.map((row) => (
        <li key={row.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <button type="button" className="block w-full text-left" onClick={() => onOpen(row)}>
            <span className="block break-words font-medium text-emerald-700 hover:underline">{row.lastName}, {row.firstName}</span>
            {row.documentId ? <span className="mt-1 block text-xs text-gray-500">{row.documentId}</span> : null}
          </button>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 break-words text-sm text-gray-600">{row.course?.name ?? 'Sin curso'}{allYears ? <span className="ml-2 text-xs text-gray-500">· Ciclo {row.schoolYearCode ?? '—'}</span> : null}</p>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getStudentStatusBadgeClass(row.enrollmentStatus)}`}>{getStudentStatusLabel(row.enrollmentStatus)}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>Aula virtual:</span>
            <StudentMoodleBadge moodle={row.moodle} studentName={`${row.firstName} ${row.lastName}`} pending={resendingId === row.studentId} onAction={null} compact />
          </div>
          <div className="mt-3 flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
            <button type="button" onClick={() => onOpen(row)} className="min-h-10 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50" aria-label={`Ver ficha de ${row.firstName} ${row.lastName}`}>Ver ficha</button>
            <StudentActionsMenu row={row} allYears={allYears} pending={resendingId === row.studentId} onDelete={onDelete} onResendMoodle={onResendMoodle} />
          </div>

        </li>
      ))}
    </ul>
  )
}
