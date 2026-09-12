'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, Check, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'

type Row = {
  gradeBookId: string
  subjectName: string
  courseName: string
  teacherName: string | null
  periodStatus: string | null
  rosterSize: number
  missingGrades: number
  missingJudgements: number
  complete: boolean
}

type PeriodOption = { periodId: string; name: string }

/** Texto del aviso. Espeja `completionRequestBody` del backend: dice qué falta, no "revisá". */
function detailOf(row: Row, periodName: string): string {
  const faltantes: string[] = []
  if (row.missingGrades > 0) faltantes.push(`${row.missingGrades} sin calificación`)
  if (row.missingJudgements > 0) faltantes.push(`${row.missingJudgements} sin juicio conceptual`)
  return `${periodName}: ${faltantes.join(' y ')}.`
}

/**
 * Control de adscripción: qué libretas están incompletas y aviso al docente.
 *
 * Es el trabajo que el liceo describió —entrar, mirar que estén las notas, y si falta algo avisar
 * por notificación interna— y que hasta ahora no tenía pantalla: la información existía pero sólo
 * se podía consultar de a una libreta por vez.
 */
export default function CompletenessPanel() {
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const [periods, setPeriods] = useState<PeriodOption[]>([])
  const [periodId, setPeriodId] = useState('')
  const [periodName, setPeriodName] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [sentTo, setSentTo] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [onlyIncomplete, setOnlyIncomplete] = useState(true)

  useEffect(() => {
    api<{ data: PeriodOption[] }>(withSchoolYear('/admin/gradebook/periods', query))
      .then((res) => setPeriods(res.data))
      .catch(() => setError('No se pudieron cargar los períodos'))
  }, [query])

  const load = useCallback(async () => {
    if (!periodId) return
    setLoading(true)
    setSentTo({})
    try {
      const res = await api<{ period: { name: string }; data: Row[] }>(
        `/admin/gradebook/completeness?periodId=${periodId}`,
      )
      setRows(res.data)
      setPeriodName(res.period.name)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el control')
    } finally {
      setLoading(false)
    }
  }, [periodId])

  useEffect(() => {
    void load()
  }, [load])

  async function notify(row: Row) {
    try {
      await api(`/admin/gradebook/completeness/${row.gradeBookId}/request`, {
        method: 'POST',
        body: JSON.stringify({ periodId, detail: detailOf(row, periodName) }),
      })
      setSentTo((current) => ({ ...current, [row.gradeBookId]: true }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el aviso')
    }
  }

  const visible = onlyIncomplete ? rows.filter((r) => !r.complete) : rows

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-600">Período</span>
          <select
            className="select-field"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
          >
            <option value="">Elegí un período…</option>
            {periods.map((p) => (
              <option key={p.periodId} value={p.periodId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={onlyIncomplete}
            onChange={(e) => setOnlyIncomplete(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Sólo las que faltan
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 py-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Revisando libretas…
        </p>
      ) : !periodId ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
          Elegí un período para ver qué libretas están incompletas.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-900">
          {onlyIncomplete ? 'Todas las libretas están completas.' : 'No hay libretas en este período.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Libreta</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Docente</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Falta</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Aviso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((row) => (
                <tr key={row.gradeBookId}>
                  <td className="px-3 py-1.5">
                    <Link href={`/libreta/${row.gradeBookId}/cierre`} className="text-emerald-700 hover:underline">
                      {row.courseName} · {row.subjectName}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-gray-700">{row.teacherName ?? 'Sin titular'}</td>
                  <td className="px-3 py-1.5">
                    {row.complete ? (
                      <span className="text-emerald-700">Completa</span>
                    ) : (
                      <span className="text-amber-800">{detailOf(row, periodName)}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {row.complete ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : sentTo[row.gradeBookId] ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <Check className="h-3.5 w-3.5" aria-hidden />
                        Avisado
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void notify(row)}
                        disabled={!row.teacherName}
                        title={row.teacherName ? undefined : 'La libreta no tiene docente titular'}
                        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-40"
                      >
                        <Bell className="h-3.5 w-3.5" aria-hidden />
                        Avisar al docente
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
