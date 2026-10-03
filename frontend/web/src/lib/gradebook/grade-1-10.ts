/** Escala fija de la libreta docente: 1–10 (+ N/A). */

export const GRADE_1_TO_10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

export function gradeSelectFromHundredths(hundredths: number | null | undefined): string {
  if (hundredths == null) return ''
  const n = Math.round(hundredths / 100)
  if (n >= 1 && n <= 10) return String(n)
  return ''
}

export function gradeSelectToHundredths(value: string): number | null {
  if (!value || value === 'NA') return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 10) return null
  return n * 100
}
