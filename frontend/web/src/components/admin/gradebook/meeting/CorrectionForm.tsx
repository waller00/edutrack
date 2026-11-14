'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import {
  assessmentChoices,
  correctionReasonError,
  correctionRequest,
  correctionTitle,
  initialCorrection,
  performanceChoices,
  type Choice,
  type CorrectionTarget,
  type CorrectionValues,
} from '@/lib/gradebook/meeting-student'
import type { GradeRange } from '@/lib/gradebook/grade-scale'

const FIELD = 'w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm'

const VALUE_LABEL: Record<CorrectionTarget['kind'], string> = {
  assessment: 'Nota',
  performance: 'R (rendimiento)',
  conduct: 'C (conducta)',
  judgement: '',
}

function choicesFor(
  target: CorrectionTarget,
  values: CorrectionValues,
  periodScale: GradeRange | null,
  conductOptions: ReadonlyArray<{ valueHundredths: number; label: string }>,
): Choice[] | null {
  if (target.kind === 'assessment') {
    return assessmentChoices(target.assessment.scale, values.value === '' ? null : Number(values.value))
  }
  if (target.kind === 'performance') return performanceChoices(periodScale)
  if (target.kind === 'conduct') return conductOptions.map((o) => ({ value: String(o.valueHundredths), label: o.label }))
  return null
}

/**
 * Corrección de administración desde la reunión: una nota de una evaluación, la R, la C o el juicio
 * del docente. Aunque la libreta esté cerrada, sin reabrirla. Siempre con motivo: queda en el
 * historial y en la auditoría, y al docente le llega el aviso.
 */
export default function CorrectionForm({
  target,
  studentLabel,
  periodScale,
  conductOptions,
  onCancel,
  onSaved,
}: Readonly<{
  target: CorrectionTarget
  /** «de Pérez, Ana»: rotula los controles. */
  studentLabel: string
  periodScale: GradeRange | null
  conductOptions: ReadonlyArray<{ valueHundredths: number; label: string }>
  onCancel: () => void
  onSaved: () => void
}>) {
  const [values, setValues] = useState<CorrectionValues>(() => initialCorrection(target))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const title = correctionTitle(target)
  const choices = choicesFor(target, values, periodScale, conductOptions)
  const set = (patch: Partial<CorrectionValues>) => setValues((prev) => ({ ...prev, ...patch }))

  async function save() {
    const reasonError = correctionReasonError(values.reason)
    if (reasonError) {
      setError(reasonError)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const { path, body } = correctionRequest(target, values)
      await api(path, { method: 'PUT', body: JSON.stringify(body) })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la corrección.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      aria-label={`${title} ${studentLabel}`}
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3"
    >
      <p className="text-xs font-semibold text-amber-900">{title}</p>
      {choices && (
        <label className="block text-xs text-gray-700">
          {VALUE_LABEL[target.kind]}
          <select
            className={`${FIELD} mt-1`}
            value={values.value}
            disabled={values.isAbsent}
            onChange={(e) => set({ value: e.target.value })}
          >
            <option value="">Sin nota</option>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {target.kind === 'assessment' && (
        <>
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input type="checkbox" checked={values.isAbsent} onChange={(e) => set({ isAbsent: e.target.checked })} />
            {' '}No rindió
          </label>
          <label className="block text-xs text-gray-700">
            Comentario{' '}
            <input className={`${FIELD} mt-1`} value={values.comment} maxLength={2000} onChange={(e) => set({ comment: e.target.value })} />
          </label>
        </>
      )}
      {target.kind === 'judgement' && (
        <label className="block text-xs text-gray-700">
          Juicio del docente{' '}
          <textarea className={`${FIELD} mt-1 min-h-[72px]`} value={values.text} maxLength={2000} onChange={(e) => set({ text: e.target.value })} />
        </label>
      )}
      <label className="block text-xs text-gray-700">
        Motivo de la corrección <span className="text-gray-500">(obligatorio: lo recibe el docente)</span>
        <input
          className={`${FIELD} mt-1`}
          value={values.reason}
          maxLength={500}
          aria-required="true"
          onChange={(e) => set({ reason: e.target.value })}
        />
      </label>
      {error && (
        <p role="alert" className="rounded bg-red-50 px-2 py-1 text-xs text-red-800">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-lg bg-amber-700 px-3 py-1 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Guardar corrección
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="btn-secondary text-sm">
          Cancelar
        </button>
      </div>
    </form>
  )
}
