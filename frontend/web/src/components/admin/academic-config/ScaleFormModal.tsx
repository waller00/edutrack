'use client'

import { useState } from 'react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import ConfigModal from './ConfigModal'
import { Check, Field, inputClass } from './fields'
import {
  draftFromScale,
  emptyLevel,
  scalePayload,
  validateScale,
  type LevelDraft,
  type ScaleDraft,
} from './scale-draft'
import type { GradingScale } from '@/lib/academic-config/types'

export { scalePayload }

type Props = {
  scale: GradingScale | null
  saving: boolean
  error: string | null
  onSave: (draft: ScaleDraft) => void
  onClose: () => void
}

function LevelEditor({
  level,
  index,
  onPatch,
  onRemove,
}: {
  level: LevelDraft
  index: number
  onPatch: (patch: Partial<LevelDraft>) => void
  onRemove: () => void
}) {
  const n = index + 1
  return (
    <li className="space-y-2 rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600">Tramo {n}</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Quitar el tramo ${n}`}
          className="text-red-600 hover:text-red-800"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="Código" htmlFor={`level-code-${n}`}>
          <input
            id={`level-code-${n}`}
            value={level.code}
            onChange={(e) => onPatch({ code: e.target.value.toUpperCase() })}
            className={inputClass}
          />
        </Field>
        <Field label="Etiqueta" htmlFor={`level-label-${n}`}>
          <input id={`level-label-${n}`} value={level.label} onChange={(e) => onPatch({ label: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Desde" htmlFor={`level-min-${n}`}>
          <input id={`level-min-${n}`} value={level.min} onChange={(e) => onPatch({ min: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Hasta" htmlFor={`level-max-${n}`}>
          <input id={`level-max-${n}`} value={level.max} onChange={(e) => onPatch({ max: e.target.value })} className={inputClass} />
        </Field>
      </div>

      <Field label="Descriptor" htmlFor={`level-descriptor-${n}`} hint="Texto que la libreta muestra junto a la calificación (RF-053).">
        <input
          id={`level-descriptor-${n}`}
          value={level.descriptor}
          onChange={(e) => onPatch({ descriptor: e.target.value })}
          className={inputClass}
        />
      </Field>

      <div className="flex flex-wrap gap-4">
        <Check id={`level-passing-${n}`} label="Aprueba" checked={level.isPassing} onChange={(v) => onPatch({ isPassing: v })} />
        <Check
          id={`level-alert-${n}`}
          label="Cuenta como alerta"
          hint="Alimenta los indicadores de riesgo."
          checked={level.isAlert}
          onChange={(v) => onPatch({ isAlert: v })}
        />
      </div>
    </li>
  )
}

export default function ScaleFormModal({ scale, saving, error, onSave, onClose }: Props) {
  const isEdit = scale !== null
  const [draft, setDraft] = useState<ScaleDraft>(() => draftFromScale(scale))
  const [localError, setLocalError] = useState<string | null>(null)

  const usedIn = scale?.usage.assessments ?? 0

  function patch<K extends keyof ScaleDraft>(key: K, value: ScaleDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function patchLevel(index: number, part: Partial<LevelDraft>) {
    setDraft((prev) => ({
      ...prev,
      levels: prev.levels.map((level, i) => (i === index ? { ...level, ...part } : level)),
    }))
  }

  function submit() {
    const problem = validateScale(draft, isEdit)
    setLocalError(problem)
    if (!problem) onSave(draft)
  }

  return (
    <ConfigModal
      title={isEdit ? `Editar ${scale.name}` : 'Nueva escala'}
      saving={saving}
      error={localError ?? error}
      onSubmit={submit}
      onClose={onClose}
    >
      {usedIn > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Esta escala ya se usa en {usedIn} {usedIn === 1 ? 'evaluación' : 'evaluaciones'}. Si cambiás los tramos, las notas ya cargadas
            se vuelven a clasificar con los tramos nuevos: no se borran, pero pueden pasar a otro
            descriptor, y una que quede fuera de todo tramo se muestra sin descriptor.
          </span>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Código" htmlFor="scale-code" hint={isEdit ? 'El código no se cambia: lo referencian las evaluaciones.' : undefined}>
          <input
            id="scale-code"
            value={draft.code}
            disabled={isEdit}
            onChange={(e) => patch('code', e.target.value.toUpperCase())}
            className={`${inputClass} disabled:bg-gray-50`}
          />
        </Field>
        <Field label="Nombre" htmlFor="scale-name">
          <input id="scale-name" value={draft.name} onChange={(e) => patch('name', e.target.value)} className={inputClass} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Tipo" htmlFor="scale-kind" hint="Ordinal: la nota es el tramo.">
          <select
            id="scale-kind"
            value={draft.kind}
            onChange={(e) => patch('kind', e.target.value as ScaleDraft['kind'])}
            className={inputClass}
          >
            <option value="NUMERIC">Numérica</option>
            <option value="ORDINAL">Ordinal</option>
          </select>
        </Field>
        <Field label="Mínimo" htmlFor="scale-min">
          <input id="scale-min" value={draft.min} onChange={(e) => patch('min', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Máximo" htmlFor="scale-max">
          <input id="scale-max" value={draft.max} onChange={(e) => patch('max', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Decimales" htmlFor="scale-decimals">
          <input
            id="scale-decimals"
            type="number"
            min={0}
            max={2}
            value={draft.decimals}
            onChange={(e) => patch('decimals', Number(e.target.value))}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Descripción" htmlFor="scale-description">
        <textarea
          id="scale-description"
          rows={2}
          value={draft.description}
          onChange={(e) => patch('description', e.target.value)}
          className={inputClass}
        />
      </Field>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Tramos</h3>
          <button
            type="button"
            onClick={() => patch('levels', [...draft.levels, emptyLevel()])}
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Agregar tramo
          </button>
        </div>

        {draft.levels.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-500">
            Sin tramos. Una escala numérica puede no tenerlos, pero entonces no muestra descriptor.
          </p>
        ) : (
          <ul className="space-y-2">
            {draft.levels.map((level, index) => (
              <LevelEditor
                key={index}
                level={level}
                index={index}
                onPatch={(part) => patchLevel(index, part)}
                onRemove={() => patch('levels', draft.levels.filter((_, i) => i !== index))}
              />
            ))}
          </ul>
        )}
      </section>

      {isEdit && (
        <Check
          id="scale-active"
          label="Activa"
          hint="Al desactivarla deja de ofrecerse en evaluaciones nuevas. Las que ya la usan no cambian."
          checked={draft.isActive}
          onChange={(v) => patch('isActive', v)}
        />
      )}
    </ConfigModal>
  )
}
