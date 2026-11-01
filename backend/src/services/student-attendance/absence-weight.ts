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
 * Ciclo básico y bachillerato cuentan **por día**, no por clase: faltar a una sola materia ya es la
 * falta del día, y una llegada tarde o una ausencia justificada valen media. El día vale la peor
 * marca, no la suma — dos tardes siguen siendo media falta y tarde + ausencia es una, no una y media.
 *
 * Es el reglamento de los dos niveles: la falta se registra "en dicha jornada" y las inasistencias
 * fictas son las injustificadas más el 50 % de las justificadas (REEMS arts. 47 y 53, igual que EBI).
 * Acá el peso lo fija la regla, así que `absenceWeightHundredths` se ignora; sólo lo usa un curso
 * sin nivel, que suma por marca.
 */
export const DAY_COUNTED_LEVELS: readonly string[] = ['EBI', 'EMS']

export function countsByDay(level: string | null | undefined): boolean {
  return level != null && DAY_COUNTED_LEVELS.includes(level)
}

export function dayRuleMarkWeight(status: string): number {
  if (status === 'ABSENT') return FULL_ABSENCE
  if (status === 'ABSENT_JUSTIFIED' || status === 'LATE') return HALF_ABSENCE
  return 0
}

/** Peso del día: la peor marca del día. */
export function dayRuleHundredths(marks: readonly { status: string }[]): number {
  return marks.reduce((max, mark) => Math.max(max, dayRuleMarkWeight(mark.status)), 0)
}

export type DatedWeighableEntry = WeighableEntry & { ymd: string }

/** Peso de cada día con marcas, ordenado por fecha. Sólo tiene sentido con la regla del día. */
export function dayRuleDays(
  entries: readonly DatedWeighableEntry[],
): { ymd: string; hundredths: number }[] {
  const byDay = new Map<string, number>()
  for (const entry of entries) {
    const weight = dayRuleMarkWeight(entry.status)
    byDay.set(entry.ymd, Math.max(byDay.get(entry.ymd) ?? 0, weight))
  }
  return [...byDay]
    .map(([ymd, hundredths]) => ({ ymd, hundredths }))
    .sort((a, b) => a.ymd.localeCompare(b.ymd))
}

/** Total en centésimos según el nivel: por día en EBI y EMS, por marca en un curso sin nivel. */
export function absenceHundredthsFor(
  entries: readonly DatedWeighableEntry[],
  level: string | null | undefined,
): number {
  if (!countsByDay(level)) return totalAbsenceHundredths(entries)
  return dayRuleDays(entries).reduce((acc, day) => acc + day.hundredths, 0)
}

/** Inasistencias por tipo, como las informa el boletín: J, I y llegadas tarde. */
export type AbsenceCounts = { justified: number; unjustified: number; lates: number }

/** Gravedad de una marca para decidir a qué columna va un día: la peor manda. */
const MARK_RANK: Record<string, number> = { LATE: 1, ABSENT_JUSTIFIED: 2, ABSENT: 3 }

function countStatus(counts: AbsenceCounts, status: string) {
  if (status === 'ABSENT') counts.unjustified += 1
  else if (status === 'ABSENT_JUSTIFIED') counts.justified += 1
  else if (status === 'LATE') counts.lates += 1
}

/**
 * Cuántas de cada tipo. Con la regla del día se cuentan **días**, igual que el total: el día va a la
 * columna de su peor marca (una tarde y una ausencia ese día son una I, no una I y una tarde). En un
 * curso sin nivel, marcas.
 */
export function absenceCounts(
  entries: readonly DatedWeighableEntry[],
  level: string | null | undefined,
): AbsenceCounts {
  const counts: AbsenceCounts = { justified: 0, unjustified: 0, lates: 0 }
  if (!countsByDay(level)) {
    for (const entry of entries) countStatus(counts, entry.status)
    return counts
  }
  const worstByDay = new Map<string, string>()
  for (const entry of entries) {
    const current = worstByDay.get(entry.ymd)
    if ((MARK_RANK[entry.status] ?? 0) > (current ? MARK_RANK[current] ?? 0 : 0)) worstByDay.set(entry.ymd, entry.status)
  }
  for (const status of worstByDay.values()) countStatus(counts, status)
  return counts
}

/**
 * Faltas enteras, como las imprime el boletín: **redondea para abajo**. La media falta no suma hasta
 * juntar otra — 2 injustificadas y 1 justificada (2,5) son 2; con 2 justificadas (3) son 3.
 */
export function wholeAbsences(hundredths: number): number {
  return Math.floor(hundredths / FULL_ABSENCE)
}
