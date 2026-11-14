import { countOf, formatCount, formatShare } from '../reports/format.js'
import type { DashboardKpis, DashboardTopRiskEvent, DashboardTopRiskPerson, RangeCounts } from './models.js'

/**
 * "Lectura del período" de Indicadores del personal: pistas para interpretar los números. Las
 * muestra la pantalla y las imprime el informe: salen sólo de acá.
 */

const LARGE_SAMPLE = 120
const HIGH_ABSENTEEISM_PCT = 12
const HIGH_LATE_RATE_PCT = 10
const LOW_PUNCTUALITY_PCT = 85
const MAX_SIGNALS = 8

export type SignalsInput = {
  kpis: DashboardKpis
  counts: RangeCounts
  people: readonly DashboardTopRiskPerson[]
  events: readonly DashboardTopRiskEvent[]
}

function sampleSignal(planned: number): string | null {
  if (planned >= LARGE_SAMPLE) return `Muestra amplia: ${formatCount(planned)} registros planificados. Las tendencias son más estables.`
  if (planned > 0) return `Se analizaron ${formatCount(planned)} registros planificados: con pocos registros, una variación puede ser casualidad.`
  return null
}

function absenteeismSignal({ kpis, counts }: SignalsInput): string | null {
  if (kpis.M4_AOP_pct < HIGH_ABSENTEEISM_PCT) return null
  return `Ausentismo alto: ${formatShare(counts.absent, counts.planned)} registros planificados. Conviene ver si se repite en las mismas personas o actividades.`
}

function lateSignal({ kpis, counts }: SignalsInput): string | null {
  if (kpis.M2_LATE_RATE_pct < HIGH_LATE_RATE_PCT) return null
  return `Muchas llegadas tarde: ${formatShare(counts.late, counts.present)} entradas. Cruzalo con los horarios publicados y con el reloj de entrada.`
}

function punctualitySignal({ kpis }: SignalsInput): string | null {
  if (kpis.M1_PUNCTUALITY_pct <= 0 || kpis.M1_PUNCTUALITY_pct >= LOW_PUNCTUALITY_PCT) return null
  return 'La puntualidad está por debajo del 85 %: conviene revisar los horarios y comunicarlo antes de pensar en medidas formales.'
}

function inactiveLicensesSignal({ kpis }: SignalsInput): string | null {
  if (kpis.PC_count <= 0) return null
  const subject = countOf(kpis.PC_count, 'licencia inactiva coincide', 'licencias inactivas coinciden')
  return `${subject} con el período: revisalas antes de contar esas ausencias como sin justificar.`
}

function followUpSignals({ people, events }: SignalsInput): string[] {
  const signals: string[] = []
  if (people.some((person) => person.riskScore > 0)) {
    signals.push('La lista de personas para revisar suma llegadas tarde y ausencias sin justificar: es para conversar con cada una, no una sanción automática.')
  }
  if (events.some((event) => event.focusScore > 0)) {
    signals.push(
      'Las actividades con más tardanzas y ausencias suelen mejorar repartiendo mejor la carga horaria, revisando el tamaño del grupo o confirmando la asistencia antes.',
    )
  }
  return signals
}

export function periodSignals(input: SignalsInput): string[] {
  const signals = [
    sampleSignal(input.counts.planned),
    absenteeismSignal(input),
    lateSignal(input),
    punctualitySignal(input),
    inactiveLicensesSignal(input),
    ...followUpSignals(input),
  ].filter((signal): signal is string => Boolean(signal))
  if (signals.length <= 3) {
    signals.push('Si los números se mantienen en rangos razonables, seguí mirando la evolución y compará con un período igual (por ejemplo, el mes anterior).')
  }
  return signals.slice(0, MAX_SIGNALS)
}
