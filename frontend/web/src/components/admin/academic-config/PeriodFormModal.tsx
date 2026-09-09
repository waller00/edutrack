'use client'

import { useState } from 'react'
import DateField from '@/components/forms/DateField'
import ConfigModal from './ConfigModal'
import { Check, Field, inputClass } from './fields'
import { LEVEL_LABELS, type AcademicLevel, type AcademicPeriod } from '@/lib/academic-config/types'

export type PeriodDraft = {
  level: AcademicLevel
  code: string
  name: string
  sortOrder: number
  startsOn: string
  endsOn: string
  closesOn: string
  requiresConceptualJudgement: boolean
  requiresGeneralGrade: boolean
  isActive: boolean
}

export function draftFromPeriod(period: AcademicPeriod | null, level: AcademicLevel): PeriodDraft {
  return {
    level: period?.level ?? level,
    code: period?.code ?? '',
    name: period?.name ?? '',
    sortOrder: period?.sortOrder ?? 0,
    startsOn: period?.startsOn ?? '',
    endsOn: period?.endsOn ?? '',
    closesOn: period?.closesOn ?? '',
    requiresConceptualJudgement: period?.requiresConceptualJudgement ?? false,
    requiresGeneralGrade: period?.requiresGeneralGrade ?? true,
    isActive: period?.isActive ?? true,
  }
}

/**
 * Valida la ventana antes de llamar al backend, con los mismos límites que `assertPeriodWindow`.
 * No reemplaza la validación del servidor: evita el viaje y señala el campo exacto.
 */
export function validatePeriod(draft: PeriodDraft, isEdit: boolean): string | null {
  if (!isEdit && !/^[A-Z0-9_]+$/.test(draft.code)) {
    return 'El código va en mayúsculas, números y guion bajo (por ejemplo, MODULO_INTRO).'
  }
  if (draft.name.trim() === '') return 'Poné un nombre para el período.'
  if (draft.startsOn && draft.endsOn && draft.startsOn > draft.endsOn) {
    return 'El período termina antes de empezar.'
  }
  if (draft.endsOn && draft.closesOn && draft.closesOn < draft.endsOn) {
    return 'El cierre no puede ser anterior al fin del período.'
  }
  return null
}

/** Sólo lo editable: el backend rechaza `code` y `level` en un PATCH. */
export function periodPayload(draft: PeriodDraft, isEdit: boolean, schoolYearId: string) {
  const common = {
    name: draft.name.trim(),
    sortOrder: draft.sortOrder,
    startsOn: draft.startsOn || null,
    endsOn: draft.endsOn || null,
    closesOn: draft.closesOn || null,
    requiresConceptualJudgement: draft.requiresConceptualJudgement,
    requiresGeneralGrade: draft.requiresGeneralGrade,
  }
  return isEdit
    ? { ...common, isActive: draft.isActive }
    : { ...common, schoolYearId, level: draft.level, code: draft.code.trim() }
}

type Props = {
  period: AcademicPeriod | null
  level: AcademicLevel
  saving: boolean
  error: string | null
  onSave: (draft: PeriodDraft) => void
  onClose: () => void
}

export default function PeriodFormModal({ period, level, saving, error, onSave, onClose }: Props) {
  const isEdit = period !== null
  const [draft, setDraft] = useState<PeriodDraft>(() => draftFromPeriod(period, level))
  const [localError, setLocalError] = useState<string | null>(null)

  function patch<K extends keyof PeriodDraft>(key: K, value: PeriodDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function submit() {
    const problem = validatePeriod(draft, isEdit)
    setLocalError(problem)
    if (!problem) onSave(draft)
  }

  return (
    <ConfigModal
      title={isEdit ? `Editar ${period.name}` : 'Nuevo período'}
      hint={LEVEL_LABELS[draft.level]}
      saving={saving}
      error={localError ?? error}
      onSubmit={submit}
      onClose={onClose}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Código"
          htmlFor="period-code"
          hint={isEdit ? 'El código no se cambia: lo referencian las libretas.' : 'Identificador estable, en mayúsculas.'}
        >
          <input
            id="period-code"
            value={draft.code}
            disabled={isEdit}
            onChange={(e) => patch('code', e.target.value.toUpperCase())}
            className={`${inputClass} disabled:bg-gray-50`}
          />
        </Field>

        <Field label="Nombre" htmlFor="period-name">
          <input id="period-name" value={draft.name} onChange={(e) => patch('name', e.target.value)} className={inputClass} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Empieza" htmlFor="period-starts">
          <DateField id="period-starts" value={draft.startsOn} onChange={(v) => patch('startsOn', v)} className={inputClass} />
        </Field>
        <Field label="Termina" htmlFor="period-ends">
          <DateField id="period-ends" value={draft.endsOn} onChange={(v) => patch('endsOn', v)} className={inputClass} />
        </Field>
        <Field label="Cierre" htmlFor="period-closes" hint="Fecha límite para cerrar la libreta.">
          <DateField id="period-closes" value={draft.closesOn} onChange={(v) => patch('closesOn', v)} className={inputClass} />
        </Field>
      </div>

      <Field label="Orden" htmlFor="period-order" hint="Define en qué posición aparece dentro del nivel.">
        <input
          id="period-order"
          type="number"
          min={0}
          value={draft.sortOrder}
          onChange={(e) => patch('sortOrder', Number(e.target.value))}
          className={`${inputClass} w-28`}
        />
      </Field>

      <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3">
        <legend className="px-1 text-xs font-medium text-gray-600">Obligatorio para poder cerrar</legend>
        <Check
          id="period-requires-grade"
          label="Calificación general"
          hint="Sin la nota de cada estudiante, la libreta no cierra."
          checked={draft.requiresGeneralGrade}
          onChange={(v) => patch('requiresGeneralGrade', v)}
        />
        <Check
          id="period-requires-judgement"
          label="Juicio conceptual"
          hint="Exige el texto valorativo por estudiante."
          checked={draft.requiresConceptualJudgement}
          onChange={(v) => patch('requiresConceptualJudgement', v)}
        />
      </fieldset>

      {isEdit && (
        <Check
          id="period-active"
          label="Activo"
          hint="Al desactivarlo deja de ofrecerse para calificar. Lo ya cargado no se toca."
          checked={draft.isActive}
          onChange={(v) => patch('isActive', v)}
        />
      )}
    </ConfigModal>
  )
}
