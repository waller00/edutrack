'use client'

import { STUDENT_STATUS_LABEL } from '@/lib/admin/students-display'
import type { StudentSummary } from './student-types'

const STATUSES = ['ACTIVE', 'WITHDRAWN', 'GRADUATED', 'TRANSFERRED'] as const

export default function StudentsSummaryCards({
  summary,
  loading,
}: {
  summary: StudentSummary | null
  loading: boolean
}) {
  if (loading && !summary) {
    return (
      <div aria-label="Cargando resumen de matrícula" className="h-12 animate-pulse rounded-xl border border-gray-100 bg-gray-50" />
    )
  }
  if (!summary) return null

  return (
    <details className="group rounded-xl border border-gray-200 bg-white shadow-sm">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 p-4 text-sm font-medium text-gray-700 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-gray-400 transition-transform group-open:rotate-90">▸</span>
        Resumen de matrícula
        <span className="ml-auto text-xs font-normal text-gray-500">{summary.total} {summary.total === 1 ? 'registro' : 'registros'}</span>
      </summary>
      <div className="grid grid-cols-2 gap-3 border-t border-gray-100 p-4 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2.5">
          <p className="text-xs font-medium uppercase text-emerald-700">Total</p>
          <p className="text-xl font-bold text-emerald-900">{summary.total}</p>
        </div>
        {STATUSES.map((key) => (
          <div key={key} className="rounded-lg border border-gray-100 bg-white px-3 py-2.5 shadow-sm">
            <p className="text-xs font-medium uppercase text-gray-500">{STUDENT_STATUS_LABEL[key]}</p>
            <p className="text-xl font-bold text-gray-900">{summary.byStatus[key] ?? 0}</p>
          </div>
        ))}
      </div>
    </details>
  )
}
