'use client'

import { Loader2, Trash2 } from 'lucide-react'
import { getStudentStatusBadgeClass, getStudentStatusLabel } from '@/lib/admin/students-display'
import { tuitionYearForRow } from '@/lib/admin/students-filters'
import StudentMoodleBadge from './StudentMoodleBadge'
import TuitionChips from './TuitionChips'
import type { StudentListRow } from './student-types'

type Column = { key: string; label: string; width: string; onlyAllYears?: boolean }

/**
 * Ancho y visibilidad de columnas en un solo lugar: antes eran un `<colgroup>` con
 * porcentajes a mano y dos `colSpan` calculados que había que mantener en sincronía.
 */
const COLUMNS: Column[] = [
  { key: 'student', label: 'Estudiante', width: 'w-[22%]' },
  { key: 'schoolYear', label: 'Ciclo', width: 'w-[9%]', onlyAllYears: true },
  { key: 'course', label: 'Curso', width: 'w-[14%]' },
  { key: 'status', label: 'Estado', width: 'w-[11%]' },
  { key: 'moodle', label: 'Moodle', width: 'w-[18%]' },
  { key: 'tuition', label: 'Mensualidades', width: 'w-[22%]' },
  { key: 'actions', label: '', width: 'w-[4%]' },
]

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

export default function StudentsTable({
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
  const columns = COLUMNS.filter((c) => !c.onlyAllYears || allYears)

  return (
    <div className="-mx-4 hidden overflow-x-auto border-t border-gray-100 sm:-mx-5 sm:block">
      <table className="w-full min-w-[1080px] table-fixed text-sm">
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} className={c.width} />
          ))}
        </colgroup>
        <thead className="bg-gray-50/80">
          <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            {columns.map((c) => (
              <th key={c.key} scope="col" className="px-4 py-2.5 font-medium">
                {c.key === 'tuition' ? `${c.label} ${allYears ? 'del ciclo' : tuitionYear || fallbackYear}` : c.label}
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
                    className="text-left font-medium text-emerald-700 hover:underline"
                    onClick={() => onOpen(row)}
                  >
                    {row.lastName}, {row.firstName}
                  </button>
                  {row.documentId ? <div className="text-xs text-gray-500">{row.documentId}</div> : null}
                </td>
                {allYears ? <td className="px-4 py-2.5 text-gray-600">{row.schoolYearCode ?? '—'}</td> : null}
                <td className="px-4 py-2.5 text-gray-700">{row.course?.name ?? '—'}</td>
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
                    resending={resendingId === row.studentId}
                    onResend={() => onResendMoodle(row)}
                  />
                </td>
                <td className="px-4 py-2.5">
                  <TuitionChips
                    rows={row.tuitionMonthsPreview}
                    year={tuitionYearForRow(row, tuitionYear, fallbackYear)}
                  />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    className="inline-grid h-8 w-8 place-items-center rounded-lg text-red-600 hover:bg-red-50 hover:text-red-800"
                    title={`Eliminar a ${row.lastName}, ${row.firstName}`}
                    aria-label={`Eliminar a ${row.lastName}, ${row.firstName}`}
                    onClick={() => onDelete(row)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
