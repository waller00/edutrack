/**
 * Presentación de valores de calificación, que la API expone en **centésimos** (8 → 800).
 *
 * Es el espejo de `backend/src/services/academic-config/grade-value.ts`: el backend guarda
 * enteros para que las comparaciones contra umbrales sean exactas, y la UI traduce en el borde.
 */

export const HUNDREDTHS = 100

/** `800` → `"8"`; `750` con 1 decimal → `"7,5"`. Coma decimal, como se escribe en Uruguay. */
export function formatHundredths(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const safeDecimals = Math.max(0, Math.min(2, decimals))
  return (value / HUNDREDTHS).toFixed(safeDecimals).replace('.', ',')
}

/** Texto que escribe el usuario (`"7,5"` o `"7.5"`) → `750`. `null` si no es un número. */
export function parseToHundredths(input: string): number | null {
  const normalized = input.trim().replace(',', '.')
  if (normalized === '') return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * HUNDREDTHS)
}

/** Rango legible de un tramo: `"1 a 5,9"`. */
export function formatRange(
  minHundredths: number,
  maxHundredths: number,
  decimals = 0,
): string {
  if (minHundredths === maxHundredths) return formatHundredths(minHundredths, decimals)
  return `${formatHundredths(minHundredths, decimals)} a ${formatHundredths(maxHundredths, decimals)}`
}
