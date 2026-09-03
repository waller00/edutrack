'use client'

import { CalendarCheck } from 'lucide-react'
import DateField from '@/components/forms/DateField'
import { tuitionMonthButtonClass, tuitionMonthLabel } from '@/lib/admin/students-display'
import { cycleTuitionMonth, monthsForYear, tuitionSummaryText } from '@/lib/admin/students-filters'
import type { StudentTuitionMonth } from './student-types'
import { ymd } from './student-types'

type Props = {
  months: StudentTuitionMonth[]
  /** Año que se edita DENTRO del modal, independiente del filtro de la tabla. */
  year: number
  onYearChange: (year: number) => void
  onChange: (months: StudentTuitionMonth[]) => void
}

export default function StudentTuitionSection({ months, year, onYearChange, onChange }: Props) {
  const cells = monthsForYear(months, year)

  function patchMonth(target: StudentTuitionMonth, patch: Partial<StudentTuitionMonth>) {
    onChange(months.map((m) => (m.year === target.year && m.month === target.month ? { ...m, ...patch } : m)))
  }

  return (
    <section className="space-y-3 border-t border-gray-100 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 font-medium text-gray-900">
          <CalendarCheck className="h-4 w-4 text-emerald-600" aria-hidden />
          Mensualidades
        </h3>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          Año
          <input
            type="number"
            className="input-field w-24 py-1 text-sm"
            value={year}
            onChange={(e) => onYearChange(Number(e.target.value) || year)}
          />
        </label>
      </div>

      <p className="text-xs text-gray-500">Tocá un mes para recorrer: sin registrar → pagado → pendiente.</p>

      <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
        {cells.map((m) => (
          <button
            key={m.month}
            type="button"
            className={`h-10 rounded-full border text-sm font-semibold transition ${tuitionMonthButtonClass(m.status)}`}
            onClick={() => onChange(cycleTuitionMonth(months, year, m.month))}
            aria-pressed={m.status !== 'none'}
            aria-label={`Mes ${m.month}: ${tuitionMonthLabel(m.status)}`}
            title={`Mes ${m.month}: ${tuitionMonthLabel(m.status)}`}
          >
            {m.month}
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-500">{tuitionSummaryText(cells)}</p>

      {months
        .filter((t) => t.year === year && t.paid)
        .sort((a, b) => a.month - b.month)
        .map((t) => (
          <div
            key={`${t.year}-${t.month}`}
            className="grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-[72px_150px_140px_1fr]"
          >
            <div>
              <span className="block text-[10px] uppercase text-gray-500">Mes</span>
              <span className="block rounded border border-gray-200 bg-white px-2 py-1 font-semibold">{t.month}</span>
            </div>
            <label className="block">
              <span className="block text-[10px] uppercase text-gray-500">Fecha pago</span>
              <DateField
                className="input-field w-full py-1 text-sm"
                value={ymd(t.paidAt)}
                onChange={(v) => patchMonth(t, { paidAt: v ? `${v}T00:00:00.000Z` : null })}
              />
            </label>
            <label className="block">
              <span className="block text-[10px] uppercase text-gray-500">Monto</span>
              <input
                type="number"
                inputMode="numeric"
                className="input-field w-full py-1 text-sm"
                placeholder="En centésimos"
                value={t.amountCents ?? ''}
                onChange={(e) =>
                  patchMonth(t, {
                    amountCents: e.target.value === '' ? null : Number.parseInt(e.target.value, 10),
                  })
                }
              />
            </label>
            <label className="block">
              <span className="block text-[10px] uppercase text-gray-500">Notas</span>
              <input
                className="input-field w-full py-1 text-sm"
                value={t.notes ?? ''}
                onChange={(e) => patchMonth(t, { notes: e.target.value || null })}
              />
            </label>
          </div>
        ))}
    </section>
  )
}
