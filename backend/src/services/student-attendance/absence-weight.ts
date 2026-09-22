/**
 * Cuánto pesa una inasistencia.
 *
 * El liceo cuenta faltas en unidades de 1 y 0,5 ("falta y media falta"), y **quién decide cuál va
 * es adscripción, caso por caso** — no hay una regla automática que se pueda derivar de la marca
 * del docente. Por eso el peso es un campo propio y opcional: mientras nadie lo toque, vale el
 * valor por defecto del estado.
 *
 * Se guarda en centésimos como `Int`, igual que las calificaciones (`100` = 1 falta, `50` = media),
 * para que sumar muchas no arrastre error de punto flotante.
 */

export const FULL_ABSENCE = 100
export const HALF_ABSENCE = 50

export type WeighableEntry = {
  status: string
  absenceWeightHundredths: number | null
}

/** Una ausencia justificada **sigue siendo** inasistencia: cambia el motivo, no el conteo. */
export function isAbsence(status: string): boolean {
  return status === 'ABSENT' || status === 'ABSENT_JUSTIFIED'
}

/**
 * Peso efectivo de una fila. Sin valor explícito, una ausencia pesa una falta entera y cualquier
 * otro estado pesa cero — presente y llegada tarde no son inasistencia.
 */
export function effectiveWeight(entry: WeighableEntry): number {
  if (!isAbsence(entry.status)) return 0
  return entry.absenceWeightHundredths ?? FULL_ABSENCE
}

/** Total en centésimos de un conjunto de marcas. */
export function totalAbsenceHundredths(entries: readonly WeighableEntry[]): number {
  return entries.reduce((acc, entry) => acc + effectiveWeight(entry), 0)
}

/** `150` → `"1,5"`. Coma decimal y sin decimales de más: `100` → `"1"`. */
export function formatAbsenceUnits(hundredths: number): string {
  const units = hundredths / 100
  return (Number.isInteger(units) ? String(units) : units.toFixed(1)).replace('.', ',')
}

/** Sólo 1 o 0,5: el liceo no usa otros valores y aceptar cualquiera invitaría a inventarlos. */
export function isValidAbsenceWeight(hundredths: number): boolean {
  return hundredths === FULL_ABSENCE || hundredths === HALF_ABSENCE
}
