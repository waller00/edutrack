'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { formatHundredths } from '@/lib/academic-config/grade-value'
import { formatAbsenceUnits } from '@/lib/libreta/absences'
import {
  groupByLevel,
  lastClosedMeeting,
  LEVEL_LABEL,
  REPORT_CARD_PERIODS_PATH,
  type ReportCardPeriod,
} from '@/lib/gradebook/report-card-periods'

export type StudentRef = { studentId: string; firstName: string; lastName: string; courseName: string }

export const studentName = (s: Pick<StudentRef, 'firstName' | 'lastName'>) => `${s.lastName}, ${s.firstName}`

/** R en centésimos → "8" o "7,5". */
export const gradeText = (hundredths: number) => formatHundredths(hundredths, hundredths % 100 === 0 ? 0 : 1)

/** Faltas en centésimos → "18" o "18,5". */
export const absencesText = (hundredths: number) => formatAbsenceUnits(hundredths)

/** `2026-10-05` → `05/10`. */
export const shortDate = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`

export function useSchoolYearQuery(): string {
  return useOptionalAdminSchoolYear()?.schoolYearScopedQuery ?? ''
}

/** Reuniones de boletín del ciclo; preselecciona la última que ya pasó (la que tiene R). */
export function useReportCardPeriods() {
  const query = useSchoolYearQuery()
  const [periods, setPeriods] = useState<ReportCardPeriod[]>([])
  const [periodId, setPeriodId] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<{ data: ReportCardPeriod[] }>(withSchoolYear(REPORT_CARD_PERIODS_PATH, query))
      .then((res) => {
        setPeriods(res.data)
        const today = new Date().toISOString().slice(0, 10)
        setPeriodId((current) => current || lastClosedMeeting(res.data, today)?.id || '')
      })
      .catch(() => setError('No se pudieron cargar las reuniones de boletín'))
  }, [query])

  return { periods, periodId, setPeriodId, error }
}

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

export function ReportState({ loading, error, empty, emptyText }: { loading: boolean; error: string | null; empty: boolean; emptyText: string }) {
  if (error) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        {error}
      </p>
    )
  }
  if (loading) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Calculando…
      </p>
    )
  }
  if (empty) {
    return <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">{emptyText}</p>
  }
  return null
}

export function Table({ head, children, minWidth = 640 }: { head: string[]; children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
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
    </div>
  )
}
