import { hasAnyPermission, hasPermission, type WithPermissions } from '@/lib/auth/permissions'
import { groupParams, type GroupFilter } from '@/lib/gradebook/group-filter'

/**
 * Visado de la libreta (RF-080 a RF-083), del lado del cliente: las formas que devuelve la API, los
 * rótulos y qué puede hacer cada quien. La grilla de supervisión y la sección Visados del docente
 * muestran lo mismo, así que comparten esto.
 */

export type EndorsementSection = 'GRADES' | 'CLOSURE' | 'JUDGEMENTS' | 'PLANNING' | 'GROUP_REPORT' | 'ALL'
export type EndorsementStatus = 'PENDING' | 'OBSERVED' | 'CORRECTED' | 'ENDORSED'

/** Secciones que se revisan por separado; `ALL` es el visado del período. */
export const REVIEW_SECTIONS: readonly EndorsementSection[] = ['GRADES', 'CLOSURE', 'JUDGEMENTS', 'PLANNING', 'GROUP_REPORT']

/**
 * Las partes que se observan, con nombres que no se pisan: "Calificaciones" y "Cierre" parecían lo
 * mismo, y "Seguimiento" era en realidad la planificación. Son los del backend (`SECTION_LABELS`),
 * que arma el aviso al docente: los dos tienen que decir lo mismo.
 */
export const ENDORSEMENT_SECTION_LABELS: Record<EndorsementSection, string> = {
  GRADES: 'Notas de las evaluaciones',
  CLOSURE: 'C y R del cierre',
  JUDGEMENTS: 'Juicios',
  PLANNING: 'Planificación y desarrollo',
  GROUP_REPORT: 'Informe del grupo',
  ALL: 'Período',
}

export const ENDORSEMENT_STATUS_LABELS: Record<EndorsementStatus, string> = {
  PENDING: 'Pendiente',
  OBSERVED: 'Observado',
  CORRECTED: 'Corregido',
  ENDORSED: 'Visado',
}

/** Texto y símbolo además del color: el estado no se lee sólo por el fondo (RNF 7.2). */
export const ENDORSEMENT_STATUS_STYLES: Record<EndorsementStatus, { className: string; symbol: string }> = {
  PENDING: { className: 'border-gray-200 bg-gray-50 text-gray-700', symbol: '·' },
  OBSERVED: { className: 'border-amber-200 bg-amber-50 text-amber-900', symbol: '▲' },
  CORRECTED: { className: 'border-blue-200 bg-blue-50 text-blue-900', symbol: '↻' },
  ENDORSED: { className: 'border-emerald-200 bg-emerald-50 text-emerald-800', symbol: '✓' },
}

export type EndorsementSectionState = {
  section: EndorsementSection
  status: EndorsementStatus
  occurredAt: string | null
  observations: string | null
}

export type EndorsementRow = {
  gradeBookPeriodId: string
  gradeBookId: string
  periodStatus: 'OPEN' | 'CLOSED' | 'REOPENED'
  period: { id: string; name: string }
  subject: { name: string }
  teacher: { name: string | null } | null
  courseName: string
  orientationName: string | null
  closedLate: boolean
  sections: EndorsementSectionState[]
  overallStatus: EndorsementStatus
  pendingAgeDays: number | null
  blockingSections: EndorsementSection[]
  canFinalize: boolean
  /** Volvió a cerrarse después de la observación: el docente corrigió y hay que revisar. */
  reclosedAfterObservation?: boolean
}

export type EndorsementHistoryEntry = {
  section: EndorsementSection
  status: EndorsementStatus
  occurredAt: string
  observations: string | null
  actorName: string | null
}

/** Qué puede hacer quien mira. Son las mismas reglas que `assertCanTransition` en el backend. */
export type EndorsementAbilities = {
  canObserve: boolean
  canCorrect: boolean
  canEndorse: boolean
  canReopen: boolean
}

export function endorsementAbilities(me: WithPermissions): EndorsementAbilities {
  return {
    canObserve: hasAnyPermission(me, ['gradebook.review', 'gradebook.inspect']),
    canCorrect: hasAnyPermission(me, ['gradebook.review', 'gradebook.endorse']),
    canEndorse: hasPermission(me, 'gradebook.endorse'),
    canReopen: hasPermission(me, 'gradebook.manage', 'all'),
  }
}

/** Una sección ya visada sólo la toca quien visa: ni Inspección ni Adscripción la revierten. */
export function canActOnSection(status: EndorsementStatus, abilities: EndorsementAbilities): boolean {
  return status !== 'ENDORSED' || abilities.canEndorse
}

/** Lo que Dirección puede visar ya: cerrado, sin visar y sin observaciones vivas. */
export function readyToEndorse(rows: readonly EndorsementRow[]): EndorsementRow[] {
  return rows.filter((row) => row.periodStatus === 'CLOSED' && row.overallStatus !== 'ENDORSED' && row.canFinalize)
}

export function sectionState(row: Pick<EndorsementRow, 'sections'>, section: EndorsementSection): EndorsementSectionState {
  return (
    row.sections.find((s) => s.section === section) ?? { section, status: 'PENDING', occurredAt: null, observations: null }
  )
}

export type ReviewKind = 'TO_REVIEW' | 'OBSERVED' | 'RECLOSED' | 'REOPENED' | 'ENDORSED'

export type ReviewState = { kind: ReviewKind; label: string; symbol: string; className: string }

const REVIEW_STATES: Record<ReviewKind, Omit<ReviewState, 'kind'>> = {
  TO_REVIEW: { label: 'Para revisar', symbol: '·', className: ENDORSEMENT_STATUS_STYLES.PENDING.className },
  OBSERVED: { label: 'Observada: espera al docente', symbol: '▲', className: ENDORSEMENT_STATUS_STYLES.OBSERVED.className },
  RECLOSED: { label: 'Volvió a cerrarse: revisá la corrección', symbol: '↻', className: ENDORSEMENT_STATUS_STYLES.CORRECTED.className },
  REOPENED: { label: 'Reabierta: el docente está corrigiendo', symbol: '↻', className: ENDORSEMENT_STATUS_STYLES.OBSERVED.className },
  ENDORSED: { label: 'Visada', symbol: '✓', className: ENDORSEMENT_STATUS_STYLES.ENDORSED.className },
}

/**
 * En qué está una libreta en una reunión, dicho para quien la revisa. Las cinco secciones con su
 * estado cada una no se entendían de un vistazo: lo que importa es si hay que mirarla, si se espera
 * al docente o si ya está visada.
 */
export function reviewState(
  row: Pick<EndorsementRow, 'overallStatus' | 'periodStatus' | 'blockingSections' | 'reclosedAfterObservation'>,
): ReviewState {
  let kind: ReviewKind = 'TO_REVIEW'
  if (row.overallStatus === 'ENDORSED') kind = 'ENDORSED'
  else if (row.periodStatus === 'REOPENED') kind = 'REOPENED'
  else if (row.blockingSections.length > 0) kind = row.reclosedAfterObservation ? 'RECLOSED' : 'OBSERVED'
  return { kind, ...REVIEW_STATES[kind] }
}

/**
 * La libreta que sigue en la bandeja después de la actual, entre las que esperan que alguien las
 * mire: las que están para revisar y las que el docente volvió a cerrar. Las observadas esperan al
 * docente, así que se saltean. Al llegar al final vuelve a empezar.
 */
export function nextForReview(queue: readonly EndorsementRow[], currentGradeBookId: string): EndorsementRow | null {
  const at = queue.findIndex((row) => row.gradeBookId === currentGradeBookId)
  const ordered = at < 0 ? queue : [...queue.slice(at + 1), ...queue.slice(0, at)]
  return (
    ordered.find((row) => {
      const kind = reviewState(row).kind
      return row.gradeBookId !== currentGradeBookId && (kind === 'TO_REVIEW' || kind === 'RECLOSED')
    }) ?? null
  )
}

/** Qué partes tienen una observación viva, como se leen: "Notas de las evaluaciones, Juicios". */
export function observedLabels(row: Pick<EndorsementRow, 'blockingSections'>): string {
  return row.blockingSections.map((section) => ENDORSEMENT_SECTION_LABELS[section]).join(', ')
}

/**
 * La revisión de una libreta en una reunión. El grupo viaja para que "Siguiente para revisar"
 * recorra la misma lista que se filtró en Control.
 */
export function visadoHref(gradeBookId: string, periodId: string, group: GroupFilter | null = null): string {
  const params = new URLSearchParams({ reunion: periodId, ...groupParams(group) })
  return `/libreta/${gradeBookId}/visado?${params}`
}

/** "12/06/2026" a partir de un ISO; vacío si no hay fecha. */
export function formatEndorsementDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
