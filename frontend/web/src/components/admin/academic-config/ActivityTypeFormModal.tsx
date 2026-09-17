'use client'

import { useState } from 'react'
import ConfigModal from './ConfigModal'
import { Check, Field, inputClass } from './fields'
import type { ActivityType } from '@/lib/academic-config/types'

export type ActivityTypeDraft = {
  code: string
  name: string
  description: string
  sortOrder: number
  isActive: boolean
}

export function draftFromActivityType(type: ActivityType | null): ActivityTypeDraft {
  return {
    code: type?.code ?? '',
    name: type?.name ?? '',
    description: type?.description ?? '',
    sortOrder: type?.sortOrder ?? 0,
    isActive: type?.isActive ?? true,
  }
}

export function validateActivityType(draft: ActivityTypeDraft, isEdit: boolean): string | null {
  if (!isEdit && !/^[A-Z0-9_]+$/.test(draft.code)) {
    return 'El código va en mayúsculas, números y guion bajo (por ejemplo, ESCRITO).'
  }
  if (draft.name.trim() === '') return 'Poné un nombre para el tipo de actividad.'
  return null
}

/** El backend rechaza `code` en un PATCH: sólo viaja al crear. */
export function activityTypePayload(draft: ActivityTypeDraft, isEdit: boolean) {
  const common = {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    sortOrder: draft.sortOrder,
  }
  return isEdit ? { ...common, isActive: draft.isActive } : { ...common, code: draft.code.trim() }
}

type Props = {
  type: ActivityType | null
  saving: boolean
  error: string | null
  onSave: (draft: ActivityTypeDraft) => void
  onClose: () => void
}

export default function ActivityTypeFormModal({ type, saving, error, onSave, onClose }: Props) {
  const isEdit = type !== null
  const [draft, setDraft] = useState<ActivityTypeDraft>(() => draftFromActivityType(type))
  const [localError, setLocalError] = useState<string | null>(null)

  function patch<K extends keyof ActivityTypeDraft>(key: K, value: ActivityTypeDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function submit() {
    const problem = validateActivityType(draft, isEdit)
    setLocalError(problem)
    if (!problem) onSave(draft)
  }

  return (
    <ConfigModal
      title={isEdit ? `Editar ${type.name}` : 'Nuevo tipo de actividad'}
      hint="Queda disponible para todas las libretas del liceo."
      saving={saving}
      error={localError ?? error}
      onSubmit={submit}
      onClose={onClose}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Código"
          htmlFor="type-code"
          hint={isEdit ? 'El código no se cambia: lo referencian las evaluaciones.' : 'Por ejemplo, ESCRITO u ORAL.'}
        >
          <input
            id="type-code"
            value={draft.code}
            disabled={isEdit}
            onChange={(e) => patch('code', e.target.value.toUpperCase())}
            className={`${inputClass} disabled:bg-gray-50`}
          />
        </Field>

        <Field label="Nombre" htmlFor="type-name">
          <input id="type-name" value={draft.name} onChange={(e) => patch('name', e.target.value)} className={inputClass} />
        </Field>
      </div>

      <Field label="Descripción" htmlFor="type-description" hint="Opcional. Ayuda al docente a elegir bien.">
        <textarea
          id="type-description"
          rows={3}
          value={draft.description}
          onChange={(e) => patch('description', e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="Orden" htmlFor="type-order">
        <input
          id="type-order"
          type="number"
          min={0}
          value={draft.sortOrder}
          onChange={(e) => patch('sortOrder', Number(e.target.value))}
          className={`${inputClass} w-28`}
        />
      </Field>

      {isEdit && (
        <Check
          id="type-active"
          label="Activo"
          hint="Al desactivarlo deja de ofrecerse en evaluaciones nuevas. Las que ya lo usan no cambian."
          checked={draft.isActive}
          onChange={(v) => patch('isActive', v)}
        />
      )}
    </ConfigModal>
  )
}
