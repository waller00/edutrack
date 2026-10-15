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
}

type RowDraft = { grade: string; meeting: string; judgement: string; conduct: string }
type Patch = {
  valueHundredths?: number | null
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
    grade: gradeSelectFromHundredths(row.valueHundredths),
    meeting: gradeSelectFromHundredths(row.meetingValueHundredths),
    judgement: row.conceptualJudgement ?? '',
    conduct: row.conductValueHundredths == null ? '' : String(row.conductValueHundredths),
  }
}

/** Lo que cambió en la fila: el guardado es parcial, lo que no viene no se toca. */
export function rowPatch(row: SheetRow, draft: RowDraft): Patch | null {
  const patch: Patch = {}
  const grade = gradeSelectToHundredths(draft.grade)
  const meeting = gradeSelectToHundredths(draft.meeting)
  const judgement = draft.judgement.trim() || null
  const conduct = draft.conduct === '' ? null : Number(draft.conduct)
  if (grade !== row.valueHundredths) patch.valueHundredths = grade
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
      {hasGrades &&
        (['grade', 'meeting'] as const).map((field) => (
          <td key={field} className="px-2 py-1.5">
            {editable ? (
              <GradeSelect
                value={draft[field]}
                scale={scale}
                onChange={(value) => onChange({ [field]: value })}
                aria-label={`${field === 'grade' ? 'C' : 'R'} de ${name}`}
                className="w-16 rounded border border-amber-200 bg-amber-50 px-1 py-1 text-sm tabular-nums"
              />
            ) : (
              <span className="tabular-nums">{formatGrade(gradeSelectToHundredths(draft[field]))}</span>
            )}
          </td>
        ))}
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
      {sheet.period.isMeeting && (
        <td className="px-2 py-1.5">
          {editable ? (
            <ConductSelect
              value={draft.conduct}
              options={conduct}
              onChange={(value) => onChange({ conduct: value })}
              aria-label={`Conducta de ${name}`}
            />
          ) : (
            <span>{conductText(row.conductValueHundredths, conduct)}</span>
          )}
        </td>
      )}
    </tr>
  )
}

/**
 * Cierre de un período para todo el grupo: C, R, informe y conducta en una tabla, como se pasa en
 * la planilla. Es la forma rápida de cerrar una entrega; la carta por alumno sigue para mirar a
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
                      <th scope="col" className="px-2 py-2 text-left font-medium" title="Calificación del docente">C</th>
                      <th scope="col" className="px-2 py-2 text-left font-medium" title="Nota de reunión">R</th>
                    </>
                  )}
                  <th scope="col" className="px-2 py-2 text-left font-medium">{judgementLabelOf(sheet.period)}</th>
                  {sheet.period.isMeeting && <th scope="col" className="px-2 py-2 text-left font-medium">Conducta</th>}
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
