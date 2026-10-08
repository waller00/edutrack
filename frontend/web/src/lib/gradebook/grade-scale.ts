/**
 * Notas de la libreta con la escala del nivel: 1–10 en ciclo básico, 1–12 en bachillerato.
 *
 * Reemplaza al selector fijo de 1 a 10, que en bachillerato no dejaba poner 11 ni 12 y, peor,
 * leía una R de 11 como vacía: guardar la carta la borraba. El rango sale de la escala que manda
 * el backend (`periodScale` en `/gradebook/:id/options`, `scale` en el cierre), nunca del código.
 *
 * El valor del `<select>` es la nota tal como se lee ("8", "11", "7.5"); la API habla en
 * centésimos y la conversión vive acá.
 */

import { formatHundredths } from '@/lib/academic-config/grade-value'

export type GradeRange = {
  minValueHundredths: number | null
  maxValueHundredths: number | null
}

/** Sin escala sembrada se ofrece 1 a 10, que es lo que la libreta hacía siempre. */
const FALLBACK_MIN = 100
const FALLBACK_MAX = 1000

/** Notas enteras del rango de la escala, en centésimos y de menor a mayor. */
export function gradeChoices(scale: GradeRange | null | undefined): number[] {
  const min = Math.ceil((scale?.minValueHundredths ?? FALLBACK_MIN) / 100)
  const max = Math.floor((scale?.maxValueHundredths ?? FALLBACK_MAX) / 100)
  const choices: number[] = []
  for (let n = Math.max(0, min); n <= max; n += 1) choices.push(n * 100)
  return choices
}

/** Centésimos → valor del selector. `null` es "sin nota" (`''`). */
export function gradeSelectFromHundredths(hundredths: number | null | undefined): string {
  if (hundredths == null || !Number.isFinite(hundredths)) return ''
  return String(hundredths / 100)
}

/** Valor del selector → centésimos. `''` (o algo que no es un número) es "sin nota". */
export function gradeSelectToHundredths(value: string): number | null {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

/** "8", "7,5" o "7,25": los decimales justos para no redondear la nota. `null` es "—". */
export function formatGrade(hundredths: number | null | undefined): string {
  if (hundredths == null) return formatHundredths(null)
  let decimals = 2
  if (hundredths % 100 === 0) decimals = 0
  else if (hundredths % 10 === 0) decimals = 1
  return formatHundredths(hundredths, decimals)
}

/**
 * Opciones del selector: las de la escala más la nota actual si no está entre ellas (una nota con
 * decimales o de antes de un cambio de escala). Si el selector no la ofreciera, tocarlo la borraría.
 */
export function gradeSelectOptions(
  scale: GradeRange | null | undefined,
  current: number | null | undefined,
): number[] {
  const choices = gradeChoices(scale)
  if (current == null || choices.includes(current)) return choices
  return [...choices, current].sort((a, b) => a - b)
}
