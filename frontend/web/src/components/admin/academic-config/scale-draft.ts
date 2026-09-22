/** Lógica pura del formulario de escalas: fuera del componente para poder testearla sola. */

import { formatHundredths, parseToHundredths } from '@/lib/academic-config/grade-value'
import type { GradingScale, ScaleKind } from '@/lib/academic-config/types'

/** Los valores se editan en texto ("7,5") y recién se pasan a centésimos al guardar. */
export type LevelDraft = {
  code: string
  label: string
  descriptor: string
  min: string
  max: string
  isPassing: boolean
  isAlert: boolean
}

export type ScaleDraft = {
  code: string
  name: string
  kind: ScaleKind
  min: string
  max: string
  decimals: number
  description: string
  isActive: boolean
  levels: LevelDraft[]
}

export function emptyLevel(): LevelDraft {
  return { code: '', label: '', descriptor: '', min: '', max: '', isPassing: false, isAlert: false }
}

export function draftFromScale(scale: GradingScale | null): ScaleDraft {
  if (!scale) {
    return {
      code: '', name: '', kind: 'NUMERIC', min: '', max: '', decimals: 0,
      description: '', isActive: true, levels: [],
    }
  }
  return {
    code: scale.code,
    name: scale.name,
    kind: scale.kind,
    min: scale.minValueHundredths == null ? '' : formatHundredths(scale.minValueHundredths, scale.decimals),
    max: scale.maxValueHundredths == null ? '' : formatHundredths(scale.maxValueHundredths, scale.decimals),
    decimals: scale.decimals,
    description: scale.description ?? '',
    isActive: scale.isActive,
    levels: scale.levels.map((level) => ({
      code: level.code,
      label: level.label,
      descriptor: level.descriptor ?? '',
      min: formatHundredths(level.minValueHundredths, scale.decimals),
      max: formatHundredths(level.maxValueHundredths, scale.decimals),
      isPassing: level.isPassing,
      isAlert: level.isAlert,
    })),
  }
}

/**
 * Valida lo mismo que `assertLevelsCoverScale` del backend, para señalar el tramo exacto en vez
 * de devolver un error genérico. No sustituye al servidor: es la primera barrera, no la única.
 */
export function validateScale(draft: ScaleDraft, isEdit: boolean): string | null {
  if (!isEdit && !/^[A-Z0-9_]+$/.test(draft.code)) {
    return 'El código va en mayúsculas, números y guion bajo (por ejemplo, NUM_1_10).'
  }
  if (draft.name.trim() === '') return 'Poné un nombre para la escala.'

  const scaleMin = parseToHundredths(draft.min)
  const scaleMax = parseToHundredths(draft.max)
  if (scaleMin != null && scaleMax != null && scaleMin > scaleMax) {
    return 'El mínimo de la escala es mayor que el máximo.'
  }

  for (const [index, level] of draft.levels.entries()) {
    const position = index + 1
    if (!/^[A-Z0-9_]+$/.test(level.code)) return `Tramo ${position}: el código va en mayúsculas, números y guion bajo.`
    if (level.label.trim() === '') return `Tramo ${position}: falta la etiqueta.`
    const min = parseToHundredths(level.min)
    const max = parseToHundredths(level.max)
    if (min == null || max == null) return `Tramo ${position}: completá desde y hasta.`
    if (min > max) return `Tramo ${position}: el desde es mayor que el hasta.`
    if (scaleMin != null && min < scaleMin) return `Tramo ${position}: empieza por debajo del mínimo de la escala.`
    if (scaleMax != null && max > scaleMax) return `Tramo ${position}: termina por encima del máximo de la escala.`
  }

  const overlap = findOverlap(draft.levels)
  if (overlap) return `Los tramos ${overlap[0]} y ${overlap[1]} se pisan entre sí.`

  if (draft.kind === 'ORDINAL' && draft.levels.length === 0) {
    return 'Una escala ordinal necesita al menos un tramo: el tramo ES la calificación.'
  }
  return null
}

/** Devuelve las posiciones (1-based) del primer par de tramos que se solapan. */
export function findOverlap(levels: readonly LevelDraft[]): [number, number] | null {
  const ranges = levels.map((level, index) => ({
    position: index + 1,
    min: parseToHundredths(level.min),
    max: parseToHundredths(level.max),
  }))
  for (let i = 0; i < ranges.length; i += 1) {
    for (let j = i + 1; j < ranges.length; j += 1) {
      const a = ranges[i]
      const b = ranges[j]
      if (a.min == null || a.max == null || b.min == null || b.max == null) continue
      if (a.min <= b.max && b.min <= a.max) return [a.position, b.position]
    }
  }
  return null
}

export function scalePayload(draft: ScaleDraft, isEdit: boolean) {
  const common = {
    name: draft.name.trim(),
    kind: draft.kind,
    minValueHundredths: parseToHundredths(draft.min),
    maxValueHundredths: parseToHundredths(draft.max),
    decimals: draft.decimals,
    description: draft.description.trim() || null,
    levels: draft.levels.map((level, index) => ({
      code: level.code.trim(),
      label: level.label.trim(),
      descriptor: level.descriptor.trim() || null,
      minValueHundredths: parseToHundredths(level.min),
      maxValueHundredths: parseToHundredths(level.max),
      isPassing: level.isPassing,
      isAlert: level.isAlert,
      sortOrder: index,
    })),
  }
  return isEdit ? { ...common, isActive: draft.isActive } : { ...common, code: draft.code.trim() }
}
