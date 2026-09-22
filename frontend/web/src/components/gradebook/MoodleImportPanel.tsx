'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'

type PreviewItem = {
  moodleGradeItemId: number
  name: string
  moodleMin: number
  moodleMax: number
  existingAssessmentId: string | null
  matched: number
  unmatched: number
}

type Preview = {
  moodleCourseId: number
  items: PreviewItem[]
  studentsWithoutMoodleAccount: number
}

type Option = { id: string; name: string }

/**
 * Importación Moodle → libreta.
 *
 * Dos pasos a propósito: primero se muestra qué traería —cuántas notas mapean, cuáles no y qué
 * ítems ya se importaron antes— y recién después el docente confirma. Moodle aporta notas; la
 * libreta sigue siendo la fuente de verdad.
 */
export default function MoodleImportPanel({
  gradeBookId,
  periods,
  scales,
  onImported,
}: {
  gradeBookId: string
  periods: Option[]
  scales: Option[]
  onImported: () => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [periodId, setPeriodId] = useState('')
  const [scaleId, setScaleId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setPreview(await api<Preview>(`/gradebook/${gradeBookId}/moodle/preview`))
      setUnavailable(null)
    } catch (err) {
      // Sin Moodle configurado o sin curso sincronizado el panel se oculta: la libreta funciona igual.
      setUnavailable(err instanceof Error ? err.message : 'Moodle no disponible')
    } finally {
      setLoading(false)
    }
  }, [gradeBookId])

  useEffect(() => {
    void load()
  }, [load])

  async function runImport() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await api<{ data: Array<{ name: string; created: number; updated: number; skippedUnmatched: number }> }>(
        `/gradebook/${gradeBookId}/moodle/import`,
        {
          method: 'POST',
          body: JSON.stringify({
            moodleGradeItemIds: [...selected],
            periodId,
            gradingScaleId: scaleId,
          }),
        },
      )
      const created = res.data.reduce((acc, r) => acc + r.created, 0)
      const updated = res.data.reduce((acc, r) => acc + r.updated, 0)
      setMessage({ kind: 'ok', text: `Importado: ${created} nueva(s), ${updated} actualizada(s).` })
      setSelected(new Set())
      await load()
      onImported()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo importar' })
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-4 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Consultando Moodle…
      </p>
    )
  }

  if (unavailable || !preview) {
    return (
      <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        Importación desde Moodle no disponible: {unavailable}
      </p>
    )
  }

  const canImport = selected.size > 0 && periodId !== '' && scaleId !== '' && !busy

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
      <header className="flex items-center gap-2">
        <Download className="h-4 w-4 text-gray-400" aria-hidden />
        <h3 className="text-sm font-semibold text-gray-900">Importar notas desde Moodle</h3>
      </header>

      {preview.studentsWithoutMoodleAccount > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span aria-hidden>▲ </span>
          {preview.studentsWithoutMoodleAccount} estudiante(s) del grupo no tienen cuenta Moodle
          sincronizada: sus notas no se van a poder traer.
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

      {preview.items.length === 0 ? (
        <p className="text-sm text-gray-500">El curso de Moodle no tiene ítems calificables.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {preview.items.map((item) => (
            <li key={item.moodleGradeItemId} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <label className="flex items-center gap-2 text-sm text-gray-900">
                <input
                  type="checkbox"
                  checked={selected.has(item.moodleGradeItemId)}
                  aria-label={`Importar ${item.name}`}
                  onChange={() => {
                    const next = new Set(selected)
                    if (next.has(item.moodleGradeItemId)) next.delete(item.moodleGradeItemId)
                    else next.add(item.moodleGradeItemId)
                    setSelected(next)
                  }}
                />
                {item.name}
              </label>
              <span className="text-xs text-gray-500">
                {item.moodleMin}–{item.moodleMax} en Moodle
              </span>
              <span className="ml-auto text-xs text-gray-600">
                {item.matched} nota(s)
                {item.unmatched > 0 && ` · ${item.unmatched} sin mapear`}
              </span>
              {item.existingAssessmentId && (
                <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-600">
                  ya importado · se actualiza
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {preview.items.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <label>
            <span className="mb-1 block text-xs text-gray-600">Período destino</span>
            <select
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">Elegí…</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs text-gray-600">Escala destino</span>
            <select
              value={scaleId}
              onChange={(e) => setScaleId(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">Elegí…</option>
              {scales.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void runImport()}
            disabled={!canImport}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            Importar {selected.size > 0 && `(${selected.size})`}
          </button>
          <p className="w-full text-xs text-gray-500">
            Las notas se convierten proporcionalmente a la escala elegida. Un período cerrado no se toca.
          </p>
        </div>
      )}
    </section>
  )
}
