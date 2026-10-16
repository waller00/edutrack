'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { studentFullName } from '@/lib/gradebook/labels'
import { gradeSelectFromHundredths, gradeSelectToHundredths, formatGrade, type GradeRange } from '@/lib/gradebook/grade-scale'
import { judgementLabelOf, periodKind, type LibretaPeriod } from '@/lib/gradebook/period-blocks'
import { todayYmdUruguay } from '@/lib/libreta/absence-day'
import { confirmDiscard, useUnsavedChangesWarning } from '@/lib/hooks/useUnsavedChangesWarning'
import GradeSelect from './GradeSelect'
import ConductSelect, { conductText, type ConductOption } from './ConductSelect'
import ScrollRegion from '@/components/common/ScrollRegion'

type Options = {
  periods: LibretaPeriod[]
  periodScale?: GradeRange | null
  conduct?: ConductOption[]
}

type SheetRow = {
  studentId: string
  lastName: string
  firstName: string
  assessmentCount: number
  valueHundredths: number | null
  meetingValueHundredths: number | null
  conceptualJudgement: string | null
  conductValueHundredths: number | null
}

type Sheet = {
  period: LibretaPeriod
  state: { status: 'OPEN' | 'CLOSED' | 'REOPENED' }
  canEdit: boolean
  students: SheetRow[]
  /** Informe general del grupo del período; `required` en las reuniones de boletín. */
  groupReport?: { body: string | null; updatedAt: string | null; required: boolean }
}

/** R (rendimiento), el texto y C (conducta), en centésimos como texto (`''` sin dato). */
type RowDraft = { meeting: string; judgement: string; conduct: string }
type Patch = {
  meetingValueHundredths?: number | null
  conceptualJudgement?: string | null
  conductValueHundredths?: number | null
}

const DISCARD_MESSAGE = 'Hay cambios sin guardar en el cierre del grupo. ¿Descartarlos?'

/** El período en curso: el que contiene hoy, o el último que ya empezó, o el primero. */
export function currentPeriodId(periods: Options['periods'], today: string): string {
  const containing = periods.find((p) => (!p.startsOn || p.startsOn <= today) && (!p.endsOn || today <= p.endsOn))
  if (containing) return containing.id
  const started = periods.filter((p) => p.startsOn && p.startsOn <= today)
  return started.at(-1)?.id ?? periods[0]?.id ?? ''
}

function draftOf(row: SheetRow): RowDraft {
  return {
    meeting: gradeSelectFromHundredths(row.meetingValueHundredths),
    judgement: row.conceptualJudgement ?? '',
    conduct: row.conductValueHundredths == null ? '' : String(row.conductValueHundredths),
  }
}

/** Lo que cambió en la fila: el guardado es parcial, lo que no viene no se toca. */
export function rowPatch(row: SheetRow, draft: RowDraft): Patch | null {
  const patch: Patch = {}
  const meeting = gradeSelectToHundredths(draft.meeting)
  const judgement = draft.judgement.trim() || null
  const conduct = draft.conduct === '' ? null : Number(draft.conduct)
  if (meeting !== row.meetingValueHundredths) patch.meetingValueHundredths = meeting
  if (judgement !== (row.conceptualJudgement ?? null)) patch.conceptualJudgement = judgement
  if (conduct !== row.conductValueHundredths) patch.conductValueHundredths = conduct
  return Object.keys(patch).length > 0 ? patch : null
}

function GrupoRow({
  index,
  row,
  draft,
  sheet,
  scale,
  conduct,
  editable,
  onChange,
}: {
  index: number
  row: SheetRow
  draft: RowDraft
  sheet: Sheet
  scale: GradeRange | null | undefined
  conduct: readonly ConductOption[]
  editable: boolean
  onChange: (patch: Partial<RowDraft>) => void
}) {
  const name = studentFullName(row)
  const hasGrades = periodKind(sheet.period) !== 'DIAGNOSTICO'
  const label = judgementLabelOf(sheet.period)
  return (
    <tr className="align-top">
      <td className="px-2 py-1.5 text-xs text-slate-400">{index + 1}</td>
      <th scope="row" className="px-2 py-1.5 text-left font-medium text-slate-800">
        {name}
      </th>
      <td className="px-2 py-1.5 text-center tabular-nums text-slate-500" title="Notas cargadas en el período">
        {row.assessmentCount}
      </td>
      {hasGrades && (
        <td className="px-2 py-1.5">
          {editable ? (
            <ConductSelect
              value={draft.conduct}
              options={conduct}
              onChange={(value) => onChange({ conduct: value })}
              aria-label={`C (conducta) de ${name}`}
            />
          ) : (
            <span>{conductText(row.conductValueHundredths, conduct)}</span>
          )}
        </td>
      )}
      {hasGrades && (
        <td className="px-2 py-1.5">
          {editable ? (
            <GradeSelect
              value={draft.meeting}
              scale={scale}
              onChange={(value) => onChange({ meeting: value })}
              aria-label={`R (rendimiento) de ${name}`}
              className="w-16 rounded border border-amber-200 bg-amber-50 px-1 py-1 text-sm tabular-nums"
            />
          ) : (
            <span className="tabular-nums">{formatGrade(gradeSelectToHundredths(draft.meeting))}</span>
          )}
        </td>
      )}
      <td className="px-2 py-1.5">
        {editable ? (
          <textarea
            value={draft.judgement}
            rows={2}
            maxLength={2000}
            onChange={(e) => onChange({ judgement: e.target.value })}
            aria-label={`${label} de ${name}`}
            className="w-full min-w-[14rem] rounded border border-slate-300 px-2 py-1 text-sm"
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm text-slate-600">{draft.judgement || '—'}</p>
        )}
      </td>
    </tr>
  )
}

/**
 * Informe general del grupo del período: lo escribe el docente para la reunión y Dirección lo
 * visa. En las reuniones de boletín sin él no se puede cerrar.
 */
export function GroupReportCard({
  gradeBookId,
  periodId,
  report,
  editable,
  onSaved,
}: {
  gradeBookId: string
  periodId: string
  report: NonNullable<Sheet['groupReport']>
  editable: boolean
  onSaved: (body: string | null) => void
}) {
  const [draft, setDraft] = useState(report.body ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    setDraft(report.body ?? '')
  }, [report.body, periodId])

  const dirty = draft.trim() !== (report.body ?? '').trim()
  const filled = (report.body ?? '').trim() !== ''

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await api<{ data: { body: string | null } }>(`/gradebook/${gradeBookId}/periods/${periodId}/group-report`, {
        method: 'PUT',
        body: JSON.stringify({ body: draft.trim() || null }),
      })
      onSaved(res.data.body)
      setMessage({ kind: 'ok', text: 'Informe del grupo guardado.' })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo guardar el informe' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-2 rounded border border-amber-200 bg-white p-3" aria-labelledby={`informe-grupo-${periodId}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`informe-grupo-${periodId}`} className="text-sm font-semibold text-amber-950">
          Informe general del grupo
        </h3>
        <span className={`text-xs ${filled ? 'text-emerald-800' : report.required ? 'text-amber-800' : 'text-slate-500'}`}>
          {filled ? '✓ Cargado' : report.required ? '▲ Falta: se pide para cerrar la reunión' : 'Opcional en este período'}
        </span>
      </header>
      {editable ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            maxLength={10000}
            aria-label="Texto del informe del grupo"
            placeholder="Cómo trabajó el grupo en el período: avances, dificultades, propuestas para la reunión…"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
          <div className="flex items-center justify-end gap-3">
            {message && (
              <span role={message.kind === 'error' ? 'alert' : 'status'} className={`text-xs ${message.kind === 'error' ? 'text-red-700' : 'text-emerald-800'}`}>
                {message.text}
              </span>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="rounded bg-teal-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white hover:bg-teal-800 disabled:opacity-40"
            >
              {saving ? 'Guardando…' : 'Guardar informe'}
            </button>
          </div>
        </>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-slate-700">{report.body?.trim() || 'Sin informe cargado.'}</p>
      )}
    </section>
  )
}

/**
 * Cierre de un período para todo el grupo: C (conducta), R (rendimiento) y el texto de cada alumno
 * en una tabla, como se pasa en la planilla, y el informe general del grupo. Es la forma rápida de cerrar una entrega; la carta por alumno sigue para mirar a
 * uno solo con todas sus notas.
 */
export default function CierreGrupoTable({
  gradeBookId,
  onDirtyChange,
}: {
  gradeBookId: string
  /** El padre lo necesita para no cambiar de vista con cambios sin guardar. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [options, setOptions] = useState<Options | null>(null)
  const [periodId, setPeriodId] = useState('')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void api<Options>(`/gradebook/${gradeBookId}/options`)
      .then((opts) => {
        if (cancelled) return
        setOptions(opts)
        setPeriodId((current) => current || currentPeriodId(opts.periods, todayYmdUruguay()))
      })
      .catch((err) => {
        if (!cancelled) setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudieron cargar los períodos' })
      })
    return () => {
      cancelled = true
    }
  }, [gradeBookId])

  const loadSheet = useCallback(async () => {
    if (!periodId) return
    setLoading(true)
    try {
      const res = await api<Sheet>(`/gradebook/${gradeBookId}/periods/${periodId}`)
      setSheet(res)
      setDrafts(Object.fromEntries(res.students.map((row) => [row.studentId, draftOf(row)])))
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo cargar el período' })
    } finally {
      setLoading(false)
    }
  }, [gradeBookId, periodId])

  useEffect(() => {
    void loadSheet()
  }, [loadSheet])

  const entries = useMemo(() => {
    if (!sheet) return []
    return sheet.students.flatMap((row) => {
      const patch = drafts[row.studentId] ? rowPatch(row, drafts[row.studentId]) : null
      return patch ? [{ studentId: row.studentId, ...patch }] : []
    })
  }, [sheet, drafts])
  const dirty = entries.length > 0

  useUnsavedChangesWarning(dirty)
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  async function save() {
    if (!dirty) return
    setSaving(true)
    setMessage(null)
    try {
      await api(`/gradebook/${gradeBookId}/periods/${periodId}/grades`, { method: 'PUT', body: JSON.stringify({ entries }) })
      setMessage({ kind: 'ok', text: `Guardado: ${entries.length} alumno${entries.length === 1 ? '' : 's'}.` })
      await loadSheet()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo guardar' })
    } finally {
      setSaving(false)
    }
  }

  const editable = Boolean(sheet?.canEdit) && !saving
  const conduct = options?.conduct ?? []

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="cierre-grupo-periodo" className="font-medium text-slate-700">
          Período
        </label>
        <select
          id="cierre-grupo-periodo"
          value={periodId}
          onChange={(e) => {
            if (!confirmDiscard(dirty, DISCARD_MESSAGE)) return
            setMessage(null)
            setPeriodId(e.target.value)
          }}
          className="min-w-[12rem] rounded border border-slate-300 bg-white px-2 py-1.5"
        >
          {(options?.periods ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {sheet?.state.status === 'CLOSED' && <span className="text-xs text-slate-500">Cerrado: sólo lectura.</span>}
        {sheet && !sheet.canEdit && sheet.state.status !== 'CLOSED' && (
          <span className="text-xs text-slate-500">No se puede editar todavía.</span>
        )}
      </div>

      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-sm ${message.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}
        >
          {message.text}
        </p>
      )}

      {loading && !sheet ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando el período…
        </p>
      ) : (
        sheet && (
          <ScrollRegion label="Cierre del grupo por período" className="overflow-x-auto rounded border border-amber-200 bg-white">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-amber-100 bg-amber-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-2 py-2 text-left font-medium">N.º</th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">Alumno</th>
                  <th scope="col" className="px-2 py-2 text-center font-medium">Notas</th>
                  {periodKind(sheet.period) !== 'DIAGNOSTICO' && (
                    <>
                      <th scope="col" className="px-2 py-2 text-left font-medium" title="Conducta en la asignatura">C · Conducta</th>
                      <th scope="col" className="px-2 py-2 text-left font-medium" title="Rendimiento: la nota del boletín">R · Rendimiento</th>
                    </>
                  )}
                  <th scope="col" className="px-2 py-2 text-left font-medium">{judgementLabelOf(sheet.period)}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sheet.students.map((row, index) => (
                  <GrupoRow
                    key={row.studentId}
                    index={index}
                    row={row}
                    draft={drafts[row.studentId] ?? draftOf(row)}
                    sheet={sheet}
                    scale={options?.periodScale}
                    conduct={conduct}
                    editable={editable}
                    onChange={(patch) =>
                      setDrafts((prev) => ({ ...prev, [row.studentId]: { ...(prev[row.studentId] ?? draftOf(row)), ...patch } }))
                    }
                  />
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )
      )}

      {sheet?.groupReport && (sheet.groupReport.required || sheet.period.isMeeting || sheet.groupReport.body) && (
        <GroupReportCard
          gradeBookId={gradeBookId}
          periodId={periodId}
          report={sheet.groupReport}
          editable={Boolean(sheet.canEdit)}
          onSaved={(body) =>
            setSheet((prev) => (prev?.groupReport ? { ...prev, groupReport: { ...prev.groupReport, body } } : prev))
          }
        />
      )}

      {sheet?.canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-xs text-slate-500">
            {dirty ? `${entries.length} alumno${entries.length === 1 ? '' : 's'} con cambios` : 'Sin cambios'}
          </span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="rounded bg-teal-700 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white hover:bg-teal-800 disabled:opacity-40"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            type="button"
            onClick={() => sheet && setDrafts(Object.fromEntries(sheet.students.map((row) => [row.studentId, draftOf(row)])))}
            disabled={!dirty || saving}
            className="px-2 py-2 text-sm font-semibold uppercase tracking-wide text-red-600 hover:text-red-700 disabled:opacity-40"
          >
            Cancelar
          </button>
        </div>
      )}
    </section>
  )
}
