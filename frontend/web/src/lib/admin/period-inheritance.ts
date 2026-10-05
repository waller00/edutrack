/**
 * Herencia de la parametrización de la libreta entre ciclos, del lado del cliente.
 *
 * El backend (`services/academic-config/period-inheritance.ts`) copia los períodos del ciclo origen
 * corriendo las fechas al año nuevo, y cae a la plantilla reglamentaria para el nivel que el origen
 * no tenga configurado. Acá viven la elección del origen por defecto y el texto que explica qué
 * pasó, porque un resumen con `created`/`existing`/`byLevel` no le dice nada a quien aprieta el
 * botón.
 */

export type YearOption = { id: string; code: number }

export type PeriodOrigin = 'SOURCE_YEAR' | 'TEMPLATE'

export type PeriodInheritanceSummary = {
  schoolYearCode: number
  sourceSchoolYearCode: number | null
  created: number
  existing: number
  byLevel: Record<string, { origin: PeriodOrigin; created: number; existing: number }>
}

export type ProvisionSummary = {
  created: number
  updated: number
  skippedEvents?: number
  skippedNotOffered?: number
}

function byCodeDesc(a: YearOption, b: YearOption): number {
  return b.code - a.code
}

/** Los ciclos que pueden oficiar de origen: todos menos el propio destino, el más nuevo primero. */
export function inheritSourceOptions(
  years: readonly YearOption[],
  targetSchoolYearId: string | null,
): Array<{ value: string; label: string }> {
  return [...years]
    .filter((year) => year.id !== targetSchoolYearId)
    .sort(byCodeDesc)
    .map((year) => ({ value: year.id, label: String(year.code) }))
}

/**
 * El origen sugerido es el ciclo **inmediatamente anterior** por código, no el más reciente: si
 * alguien ya creó el 2028, heredar el calendario del 2027 para el 2027 sigue siendo lo correcto.
 */
export function defaultInheritSourceId(
  years: readonly YearOption[],
  targetSchoolYearId: string | null,
): string {
  const target = years.find((year) => year.id === targetSchoolYearId)
  const candidates = [...years].filter((year) => year.id !== targetSchoolYearId).sort(byCodeDesc)
  if (candidates.length === 0) return ''
  if (target) {
    const previous = candidates.find((year) => year.code < target.code)
    if (previous) return previous.id
  }
  return candidates[0].id
}

/** Cuántos períodos se crearon desde el ciclo origen y cuántos desde la plantilla. */
function createdByOrigin(summary: PeriodInheritanceSummary): Record<PeriodOrigin, number> {
  const totals: Record<PeriodOrigin, number> = { SOURCE_YEAR: 0, TEMPLATE: 0 }
  for (const level of Object.values(summary.byLevel ?? {})) {
    totals[level.origin] += level.created
  }
  return totals
}

function periodsLabel(count: number): string {
  return count === 1 ? '1 período' : `${count} períodos`
}

/** Qué pasó al heredar, en una frase. */
export function describeInheritance(summary: PeriodInheritanceSummary): string {
  if (summary.created === 0) {
    return summary.existing > 0
      ? `El ciclo ${summary.schoolYearCode} ya tenía sus ${periodsLabel(summary.existing)}: no se cambió nada.`
      : `No había períodos para heredar al ciclo ${summary.schoolYearCode}.`
  }

  const { SOURCE_YEAR: fromSource, TEMPLATE: fromTemplate } = createdByOrigin(summary)
  const parts: string[] = []
  if (fromSource > 0 && summary.sourceSchoolYearCode !== null) {
    parts.push(`${periodsLabel(fromSource)} del ciclo ${summary.sourceSchoolYearCode}`)
  }
  if (fromTemplate > 0) {
    parts.push(`${periodsLabel(fromTemplate)} de la plantilla reglamentaria`)
  }
  // Si el resumen no trae `byLevel` (una respuesta más vieja), igual se informa el total.
  if (parts.length === 0) parts.push(periodsLabel(summary.created))

  const tail = summary.existing > 0 ? ` Los ${periodsLabel(summary.existing)} que ya estaban quedaron intactos.` : ''
  return `Se cargaron ${parts.join(' y ')} en el ciclo ${summary.schoolYearCode}.${tail}`
}

/** Qué pasó al generar libretas, en una frase. */
export function describeProvision(summary: ProvisionSummary): string {
  const base =
    summary.created === 0 && summary.updated === 0
      ? 'No había clases en el horario de las que derivar libretas.'
      : `${summary.created === 1 ? '1 libreta nueva' : `${summary.created} libretas nuevas`}, ${summary.updated} actualizada${summary.updated === 1 ? '' : 's'}.`

  const notes: string[] = []
  if (summary.skippedEvents) notes.push(`${summary.skippedEvents} clase(s) sin asignatura o sin grupo`)
  if (summary.skippedNotOffered) notes.push(`${summary.skippedNotOffered} grupo(s) que ya no se dictan`)
  return notes.length > 0 ? `${base} Sin contar ${notes.join(' y ')}.` : base
}
