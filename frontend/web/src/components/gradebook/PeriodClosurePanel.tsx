'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, Loader2, Lock, LockOpen } from 'lucide-react'
import { api } from '@/lib/api/client'
import { formatHundredths } from '@/lib/academic-config/grade-value'
import { levelStyle } from '@/lib/academic-config/level-tokens'
import { parseToHundredths } from '@/lib/academic-config/grade-value'
import { studentFullName } from '@/lib/gradebook/labels'

type Descriptor = {
  levelId: string
  label: string
  descriptor: string | null
  colorToken: string | null
  iconToken: string | null
  isAlert: boolean
} | null

type Row = {
  studentId: string
  lastName: string
  firstName: string
  assessmentCount: number
  suggestedAverageHundredths: number | null
  valueHundredths: number | null
  conceptualJudgement: string | null
  descriptor: Descriptor
}

type Blocker = { code: 'MISSING_GRADES' | 'MISSING_JUDGEMENT'; studentIds: string[] }

type Sheet = {
  period: {
    id: string
    name: string
    closesOn: string | null
    requiresGeneralGrade: boolean
    requiresConceptualJudgement: boolean
  }
  state: { status: 'OPEN' | 'CLOSED' | 'REOPENED'; closedAt: string | null; closedLate: boolean; reopenReason: string | null }
  canEdit: boolean
  blockers: Blocker[]
  students: Row[]
}

const BLOCKER_LABELS: Record<Blocker['code'], string> = {
  MISSING_GRADES: 'sin calificación general',
  MISSING_JUDGEMENT: 'sin juicio conceptual',
}

type Draft = Record<string, { value: string; judgement: string }>

function buildDraft(rows: Row[], decimals: number): Draft {
  const draft: Draft = {}
  for (const row of rows) {
    draft[row.studentId] = {
      value: row.valueHundredths == null ? '' : formatHundredths(row.valueHundredths, decimals),
      judgement: row.conceptualJudgement ?? '',
    }
  }
  return draft
}

/** El descriptor viaja siempre con texto además del color (RNF 7.2). */
function DescriptorBadge({ descriptor }: { descriptor: Descriptor }) {
  if (!descriptor) return <span className="text-xs text-gray-400">—</span>
  const style = levelStyle(descriptor)
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${style.badgeClass}`}
      title={descriptor.descriptor ?? descriptor.label}
    >
      <span aria-hidden>{style.symbol}</span>
      {descriptor.label}
    </span>
  )
}

export default function PeriodClosurePanel({
  gradeBookId,
  periodId,
  decimals,
}: {
  gradeBookId: string
  periodId: string
  decimals: number
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [draft, setDraft] = useState<Draft>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<Sheet>(`/gradebook/${gradeBookId}/periods/${periodId}`)
      setSheet(res)
      setDraft(buildDraft(res.students, decimals))
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo cargar el cierre' })
    } finally {
      setLoading(false)
    }
  }, [gradeBookId, periodId, decimals])

  useEffect(() => {
    void load()
  }, [load])

  async function run(action: 'save' | 'close') {
    if (!sheet) return
    setBusy(true)
    setMessage(null)
    try {
      if (action === 'save') {
        const entries = sheet.students.map((row) => ({
          studentId: row.studentId,
          valueHundredths: parseToHundredths(draft[row.studentId]?.value ?? ''),
          conceptualJudgement: draft[row.studentId]?.judgement.trim() || null,
        }))
        await api(`/gradebook/${gradeBookId}/periods/${periodId}/grades`, {
          method: 'PUT',
          body: JSON.stringify({ entries }),
        })
        setMessage({ kind: 'ok', text: 'Cierre guardado.' })
      } else {
        const res = await api<{ closedLate: boolean }>(`/gradebook/${gradeBookId}/periods/${periodId}/close`, {
          method: 'POST',
        })
        setMessage({
          kind: 'ok',
          text: res.closedLate ? 'Período cerrado (fuera de plazo).' : 'Período cerrado.',
        })
      }
      await load()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo completar la acción' })
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando cierre…
      </p>
    )
  }

  if (!sheet) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        {message?.text ?? 'No se pudo cargar el cierre'}
      </p>
    )
  }

  const closed = sheet.state.status === 'CLOSED'
  const readOnly = !sheet.canEdit

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          {closed ? <Lock className="h-4 w-4 text-gray-500" aria-hidden /> : <LockOpen className="h-4 w-4 text-emerald-600" aria-hidden />}
          <h3 className="text-sm font-semibold text-gray-900">{sheet.period.name}</h3>
          <span className="text-xs text-gray-500">
            {closed ? 'Cerrado' : sheet.state.status === 'REOPENED' ? 'Reabierto' : 'Abierto'}
            {sheet.state.closedLate && ' · fuera de plazo'}
          </span>
        </div>
        {sheet.period.closesOn && (
          <p className="flex items-center gap-1 text-xs text-gray-500">
            <CalendarCheck className="h-3.5 w-3.5" aria-hidden />
            Cierra el {sheet.period.closesOn}
          </p>
        )}
      </header>

      {sheet.state.status === 'REOPENED' && sheet.state.reopenReason && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Reabierto por administración. Motivo: {sheet.state.reopenReason}
        </p>
      )}

      {sheet.blockers.length > 0 && !closed && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span aria-hidden>▲ </span>
          Falta para poder cerrar:{' '}
          {sheet.blockers.map((b) => `${b.studentIds.length} ${BLOCKER_LABELS[b.code]}`).join(' · ')}
        </p>
      )}

      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-sm ${message.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}
        >
          {message.text}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Estudiante</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Promedio orientativo
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Calificación</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Descriptor</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Juicio conceptual</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sheet.students.map((row) => (
              <tr key={row.studentId}>
                <td className="px-3 py-1.5 text-sm text-gray-900">{studentFullName(row)}</td>
                <td className="px-3 py-1.5 text-sm text-gray-600">
                  {/* Indicador automático (RF-061): sugerencia, no reemplaza la decisión del docente. */}
                  <span title="Indicador automático / promedio orientativo">
                    {formatHundredths(row.suggestedAverageHundredths, decimals)}
                  </span>
                  <span className="ml-1 text-xs text-gray-400">({row.assessmentCount})</span>
                </td>
                <td className="px-3 py-1.5">
                  <input
                    value={draft[row.studentId]?.value ?? ''}
                    disabled={readOnly}
                    inputMode="decimal"
                    aria-label={`Calificación del período de ${studentFullName(row)}`}
                    onChange={(e) =>
                      setDraft({ ...draft, [row.studentId]: { ...draft[row.studentId], value: e.target.value } })
                    }
                    className="w-20 rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-100"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <DescriptorBadge descriptor={row.descriptor} />
                </td>
                <td className="px-3 py-1.5">
                  <textarea
                    value={draft[row.studentId]?.judgement ?? ''}
                    disabled={readOnly}
                    rows={1}
                    aria-label={`Juicio conceptual de ${studentFullName(row)}`}
                    onChange={(e) =>
                      setDraft({ ...draft, [row.studentId]: { ...draft[row.studentId], judgement: e.target.value } })
                    }
                    className="w-full min-w-[200px] rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-100"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void run('save')}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            Guardar
          </button>
          <button
            type="button"
            onClick={() => void run('close')}
            disabled={busy || sheet.blockers.length > 0}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            <Lock className="h-4 w-4" aria-hidden />
            Cerrar período
          </button>
          {sheet.blockers.length > 0 && (
            <span className="text-xs text-gray-500">Completá lo que falta para poder cerrar.</span>
          )}
        </div>
      )}
    </div>
  )
}
