/**
 * Cantidades y porcentajes de los indicadores, siempre con su base: «34 de 88 (38,6 %)». Un
 * porcentaje suelto no dice si son 3 estudiantes o 300, y antes cada pantalla lo escribía a su
 * modo ("38.6%", "38,6 %", "39%").
 */

const COUNT = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 0 })
const PERCENT = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 1 })

/** 1034 → «1.034». */
export function formatCount(value: number): string {
  return COUNT.format(value)
}

/** 38.64 → «38,6 %»; 40 → «40 %». */
export function formatPercent(value: number): string {
  return `${PERCENT.format(value)} %`
}

/** La parte sobre el total (0 a 100), para barras y gráficas; `null` si no hay total. */
export function ratioValue(part: number, total: number): number | null {
  return total > 0 ? (part / total) * 100 : null
}

/** «33,3 %», o «—» si no hay total. */
export function formatRatio(part: number, total: number): string {
  const value = ratioValue(part, total)
  return value === null ? '—' : formatPercent(value)
}

/** «34 de 88 (38,6 %)»; sin total, «0 de 0». */
export function formatShare(part: number, total: number): string {
  const base = `${formatCount(part)} de ${formatCount(total)}`
  return total > 0 ? `${base} (${formatRatio(part, total)})` : base
}
