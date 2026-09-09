'use client'

import { Loader2, Trash2 } from 'lucide-react'
import { getStudentStatusBadgeClass, getStudentStatusLabel } from '@/lib/admin/students-display'
import { tuitionYearForRow } from '@/lib/admin/students-filters'
import StudentMoodleBadge from './StudentMoodleBadge'
import TuitionChips from './TuitionChips'
import type { StudentListRow } from './student-types'

type Props = {
  rows: StudentListRow[]
  loading: boolean
  allYears: boolean
  tuitionYear: string
  fallbackYear: number
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
  tuitionYear,
  fallbackYear,
  resendingId,
  onOpen,
  onDelete,
  onResendMoodle,
}: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500 sm:hidden">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-600" aria-hidden />
        Cargando…
      </div>
    )
  }
  if (rows.length === 0) {
    return <div className="py-6 text-center text-sm text-gray-500 sm:hidden">No hay registros con estos filtros.</div>
  }

  return (
    <ul className="space-y-3 border-t border-gray-100 pt-4 sm:hidden">
      {rows.map((row) => (
        <li key={row.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <button type="button" className="min-w-0 text-left" onClick={() => onOpen(row)}>
              <span className="block truncate font-medium text-emerald-700 hover:underline">
                {row.lastName}, {row.firstName}
              </span>
              {row.documentId ? <span className="block text-xs text-gray-500">{row.documentId}</span> : null}
            </button>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getStudentStatusBadgeClass(
                  row.enrollmentStatus,
                )}`}
              >
                {getStudentStatusLabel(row.enrollmentStatus)}
              </span>
              <button
                type="button"
                className="inline-grid h-8 w-8 place-items-center rounded-lg text-red-600 hover:bg-red-50"
                aria-label={`Eliminar a ${row.lastName}, ${row.firstName}`}
                onClick={() => onDelete(row)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {allYears ? (
              <div className="flex gap-2">
                <dt className="text-gray-500">Ciclo:</dt>
                <dd className="text-gray-700">{row.schoolYearCode ?? '—'}</dd>
              </div>
            ) : null}
            <div className="flex gap-2">
              <dt className="text-gray-500">Curso:</dt>
              <dd className="text-gray-700">{row.course?.name ?? '—'}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-gray-500">Moodle:</dt>
              <dd>
                <StudentMoodleBadge
                  moodle={row.moodle}
                  studentName={`${row.firstName} ${row.lastName}`}
                  pending={resendingId === row.studentId}
                  onAction={() => onResendMoodle(row)}
                />
              </dd>
            </div>
          </dl>

          <div className="mt-2">
            <p className="mb-1 text-[11px] font-medium uppercase text-gray-500">
              Mensualidades {tuitionYearForRow(row, tuitionYear, fallbackYear)}
            </p>
            <TuitionChips rows={row.tuitionMonthsPreview} year={tuitionYearForRow(row, tuitionYear, fallbackYear)} />
          </div>
        </li>
      ))}
    </ul>
  )
}
