'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, Check, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { todayYmdUruguay } from '@/lib/libreta/absence-day'
import {
  groupByLevel,
  LEVEL_LABEL,
  nextMeeting,
  REPORT_CARD_PERIODS_PATH,
  type ReportCardPeriod,
} from '@/lib/gradebook/report-card-periods'

type Stage = 'before' | 'after'

type Row = {
  gradeBookId: string
  subjectName: string
  courseName: string
  orientationName?: string | null
  teacherName: string | null
  periodStatus: string | null
  rosterSize: number
  /** Evaluaciones de los tramos que informa la reunión. */
  expectsAssessments: boolean
  assessmentCount: number
  hasNoAssessments: boolean
  /** Notas sin cargar en las evaluaciones del grupo (alumno × evaluación). */
  missingAssessmentGrades: number
  /** Con sólo notas sueltas: alumnos que no tienen ninguna en el tramo. */
  studentsWithoutGrades?: number
  requiresGrade: boolean
  missingGrades: number
  requiresJudgement: boolean
  missingJudgements: number
  /** Alumnos con R. */
  meetingGradedCount: number
  /** Después de la reunión: alumnos sin R. */
  missingMeetingGrades?: number
  complete: boolean
  /** Último aviso por esta reunión, en cada etapa. */
  lastRequestedAt?: { before: string | null; after: string | null }
}

type Notice = { kind: 'sent' } | { kind: 'nobody' }

type BulkResult = { teachers: number; gradeBooks: number; withoutTeacher: number }

const STAGES: { id: Stage; label: string }[] = [
  { id: 'before', label: 'Antes de la reunión' },
  { id: 'after', label: 'Después de la reunión' },
]

/** Antes de la reunión: evaluaciones, C y juicio. Después: R y período cerrado. */
export function isDone(row: Row, stage: Stage): boolean {
  return stage === 'after' ? row.periodStatus === 'CLOSED' : row.complete
}

export function rowLabel(row: Pick<Row, 'courseName' | 'orientationName' | 'subjectName'>): string {
  return `${row.courseName}${row.orientationName ? ` — ${row.orientationName}` : ''} · ${row.subjectName}`
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function bulkNoticeText(result: BulkResult): string {
  if (result.teachers === 0) return 'No había a quién avisar: las libretas pendientes no tienen titular.'
  const teachers = result.teachers === 1 ? '1 docente' : `${result.teachers} docentes`
  const books = result.gradeBooks === 1 ? '1 libreta' : `${result.gradeBooks} libretas`
  const orphans = result.withoutTeacher > 0 ? ` ${result.withoutTeacher} sin titular quedaron sin aviso.` : ''
  return `Se avisó a ${teachers} por ${books}, un aviso por docente.${orphans}`
}

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
  const withoutGrades = row.studentsWithoutGrades ?? 0
  if (withoutGrades > 0) {
    return (
      <span className="text-amber-800">
        {row.assessmentCount} cargadas · {withoutGrades} {withoutGrades === 1 ? 'alumno sin notas' : 'alumnos sin notas'}
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

function PeriodStatusCell({ status }: { status: string | null }) {
  if (status === 'CLOSED') {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700">
        <Check className="h-3.5 w-3.5" aria-hidden />
        Cerrado
      </span>
    )
  }
  return <span className="text-amber-800">{status === 'REOPENED' ? 'Reabierto' : 'Abierto'}</span>
}

function NoticeCell({
  row,
  stage,
  notice,
  onNotify,
}: {
  row: Row
  stage: Stage
  notice?: Notice
  onNotify: () => void
}) {
  if (isDone(row, stage)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
        <Check className="h-3.5 w-3.5" aria-hidden />
        {stage === 'after' ? 'Cerrada' : 'Al día'}
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
  const last = row.lastRequestedAt?.[stage]
  return (
    <span className="flex flex-col items-start gap-0.5">
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
      {last && <span className="text-[11px] text-gray-500">Avisado el {shortDate(last)}</span>}
    </span>
  )
}

function StageColumns({ row, stage }: { row: Row; stage: Stage }) {
  if (stage === 'after') {
    return (
      <>
        <td className="px-3 py-1.5">
          <MissingCell required={row.requiresGrade} missing={row.missingMeetingGrades ?? 0} />
        </td>
        <td className="px-3 py-1.5">
          <PeriodStatusCell status={row.periodStatus} />
        </td>
      </>
    )
  }
  return (
    <>
      <td className="px-3 py-1.5">
        <AssessmentsCell row={row} />
      </td>
      <td className="px-3 py-1.5">
        <MissingCell required={row.requiresGrade} missing={row.missingGrades} />
      </td>
      <td className="px-3 py-1.5">
        <MissingCell required={row.requiresJudgement} missing={row.missingJudgements} />
      </td>
    </>
  )
}

const STAGE_HEADERS: Record<Stage, string[]> = {
  before: ['Evaluaciones', 'Calificación (C)', 'Juicios'],
  after: ['Nota de reunión (R)', 'Período'],
}

/**
 * Control de libretas, antes y después de la reunión de boletín.
 *
 * **Antes**, administración revisa que cada docente tenga cargadas las evaluaciones de los tramos,
 * la calificación del período y el juicio. **Después**, que haya puesto la R de cada alumno y
 * cerrado el período, que es lo que habilita el visado. Si falta algo, le avisa por notificación
 * interna, de a uno o a todos juntos (un aviso por docente).
 */
export default function CompletenessPanel() {
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const [periods, setPeriods] = useState<ReportCardPeriod[]>([])
  const [periodId, setPeriodId] = useState('')
  const [stage, setStage] = useState<Stage>('before')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [notices, setNotices] = useState<Record<string, Notice>>({})
  const [bulkBusy, setBulkBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [onlyIncomplete, setOnlyIncomplete] = useState(true)

  useEffect(() => {
    api<{ data: ReportCardPeriod[] }>(withSchoolYear(REPORT_CARD_PERIODS_PATH, query))
      .then((res) => {
        setPeriods(res.data)
        // La reunión que viene es la que se revisa casi siempre: se preselecciona.
        // Día civil de Uruguay: `toISOString()` da el día siguiente después de las 21 h.
        setPeriodId((current) => current || nextMeeting(res.data, todayYmdUruguay())?.id || '')
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
        body: JSON.stringify({ periodId, stage }),
      })
      setNotices((current) => ({ ...current, [row.gradeBookId]: { kind: res.notified > 0 ? 'sent' : 'nobody' } }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el aviso')
    }
  }

  async function notifyAll() {
    setBulkBusy(true)
    setMessage(null)
    try {
      const res = await api<BulkResult>('/admin/gradebook/completeness/request-all', {
        method: 'POST',
        body: JSON.stringify({ periodId, stage }),
      })
      await load()
      setMessage(bulkNoticeText(res))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron enviar los avisos')
    } finally {
      setBulkBusy(false)
    }
  }

  const visible = onlyIncomplete ? rows.filter((r) => !isDone(r, stage)) : rows
  const pending = rows.filter((r) => !isDone(r, stage)).length
  const notifiable = rows.filter((r) => !isDone(r, stage) && r.teacherName).length
  const allDoneText = stage === 'after' ? 'Todas las libretas cerraron el período.' : 'Todas las libretas están al día para esta reunión.'

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
        <div role="radiogroup" aria-label="Etapa" className="flex overflow-hidden rounded-lg border border-gray-300 text-sm">
          {STAGES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={stage === item.id}
              onClick={() => {
                setStage(item.id)
                setNotices({})
                setMessage(null)
              }}
              className={`px-3 py-1.5 ${stage === item.id ? 'bg-emerald-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
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
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <p className="text-sm text-gray-600">
              {pending === 0
                ? 'Todas al día'
                : `${pending} de ${rows.length} libretas ${stage === 'after' ? 'sin cerrar' : 'con faltantes'}`}
            </p>
            {notifiable > 0 && (
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void notifyAll()}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
                Avisar a todos ({notifiable})
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          {message}
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
          {onlyIncomplete ? allDoneText : 'No hay libretas para esta reunión.'}
        </p>
      )}
      {!loading && periodId && visible.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Libreta</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Docente</th>
                {STAGE_HEADERS[stage].map((header) => (
                  <th key={header} scope="col" className="px-3 py-2 text-left font-medium">
                    {header}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 text-left font-medium">Aviso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((row) => (
                <tr key={row.gradeBookId}>
                  <td className="px-3 py-1.5">
                    <Link href={`/libreta/${row.gradeBookId}/cierre`} className="text-emerald-700 hover:underline">
                      {rowLabel(row)}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-gray-700">{row.teacherName ?? 'Sin titular'}</td>
                  <StageColumns row={row} stage={stage} />
                  <td className="px-3 py-1.5">
                    <NoticeCell row={row} stage={stage} notice={notices[row.gradeBookId]} onNotify={() => void notify(row)} />
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
