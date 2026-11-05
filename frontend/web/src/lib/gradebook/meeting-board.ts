/**
 * Cuentas de la Reunión de profesores (`/libreta/reunion`): cuánto lleva decidido la reunión,
 * qué libretas todavía no cerraron, a quién mirar primero y la leyenda de los tramos.
 *
 * Cada número dice de cuántos sale («12 de 30»): en la reunión se proyecta, y un porcentaje suelto
 * no dice si falta uno o faltan veinte.
 */

import { formatHundredths } from '@/lib/academic-config/grade-value'
import { levelStyle } from '@/lib/academic-config/level-tokens'

export type MeetingRowLike = {
  studentId: string
  lastName: string
  firstName: string
  performanceValueHundredths?: number | null
  conductValueHundredths?: number | null
  averageHundredths?: number | null
  atRisk: boolean
}

export type MeetingSubjectLike = {
  gradeBookId: string
  name: string
  teacher: string | null
  periodStatus: string | null
}

export type MeetingTally = {
  students: number
  withPerformance: number
  withConduct: number
  /** `null` mientras los juicios no llegaron: no se dice «0 de 30» antes de saberlo. */
  withJudgement: number | null
  atRisk: number
  subjects: number
  subjectsClosed: number
  /** Las libretas que todavía no cerraron la reunión, en el orden de la matriz. */
  openSubjects: MeetingSubjectLike[]
}

/** Quiénes tienen juicio vigente, y si el del grupo está escrito. `null`: todavía no se sabe. */
export type JudgementState = { studentIds: ReadonlySet<string>; group: boolean } | null

const has = (value: number | null | undefined) => value != null

export function meetingTally(
  rows: readonly MeetingRowLike[],
  subjects: readonly MeetingSubjectLike[],
  judgements: JudgementState,
): MeetingTally {
  const openSubjects = subjects.filter((s) => s.periodStatus !== 'CLOSED')
  return {
    students: rows.length,
    withPerformance: rows.filter((r) => has(r.performanceValueHundredths)).length,
    withConduct: rows.filter((r) => has(r.conductValueHundredths)).length,
    withJudgement: judgements ? rows.filter((r) => judgements.studentIds.has(r.studentId)).length : null,
    atRisk: rows.filter((r) => r.atRisk).length,
    subjects: subjects.length,
    subjectsClosed: subjects.length - openSubjects.length,
    openSubjects,
  }
}

/** «Matemática (Ana G), Física y 2 más»: las primeras con su docente, para nombrarlas en voz alta. */
export function subjectsText(subjects: readonly MeetingSubjectLike[], max = 3): string {
  const named = subjects.slice(0, max).map((s) => (s.teacher ? `${s.name} (${s.teacher})` : s.name))
  const rest = subjects.length - named.length
  if (rest > 0) return `${named.join(', ')} y ${rest} más`
  if (named.length < 2) return named.join('')
  return `${named.slice(0, -1).join(', ')} y ${named[named.length - 1]}`
}

export type MeetingFilter = 'all' | 'alert' | 'no-performance' | 'no-judgement'

export type MeetingFilterOption = { id: MeetingFilter; label: string; count: number }

/** Los filtros de la matriz con cuántos deja cada uno. «Sin juicio» espera a que lleguen los juicios. */
export function meetingFilters(tally: MeetingTally): MeetingFilterOption[] {
  const options: MeetingFilterOption[] = [
    { id: 'all', label: 'Todos', count: tally.students },
    { id: 'alert', label: 'En alerta', count: tally.atRisk },
    { id: 'no-performance', label: 'Sin rendimiento', count: tally.students - tally.withPerformance },
  ]
  if (tally.withJudgement != null) {
    options.push({ id: 'no-judgement', label: 'Sin juicio', count: tally.students - tally.withJudgement })
  }
  return options
}

export function filterMeetingRows<T extends MeetingRowLike>(
  rows: readonly T[],
  filter: MeetingFilter,
  judgements: JudgementState,
): T[] {
  switch (filter) {
    case 'alert':
      return rows.filter((r) => r.atRisk)
    case 'no-performance':
      return rows.filter((r) => !has(r.performanceValueHundredths))
    case 'no-judgement':
      return judgements ? rows.filter((r) => !judgements.studentIds.has(r.studentId)) : [...rows]
    default:
      return [...rows]
  }
}

export type SubjectStatusMeta = { label: string; symbol: string; className: string }

/**
 * Estado de la reunión en cada libreta, con símbolo y palabra (RNF 7.2): en la reunión se ve de un
 * vistazo qué docente todavía no cerró.
 */
export function subjectStatus(status: string | null | undefined): SubjectStatusMeta {
  switch (status) {
    case 'CLOSED':
      return { label: 'Cerrada', symbol: '✓', className: 'text-emerald-800 bg-emerald-50' }
    case 'REOPENED':
      return { label: 'Reabierta', symbol: '↺', className: 'text-amber-900 bg-amber-50' }
    case 'OPEN':
      return { label: 'Abierta', symbol: '○', className: 'text-slate-700 bg-slate-100' }
    default:
      return { label: 'Sin empezar', symbol: '–', className: 'text-slate-500 bg-slate-50' }
  }
}

type DescriptorLike = {
  label: string
  colorToken: string | null
  iconToken: string | null
  isAlert: boolean
} | null

export type LegendItem = { label: string; symbol: string; badgeClass: string; isAlert: boolean }

/**
 * Los tramos que aparecen en la matriz, de la nota más baja a la más alta. Sólo los que se usan:
 * la leyenda explica lo que está a la vista, no la escala entera.
 */
export function levelLegend(
  cells: ReadonlyArray<{ valueHundredths: number | null; descriptor: DescriptorLike }>,
): LegendItem[] {
  const lowest = new Map<string, { value: number; item: LegendItem }>()
  for (const cell of cells) {
    if (!cell.descriptor || cell.valueHundredths == null) continue
    const known = lowest.get(cell.descriptor.label)
    if (known && known.value <= cell.valueHundredths) continue
    const style = levelStyle(cell.descriptor)
    lowest.set(cell.descriptor.label, {
      value: cell.valueHundredths,
      item: { label: cell.descriptor.label, symbol: style.symbol, badgeClass: style.badgeClass, isAlert: cell.descriptor.isAlert },
    })
  }
  return [...lowest.values()].sort((a, b) => a.value - b.value).map((entry) => entry.item)
}

/** El nombre como lo lee la reunión. */
export function studentName(row: Pick<MeetingRowLike, 'lastName' | 'firstName'>): string {
  return `${row.lastName}, ${row.firstName}`
}

export type MeetingField = 'performance' | 'conduct'

const FIELD_NOUN: Record<MeetingField, string> = { performance: 'el rendimiento', conduct: 'la conducta' }

/**
 * Qué no se guardó y de quién, con el motivo. Antes el valor volvía a «—» sin decir nada: el
 * error se borraba al recargar la matriz.
 */
export function saveErrorText(field: MeetingField, row: Pick<MeetingRowLike, 'lastName' | 'firstName'>, reason: string): string {
  return `No se guardó ${FIELD_NOUN[field]} de ${studentName(row)}. ${reason}`.trim()
}

/** «prom. 7,3»: la referencia que acompaña al rendimiento mientras la reunión lo decide. */
export function averageHint(averageHundredths: number | null | undefined, decimals = 1): string | null {
  if (averageHundredths == null) return null
  return `prom. ${formatHundredths(averageHundredths, decimals)}`
}
