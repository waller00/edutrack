'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, Check, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { groupParams, type GroupFilter } from '@/lib/gradebook/group-filter'
import ScrollRegion from '@/components/common/ScrollRegion'

export type Stage = 'before' | 'after'

export type CompletenessRow = Row

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
  /** ¿Pide R (rendimiento)? */
  requiresGrade: boolean
  /** Alumnos sin R. */
  missingGrades: number
  requiresJudgement: boolean
  missingJudgements: number
  /** ¿Pide C (conducta)? Las reuniones que piden rendimiento. */
  requiresConduct?: boolean
  /** Alumnos sin C. */
  missingConduct?: number
  /** ¿Pide el informe general del grupo? Las reuniones de boletín. */
  requiresGroupReport?: boolean
  missingGroupReport?: boolean
  complete: boolean
  /** Último aviso por esta reunión, en cada etapa. */
  lastRequestedAt?: { before: string | null; after: string | null }
}

type Notice = { kind: 'sent' } | { kind: 'nobody' }

type BulkResult = { teachers: number; gradeBooks: number; withoutTeacher: number }

/** Antes de la reunión: evaluaciones, R, C, juicio e informe del grupo. Después: período cerrado. */
export function isDone(row: Pick<Row, 'complete' | 'periodStatus'>, stage: Stage): boolean {
  return stage === 'after' ? row.periodStatus === 'CLOSED' : row.complete
}

export function completenessPath(periodId: string, group: GroupFilter | null): string {
  const params = new URLSearchParams({ periodId, ...groupParams(group) })
  return `/admin/gradebook/completeness?${params.toString()}`
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

function GroupReportCell({ row }: { row: Row }) {
  if (!row.requiresGroupReport) return <span className="text-gray-400">No aplica</span>
  if (row.missingGroupReport) return <span className="text-amber-800">▲ Falta</span>
  return <span className="text-emerald-700">✓ Cargado</span>
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
      <td className="px-3 py-1.5">
        <PeriodStatusCell status={row.periodStatus} />
      </td>
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
        <MissingCell required={Boolean(row.requiresConduct)} missing={row.missingConduct ?? 0} />
      </td>
      <td className="px-3 py-1.5">
        <MissingCell required={row.requiresJudgement} missing={row.missingJudgements} />
      </td>
      <td className="px-3 py-1.5">
        <GroupReportCell row={row} />
      </td>
    </>
  )
}

const STAGE_HEADERS: Record<Stage, string[]> = {
  before: ['Evaluaciones', 'Rendimiento (R)', 'Conducta (C)', 'Juicios', 'Informe del grupo'],
  after: ['Período'],
}

type Props = {
  periodId: string
  group: GroupFilter | null
  /** Carga (antes de la reunión) o cierre (después). */
  stage: Stage
  rows: readonly Row[]
  loading: boolean
  error: string | null
  /** Vuelve a pedir las filas: después de avisar a todos, para que muestren "Avisado el…". */
  onReload: () => Promise<void>
}

/**
 * Los pasos Carga y Cierre de "Control y visado de libretas".
 *
 * **Carga**, antes de la reunión: que cada docente tenga cargadas las evaluaciones de los tramos,
 * R (rendimiento), C (conducta), el juicio y el informe del grupo. **Cierre**, después: que haya
 * cerrado el período, que es lo que lo lleva a Visado. Si falta algo, le avisa por notificación
 * interna, de a uno o a todos juntos (un aviso por docente). La reunión, el grupo y las filas los
 * pone la pantalla: los comparte con el visado y con el contador de cada paso.
 */
export default function CompletenessPanel({ periodId, group, stage, rows, loading, error, onReload }: Props) {
  const [notices, setNotices] = useState<Record<string, Notice>>({})
  const [bulkBusy, setBulkBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [onlyIncomplete, setOnlyIncomplete] = useState(true)

  // Filas nuevas traen su "Avisado el…": el "Avisado" de la sesión ya no hace falta.
  useEffect(() => {
    setNotices({})
  }, [rows])

  const groupKey = group ? `${group.courseOfferingId}|${group.courseOrientationId ?? ''}` : ''
  useEffect(() => {
    setNotices({})
    setMessage(null)
    setActionError(null)
  }, [periodId, groupKey, stage])

  async function notify(row: Row) {
    try {
      const res = await api<{ notified: number }>(`/admin/gradebook/completeness/${row.gradeBookId}/request`, {
        method: 'POST',
        body: JSON.stringify({ periodId, stage }),
      })
      setNotices((current) => ({ ...current, [row.gradeBookId]: { kind: res.notified > 0 ? 'sent' : 'nobody' } }))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo enviar el aviso')
    }
  }

  async function notifyAll() {
    setBulkBusy(true)
    setMessage(null)
    try {
      const res = await api<BulkResult>('/admin/gradebook/completeness/request-all', {
        method: 'POST',
        // Con un grupo elegido, el aviso es sólo por sus libretas: las mismas que cuenta el botón.
        body: JSON.stringify({ periodId, stage, ...groupParams(group) }),
      })
      await onReload()
      setMessage(bulkNoticeText(res))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudieron enviar los avisos')
    } finally {
      setBulkBusy(false)
    }
  }

  const visible = onlyIncomplete ? rows.filter((r) => !isDone(r, stage)) : rows
  const pending = rows.filter((r) => !isDone(r, stage)).length
  const notifiable = rows.filter((r) => !isDone(r, stage) && r.teacherName).length
  const allDoneText = stage === 'after' ? 'Todas las libretas cerraron el período.' : 'Todas las libretas están al día para esta reunión.'
  const shownError = actionError ?? error

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
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

      {shownError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {shownError}
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
        <ScrollRegion label="Completitud de libretas" className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
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
        </ScrollRegion>
      )}
    </div>
  )
}
