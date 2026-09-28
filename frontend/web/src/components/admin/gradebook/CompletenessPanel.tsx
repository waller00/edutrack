'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, Check, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import {
  groupByLevel,
  LEVEL_LABEL,
  nextMeeting,
  REPORT_CARD_PERIODS_PATH,
  type ReportCardPeriod,
} from '@/lib/gradebook/report-card-periods'

type Row = {
  gradeBookId: string
  subjectName: string
  courseName: string
  teacherName: string | null
  periodStatus: string | null
  rosterSize: number
  /** Evaluaciones de los tramos que informa la reunión. */
  expectsAssessments: boolean
  assessmentCount: number
  hasNoAssessments: boolean
  /** Notas de evaluación sin cargar (alumno × evaluación). */
  missingAssessmentGrades: number
  requiresGrade: boolean
  missingGrades: number
  requiresJudgement: boolean
  missingJudgements: number
  /** Alumnos con R: sólo informa si la reunión ya se hizo. */
  meetingGradedCount: number
  complete: boolean
}

type Notice = { kind: 'sent' } | { kind: 'nobody' }

function AssessmentsCell({ row }: { row: Row }) {
  if (!row.expectsAssessments) return <span className="text-gray-400">No aplica</span>
  if (row.hasNoAssessments) return <span className="text-amber-800">Sin evaluaciones</span>
  if (row.missingAssessmentGrades > 0) {
    return (
      <span className="text-amber-800">
        {row.assessmentCount} cargadas · faltan {row.missingAssessmentGrades} notas
      </span>
    )
  }
  return <span className="text-emerald-700">{row.assessmentCount} completas</span>
}

function MissingCell({ required, missing }: { required: boolean; missing: number }) {
  if (!required) return <span className="text-gray-400">No aplica</span>
  if (missing > 0) return <span className="text-amber-800">Faltan {missing}</span>
  return <span className="text-emerald-700">Completa</span>
}

function NoticeCell({ row, notice, onNotify }: { row: Row; notice?: Notice; onNotify: () => void }) {
  if (row.complete) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
        <Check className="h-3.5 w-3.5" aria-hidden />
        Al día
      </span>
    )
  }
  if (notice?.kind === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
        <Check className="h-3.5 w-3.5" aria-hidden />
        Avisado
      </span>
    )
  }
  if (notice?.kind === 'nobody') return <span className="text-xs text-gray-500">Sin docente a quien avisar</span>
  return (
    <button
      type="button"
      onClick={onNotify}
      disabled={!row.teacherName}
      title={row.teacherName ? undefined : 'La libreta no tiene docente titular'}
      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-40"
    >
      <Bell className="h-3.5 w-3.5" aria-hidden />
      Avisar al docente
    </button>
  )
}

/**
 * Control de libretas antes de la reunión de boletín.
 *
 * Antes de cada reunión general administración revisa que cada docente tenga cargadas las
 * evaluaciones de los tramos, la calificación del período y el juicio; si falta algo, le avisa por
 * notificación interna. La R no se mira: se pone en la reunión misma.
 */
export default function CompletenessPanel() {
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const [periods, setPeriods] = useState<ReportCardPeriod[]>([])
  const [periodId, setPeriodId] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [notices, setNotices] = useState<Record<string, Notice>>({})
  const [error, setError] = useState<string | null>(null)
  const [onlyIncomplete, setOnlyIncomplete] = useState(true)

  useEffect(() => {
    api<{ data: ReportCardPeriod[] }>(withSchoolYear(REPORT_CARD_PERIODS_PATH, query))
      .then((res) => {
        setPeriods(res.data)
        // La reunión que viene es la que se revisa casi siempre: se preselecciona.
        const today = new Date().toISOString().slice(0, 10)
        setPeriodId((current) => current || nextMeeting(res.data, today)?.id || '')
      })
      .catch(() => setError('No se pudieron cargar las reuniones'))
  }, [query])

  const load = useCallback(async () => {
    if (!periodId) return
    setLoading(true)
    setNotices({})
    try {
      const res = await api<{ period: { name: string }; data: Row[] }>(`/admin/gradebook/completeness?periodId=${periodId}`)
      setRows(res.data)
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
      const res = await api<{ notified: number }>(`/admin/gradebook/completeness/${row.gradeBookId}/request`, {
        method: 'POST',
        body: JSON.stringify({ periodId }),
      })
      setNotices((current) => ({ ...current, [row.gradeBookId]: { kind: res.notified > 0 ? 'sent' : 'nobody' } }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el aviso')
    }
  }

  const visible = onlyIncomplete ? rows.filter((r) => !r.complete) : rows
  const pending = rows.filter((r) => !r.complete).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-600">Reunión</span>
          <select className="select-field" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">Elegí una reunión…</option>
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
        <label className="flex items-center gap-1.5 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={onlyIncomplete}
            onChange={(e) => setOnlyIncomplete(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Sólo las que faltan
        </label>
        {periodId && !loading && (
          <p className="ml-auto text-sm text-gray-600">
            {pending === 0 ? 'Todas al día' : `${pending} de ${rows.length} libretas con faltantes`}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {loading && (
        <p className="flex items-center gap-2 py-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Revisando libretas…
        </p>
      )}
      {!loading && !periodId && (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
          Elegí una reunión para ver qué libretas no están al día.
        </p>
      )}
      {!loading && periodId && visible.length === 0 && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-900">
          {onlyIncomplete ? 'Todas las libretas están al día para esta reunión.' : 'No hay libretas para esta reunión.'}
        </p>
      )}
      {!loading && periodId && visible.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Libreta</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Docente</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Evaluaciones</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Calificación (C)</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Juicios</th>
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
                    <AssessmentsCell row={row} />
                  </td>
                  <td className="px-3 py-1.5">
                    <MissingCell required={row.requiresGrade} missing={row.missingGrades} />
                  </td>
                  <td className="px-3 py-1.5">
                    <MissingCell required={row.requiresJudgement} missing={row.missingJudgements} />
                  </td>
                  <td className="px-3 py-1.5">
                    <NoticeCell row={row} notice={notices[row.gradeBookId]} onNotify={() => void notify(row)} />
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
