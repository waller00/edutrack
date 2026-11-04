'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import { formatHundredths } from '@/lib/academic-config/grade-value'
import { formatAbsenceUnits } from '@/lib/libreta/absences'
import { groupByLevel, LEVEL_LABEL, type ReportCardPeriod } from '@/lib/gradebook/report-card-periods'
import ScrollRegion from '@/components/common/ScrollRegion'

export type StudentRef = { studentId: string; firstName: string; lastName: string; courseName: string }

export const studentName = (s: Pick<StudentRef, 'firstName' | 'lastName'>) => `${s.lastName}, ${s.firstName}`

/** R en centésimos → "8" o "7,5". */
export const gradeText = (hundredths: number) => formatHundredths(hundredths, hundredths % 100 === 0 ? 0 : 1)

/** Faltas en centésimos → "18" o "18,5". */
export const absencesText = (hundredths: number) => formatAbsenceUnits(hundredths)

/** `2026-10-05` → `05/10`. */
export const shortDate = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`

export function ReportCardPeriodSelect({
  periods,
  value,
  onChange,
}: {
  periods: readonly ReportCardPeriod[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-xs text-gray-600">Boletín</span>
      <select className="select-field" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Elegí un boletín…</option>
        {groupByLevel(periods).map(([level, options]) => (
          <optgroup key={level} label={LEVEL_LABEL[level] ?? level}>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

/** Carga un recurso del reporte cuando cambia la ruta; `null` no carga nada. */
export function useReport<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!path) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    api<T>(path)
      .then((res) => {
        if (!cancelled) {
          setData(res)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo cargar el reporte')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  return { data, loading, error }
}

export function Table({ head, children, minWidth = 640 }: { head: string[]; children: React.ReactNode; minWidth?: number }) {
  return (
    <ScrollRegion label="Tabla del reporte" className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </ScrollRegion>
  )
}
