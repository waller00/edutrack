'use client'

import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Loader2, Plus } from 'lucide-react'
import { api } from '@/lib/api/client'
import GradeSheet from './GradeSheet'
import MoodleImportPanel from './MoodleImportPanel'

type Period = { id: string; code: string; name: string }
type Scale = { id: string; name: string; kind: 'NUMERIC' | 'ORDINAL'; decimals: number }
type ActivityType = { id: string; name: string; scope: 'GLOBAL' | 'TEACHER' }

type Assessment = {
  id: string
  periodId: string
  period: Period | null
  date: string
  title: string
  activityType: { id: string; name: string } | null
  gradingScale: Scale | null
  gradedCount: number
}

type Options = { periods: Period[]; scales: Scale[]; activityTypes: ActivityType[] }

function NewAssessmentForm({
  options,
  onCreate,
  busy,
}: {
  options: Options
  onCreate: (body: Record<string, unknown>) => Promise<void>
  busy: boolean
}) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [periodId, setPeriodId] = useState('')
  const [gradingScaleId, setGradingScaleId] = useState('')
  const [activityTypeId, setActivityTypeId] = useState('')

  const canSubmit = title.trim() !== '' && periodId !== '' && gradingScaleId !== '' && !busy

  return (
    <form
      className="grid gap-2 rounded-xl border border-gray-200 bg-white p-3 sm:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!canSubmit) return
        void onCreate({
          title: title.trim(),
          date,
          periodId,
          gradingScaleId,
          ...(activityTypeId ? { activityTypeId } : {}),
        }).then(() => setTitle(''))
      }}
    >
      <label className="sm:col-span-2">
        <span className="mb-1 block text-xs text-gray-600">Título</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Escrito 1"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </label>
      <label>
        <span className="mb-1 block text-xs text-gray-600">Fecha</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </label>
      <label>
        <span className="mb-1 block text-xs text-gray-600">Período</span>
        <select
          value={periodId}
          onChange={(e) => setPeriodId(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">Elegí…</option>
          {options.periods.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="mb-1 block text-xs text-gray-600">Escala</span>
        <select
          value={gradingScaleId}
          onChange={(e) => setGradingScaleId(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">Elegí…</option>
          {options.scales.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      <label className="sm:col-span-2">
        <span className="mb-1 block text-xs text-gray-600">Tipo de actividad (opcional)</span>
        <select
          value={activityTypeId}
          onChange={(e) => setActivityTypeId(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">Sin especificar</option>
          {options.activityTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <div className="flex items-end sm:col-span-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Crear evaluación
        </button>
      </div>
    </form>
  )
}

export default function AssessmentsPanel({
  gradeBookId,
  canGrade,
}: {
  gradeBookId: string
  canGrade: boolean
}) {
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [options, setOptions] = useState<Options | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, opts] = await Promise.all([
        api<{ data: Assessment[] }>(`/gradebook/${gradeBookId}/assessments`),
        api<Options>(`/gradebook/${gradeBookId}/options`),
      ])
      setAssessments(list.data)
      setOptions(opts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las evaluaciones')
    } finally {
      setLoading(false)
    }
  }, [gradeBookId])

  useEffect(() => {
    void load()
  }, [load])

  async function create(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ data: Assessment }>(`/gradebook/${gradeBookId}/assessments`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setSelected(res.data.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la evaluación')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando evaluaciones…
      </p>
    )
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-gray-400" aria-hidden />
        <h2 className="text-sm font-semibold text-gray-900">Evaluaciones</h2>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {canGrade && options && <NewAssessmentForm options={options} onCreate={create} busy={busy} />}

      {canGrade && options && (
        <MoodleImportPanel
          gradeBookId={gradeBookId}
          periods={options.periods}
          scales={options.scales}
          onImported={() => void load()}
        />
      )}

      {assessments.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-5 text-sm text-gray-500">
          Todavía no hay evaluaciones en esta libreta.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {assessments.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => setSelected(selected === a.id ? null : a.id)}
                aria-expanded={selected === a.id}
                className="flex w-full items-baseline gap-3 px-4 py-2 text-left transition hover:bg-gray-50"
              >
                <span className="text-sm font-medium text-gray-900">{a.title}</span>
                <span className="text-xs text-gray-500">{a.date}</span>
                {a.period && <span className="text-xs text-gray-500">· {a.period.name}</span>}
                {a.activityType && <span className="text-xs text-gray-500">· {a.activityType.name}</span>}
                <span className="ml-auto text-xs text-gray-500">{a.gradedCount} calificadas</span>
              </button>
              {selected === a.id && (
                <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-3">
                  <GradeSheet gradeBookId={gradeBookId} assessmentId={a.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
