'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Download, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import ScrollRegion from '@/components/common/ScrollRegion'
import { formatGrade } from '@/lib/gradebook/grade-scale'

type RowStatus = 'NEW' | 'UPDATE' | 'UNCHANGED' | 'EDITED_IN_EDUTRACK'

type PreviewRow = {
  studentId: string
  studentName: string
  moodleRaw: number
  valueHundredths: number
  currentValueHundredths: number | null
  status: RowStatus
}

type Summary = { new: number; update: number; unchanged: number; editedInEduTrack: number }

type PreviewItem = {
  moodleGradeItemId: number
  name: string
  moodleMin: number
  moodleMax: number
  existingAssessmentId: string | null
  matched: number
  unmatched: number
  /** Vienen cuando hay escala elegida: lo mismo que va a hacer la importación, alumno por alumno. */
  rows?: PreviewRow[]
  summary?: Summary
}

type ImportResult = {
  name: string
  created: number
  updated: number
  skippedUnmatched: number
  skippedEditedInEduTrack?: number
}

/** Siempre en texto: el estado no puede depender sólo del color. */
const STATUS_TEXT: Record<RowStatus, string> = {
  NEW: 'Nueva',
  UPDATE: 'Se actualiza',
  UNCHANGED: 'Sin cambios',
  EDITED_IN_EDUTRACK: 'Corregida en EduTrack: no se toca',
}

const STATUS_CLASS: Record<RowStatus, string> = {
  NEW: 'text-emerald-800',
  UPDATE: 'text-blue-800',
  UNCHANGED: 'text-gray-500',
  EDITED_IN_EDUTRACK: 'text-amber-800',
}

export function summaryText(summary: Summary): string {
  const parts: string[] = []
  if (summary.new > 0) parts.push(`${summary.new} nueva(s)`)
  if (summary.update > 0) parts.push(`${summary.update} se actualiza(n)`)
  if (summary.unchanged > 0) parts.push(`${summary.unchanged} sin cambios`)
  if (summary.editedInEduTrack > 0) parts.push(`${summary.editedInEduTrack} corregida(s) en EduTrack (no se toca)`)
  return parts.join(' · ')
}

/** "Importado: 3 nueva(s), 1 actualizada(s). 1 corregida(s) en EduTrack no se tocó/tocaron." */
export function importResultText(results: readonly ImportResult[]): string {
  const created = results.reduce((acc, r) => acc + r.created, 0)
  const updated = results.reduce((acc, r) => acc + r.updated, 0)
  const kept = results.reduce((acc, r) => acc + (r.skippedEditedInEduTrack ?? 0), 0)
  const base = `Importado: ${created} nueva(s), ${updated} actualizada(s).`
  return kept > 0 ? `${base} ${kept} corregida(s) en EduTrack no se tocaron.` : base
}

function formatMoodle(raw: number, max: number): string {
  const fmt = (n: number) => n.toLocaleString('es-UY', { maximumFractionDigits: 2 })
  return `${fmt(raw)} / ${fmt(max)}`
}

function RowsTable({ item }: { item: PreviewItem }) {
  return (
    <ScrollRegion label={`Notas de ${item.name}`} className="overflow-x-auto rounded border border-gray-200">
      <table className="w-full min-w-[520px] text-xs">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th scope="col" className="px-2 py-1.5 font-medium">Alumno</th>
            <th scope="col" className="px-2 py-1.5 font-medium">Moodle</th>
            <th scope="col" className="px-2 py-1.5 font-medium">Queda</th>
            <th scope="col" className="px-2 py-1.5 font-medium">Hoy en EduTrack</th>
            <th scope="col" className="px-2 py-1.5 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {(item.rows ?? []).map((row) => (
            <tr key={row.studentId}>
              <td className="px-2 py-1.5 text-gray-900">{row.studentName}</td>
              <td className="px-2 py-1.5 text-gray-700">{formatMoodle(row.moodleRaw, item.moodleMax)}</td>
              <td className="px-2 py-1.5 font-medium text-gray-900">{formatGrade(row.valueHundredths)}</td>
              <td className="px-2 py-1.5 text-gray-700">{formatGrade(row.currentValueHundredths)}</td>
              <td className={`px-2 py-1.5 ${STATUS_CLASS[row.status]}`}>{STATUS_TEXT[row.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  )
}

function ItemRow({
  item,
  checked,
  onToggle,
}: {
  item: PreviewItem
  checked: boolean
  onToggle: () => void
}) {
  const [open, setOpen] = useState(false)
  const hasRows = (item.rows?.length ?? 0) > 0
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <li className="space-y-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-gray-900">
          <input type="checkbox" checked={checked} aria-label={`Importar ${item.name}`} onChange={onToggle} />
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
      </div>
      {item.summary && hasRows && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-700">{summaryText(item.summary)}</span>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="inline-flex items-center gap-0.5 text-emerald-700 hover:underline"
          >
            <Chevron className="h-3.5 w-3.5" aria-hidden />
            {open ? 'Ocultar notas' : 'Ver notas'}
          </button>
        </div>
      )}
      {open && hasRows && <RowsTable item={item} />}
    </li>
  )
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
 * Dos pasos a propósito: primero se muestra qué traería —alumno por alumno, con la nota convertida
 * a la escala elegida, la que tiene hoy y si se crea, se actualiza o no se toca porque alguien la
 * corrigió en la libreta— y recién después el docente confirma. Moodle aporta notas; la libreta
 * sigue siendo la fuente de verdad.
 */
export default function MoodleImportPanel({
  gradeBookId,
  periods,
  scales,
  defaultScaleId = '',
  onImported,
}: {
  gradeBookId: string
  periods: Option[]
  scales: Option[]
  /** La escala del nivel de la libreta, preelegida: importar en 1–10 a bachillerato es un error. */
  defaultScaleId?: string
  onImported: () => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [periodId, setPeriodId] = useState('')
  const [scaleId, setScaleId] = useState(defaultScaleId)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const latest = useRef(0)

  // Con escala, el detalle alumno por alumno viene convertido a esa escala: cambiarla lo vuelve a pedir.
  const load = useCallback(async () => {
    const request = ++latest.current
    setLoading(true)
    const query = scaleId ? `?gradingScaleId=${encodeURIComponent(scaleId)}` : ''
    try {
      const next = await api<Preview>(`/gradebook/${gradeBookId}/moodle/preview${query}`)
      if (request !== latest.current) return
      setPreview(next)
      setUnavailable(null)
    } catch (err) {
      if (request !== latest.current) return
      // Sin Moodle configurado o sin curso sincronizado el panel se oculta: la libreta funciona igual.
      setUnavailable(err instanceof Error ? err.message : 'Moodle no disponible')
    } finally {
      if (request === latest.current) setLoading(false)
    }
  }, [gradeBookId, scaleId])

  useEffect(() => {
    void load()
  }, [load])

  async function runImport() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await api<{ data: ImportResult[] }>(
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
      setMessage({ kind: 'ok', text: importResultText(res.data) })
      setSelected(new Set())
      await load()
      onImported()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo importar' })
    } finally {
      setBusy(false)
    }
  }

  // Sólo la primera vez: al cambiar la escala el panel queda a la vista mientras se recalcula.
  if (loading && !preview && !unavailable) {
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
            <ItemRow
              key={item.moodleGradeItemId}
              item={item}
              checked={selected.has(item.moodleGradeItemId)}
              onToggle={() => {
                const next = new Set(selected)
                if (next.has(item.moodleGradeItemId)) next.delete(item.moodleGradeItemId)
                else next.add(item.moodleGradeItemId)
                setSelected(next)
              }}
            />
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
            Las notas se convierten proporcionalmente a la escala elegida. Un período cerrado no se toca,
            y una nota corregida en EduTrack tampoco: Moodle no la pisa.
          </p>
        </div>
      )}
    </section>
  )
}
