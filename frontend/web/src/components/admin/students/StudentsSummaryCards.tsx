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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-[62px] animate-pulse rounded-lg border border-gray-100 bg-gray-50" />
        ))}
      </div>
    )
  }
  if (!summary) return null

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
  )
}
