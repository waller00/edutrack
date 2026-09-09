/**
 * Agrupa tipos de actividad del catálogo en las columnas de la libreta de papel:
 * Orales / Escritas / Otras actividades.
 */

export type ActivityCategory = 'oral' | 'written' | 'other'

const ORAL_CODES = new Set(['ORAL', 'EXPOSICION', 'PARTICIPACION'])
const WRITTEN_CODES = new Set(['ESCRITO'])

export function activityCategory(code: string | null | undefined): ActivityCategory {
  const normalized = (code || '').trim().toUpperCase()
  if (ORAL_CODES.has(normalized)) return 'oral'
  if (WRITTEN_CODES.has(normalized)) return 'written'
  return 'other'
}

export const ACTIVITY_CATEGORY_LABEL: Record<ActivityCategory, string> = {
  oral: 'Orales',
  written: 'Escritas',
  other: 'O. Act',
}

/** Promedio en centésimos; `null` si no hay valores numéricos. */
export function averageHundredths(values: readonly (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (nums.length === 0) return null
  return Math.round(nums.reduce((sum, v) => sum + v, 0) / nums.length)
}
