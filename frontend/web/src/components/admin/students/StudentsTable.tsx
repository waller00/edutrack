'use client'

import { Loader2 } from 'lucide-react'
import { getStudentStatusBadgeClass, getStudentStatusLabel } from '@/lib/admin/students-display'
import StudentActionsMenu from './StudentActionsMenu'
import StudentMoodleBadge from './StudentMoodleBadge'
import type { StudentListRow } from './student-types'

const COLUMNS = [
  { key: 'student', label: 'Estudiante', width: 'w-[32%]' },
  { key: 'course', label: 'Curso', width: 'w-[18%]' },
  { key: 'status', label: 'Estado', width: 'w-[13%]' },
  { key: 'moodle', label: 'Aula virtual', width: 'w-[14%]' },
  { key: 'actions', label: 'Acciones', width: 'w-[23%]' },
]

type Props = {
  rows: StudentListRow[]
  loading: boolean
  allYears: boolean
  resendingId: string | null
  onOpen: (row: StudentListRow) => void
  onDelete: (row: StudentListRow) => void
  onResendMoodle: (row: StudentListRow) => void
}

export default function StudentsTable({
  rows,
  loading,
  allYears,
  resendingId,
  onOpen,
  onDelete,
  onResendMoodle,
}: Props) {
  const columns = COLUMNS

  return (
    <div className="-mx-4 hidden overflow-x-auto border-t border-gray-100 sm:-mx-5 md:block">
      <table className="w-full min-w-[720px] table-fixed text-sm">
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} className={c.width} />
          ))}
        </colgroup>
        <thead className="bg-gray-50/80">
          <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            {columns.map((c) => (
              <th key={c.key} scope="col" className="px-4 py-2.5 font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-gray-500">
                <Loader2 className="inline h-6 w-6 animate-spin text-emerald-600" aria-hidden />
                <span className="sr-only">Cargando estudiantes…</span>
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-gray-500">
                No hay registros con estos filtros.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-b border-gray-100 hover:bg-slate-50/80">
                <td className="px-4 py-2.5">
                  <button
                    type="button"
                    className="break-words text-left font-medium text-emerald-700 hover:underline"
                    onClick={() => onOpen(row)}
                  >
                    {row.lastName}, {row.firstName}
                  </button>
                  {row.documentId ? <div className="text-xs text-gray-500">{row.documentId}</div> : null}
                </td>
                <td className="break-words px-4 py-2.5 text-gray-700">
                  {row.course?.name ?? 'Sin curso'}
                  {allYears ? <div className="mt-1 text-xs text-gray-500">Ciclo {row.schoolYearCode ?? '—'}</div> : null}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getStudentStatusBadgeClass(
                      row.enrollmentStatus,
                    )}`}
                  >
                    {getStudentStatusLabel(row.enrollmentStatus)}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <StudentMoodleBadge
                    moodle={row.moodle}
                    studentName={`${row.firstName} ${row.lastName}`}
                    pending={resendingId === row.studentId}
                    onAction={null}
                    compact
                  />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => onOpen(row)} className="min-h-10 whitespace-nowrap rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50" aria-label={`Ver ficha de ${row.firstName} ${row.lastName}`}>Ver ficha</button>
                    <StudentActionsMenu row={row} allYears={allYears} pending={resendingId === row.studentId} onDelete={onDelete} onResendMoodle={onResendMoodle} />
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
