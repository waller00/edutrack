'use client'

import { tuitionMonthChipClass, tuitionMonthLabel } from '@/lib/admin/students-display'
import { monthsForYear } from '@/lib/admin/students-filters'

type Props = {
  rows: { year: number; month: number; paid: boolean }[]
  year: number
}

export default function TuitionChips({ rows, year }: Props) {
  return (
    <div className="flex flex-wrap gap-1" aria-label={`Mensualidades ${year}`}>
      {monthsForYear(rows, year).map((m) => (
        <span
          key={m.month}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${tuitionMonthChipClass(
            m.status,
          )}`}
          title={`Mes ${m.month}: ${tuitionMonthLabel(m.status)}`}
        >
          {m.month}
        </span>
      ))}
    </div>
  )
}
