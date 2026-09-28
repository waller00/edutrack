/**
 * Cuánto pesa una inasistencia.
 *
 * El liceo cuenta faltas en unidades de 1 y 0,5 ("falta y media falta"). La llegada tarde es la
 * media falta: el docente ya no elige "media falta" a mano. Adscripción todavía puede graduar una
 * ausencia puntual al justificarla, por eso el peso es un campo propio y opcional: mientras nadie
 * lo toque, vale el valor por defecto del estado.
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
 * Peso efectivo de una fila. Sin valor explícito, una ausencia pesa una falta entera; la llegada
 * tarde pesa media (no es inasistencia, pero suma), y presente pesa cero.
 */
export function effectiveWeight(entry: WeighableEntry): number {
  if (entry.status === 'LATE') return HALF_ABSENCE
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

/**
 * Ciclo básico (EBI) cuenta **por día**, no por clase: faltar a una sola materia ya es la falta
 * del día, y una llegada tarde o una ausencia justificada valen media. El día vale la peor marca,
 * no la suma — dos tardes siguen siendo media falta y tarde + ausencia es una, no una y media.
 *
 * Acá el peso lo fija la regla, así que `absenceWeightHundredths` se ignora.
 */
export const BASIC_CYCLE_LEVEL = 'EBI'

export function isBasicCycle(level: string | null | undefined): boolean {
  return level === BASIC_CYCLE_LEVEL
}

export function basicCycleMarkWeight(status: string): number {
  if (status === 'ABSENT') return FULL_ABSENCE
  if (status === 'ABSENT_JUSTIFIED' || status === 'LATE') return HALF_ABSENCE
  return 0
}

/** Peso del día: la peor marca del día. */
export function basicCycleDayHundredths(marks: readonly { status: string }[]): number {
  return marks.reduce((max, mark) => Math.max(max, basicCycleMarkWeight(mark.status)), 0)
}

export type DatedWeighableEntry = WeighableEntry & { ymd: string }

/** Peso de cada día con marcas, ordenado por fecha. Sólo tiene sentido en ciclo básico. */
export function basicCycleDays(
  entries: readonly DatedWeighableEntry[],
): { ymd: string; hundredths: number }[] {
  const byDay = new Map<string, number>()
  for (const entry of entries) {
    const weight = basicCycleMarkWeight(entry.status)
    byDay.set(entry.ymd, Math.max(byDay.get(entry.ymd) ?? 0, weight))
  }
  return [...byDay]
    .map(([ymd, hundredths]) => ({ ymd, hundredths }))
    .sort((a, b) => a.ymd.localeCompare(b.ymd))
}

/** Total en centésimos según el nivel: por día en ciclo básico, por marca en el resto. */
export function absenceHundredthsFor(
  entries: readonly DatedWeighableEntry[],
  level: string | null | undefined,
): number {
  if (!isBasicCycle(level)) return totalAbsenceHundredths(entries)
  return basicCycleDays(entries).reduce((acc, day) => acc + day.hundredths, 0)
}
