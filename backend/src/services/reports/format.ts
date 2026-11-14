import { getInstitutionTimezone } from '../../config/institution-timezone.js'

/**
 * Cómo se escriben los números en los informes. Las cantidades y los porcentajes son los de la
 * pantalla (`frontend/web/src/lib/format/percent.ts`): «34 de 88 (38,6 %)». Si cambia uno, cambia
 * el otro.
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

/** La parte sobre el total (0 a 100); `null` si no hay total. */
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

/** 7.5 → «7,5»; 18 → «18» (hasta `digits` decimales). Con `fixed`, siempre `digits`: 7 → «7,0». */
export function formatDecimal(value: number, digits = 1, fixed = false): string {
  return new Intl.NumberFormat('es-UY', { minimumFractionDigits: fixed ? digits : 0, maximumFractionDigits: digits }).format(value)
}

/**
 * Una variación en puntos porcentuales, dicha en palabras: «subió 1,2 puntos», «bajó 0,5 puntos»,
 * «sin cambios».
 */
export function formatPointsChange(delta: number): string {
  if (Math.abs(delta) < 0.05) return 'sin cambios'
  const points = PERCENT.format(Math.abs(delta))
  const unit = points === '1' ? 'punto' : 'puntos'
  return `${delta > 0 ? 'subió' : 'bajó'} ${points} ${unit}`
}

/** `2026-03-01` → «01/03/2026». */
export function formatYmd(ymd: string): string {
  const [year, month, day] = ymd.slice(0, 10).split('-')
  return day && month && year ? `${day}/${month}/${year}` : ymd
}

/** `2026-10-05` → «05/10». */
export function formatShortYmd(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
}

/** «13/11/2026 14:05», en la hora de la institución. */
export function formatDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('es-UY', {
    timeZone: getInstitutionTimezone(),
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`
}

/** Una nota en centésimos, en unidades: 750 → 7.5. */
export const gradeUnits = (hundredths: number): number => hundredths / 100

/**
 * Una nota en centésimos con `decimals` decimales fijos, como `formatHundredths` de la pantalla:
 * 750 → «7,5»; con 1 decimal, 700 → «7,0». Sin nota, «—».
 */
export function formatHundredths(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const safe = Math.max(0, Math.min(2, decimals))
  return (value / 100).toFixed(safe).replace('.', ',')
}

/** La nota como la escribe la pantalla (`gradeText`): 800 → «8», 750 → «7,5». */
export const gradeText = (hundredths: number): string => formatHundredths(hundredths, hundredths % 100 === 0 ? 0 : 1)

/** Faltas en centésimos (`formatAbsenceUnits` de la pantalla): 1800 → «18», 1850 → «18,5». */
export function absencesText(hundredths: number): string {
  const units = hundredths / 100
  return (Number.isInteger(units) ? String(units) : units.toFixed(1)).replace('.', ',')
}

/** «Pérez, Ana»: apellido primero, como en la pantalla. */
export const studentName = (s: { firstName: string; lastName: string }) => `${s.lastName}, ${s.firstName}`

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

/** «1 estudiante», «3 estudiantes». */
export const countOf = (count: number, one: string, many: string) => `${formatCount(count)} ${plural(count, one, many)}`
