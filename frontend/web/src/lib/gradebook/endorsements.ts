import { hasAnyPermission, hasPermission, type WithPermissions } from '@/lib/auth/permissions'

/**
 * Visado de la libreta (RF-080 a RF-083), del lado del cliente: las formas que devuelve la API, los
 * rótulos y qué puede hacer cada quien. La grilla de supervisión y la sección Visados del docente
 * muestran lo mismo, así que comparten esto.
 */

export type EndorsementSection = 'GRADES' | 'CLOSURE' | 'JUDGEMENTS' | 'ALL'
export type EndorsementStatus = 'PENDING' | 'OBSERVED' | 'CORRECTED' | 'ENDORSED'

/** Secciones que se revisan por separado; `ALL` es el visado del período. */
export const REVIEW_SECTIONS: readonly EndorsementSection[] = ['GRADES', 'CLOSURE', 'JUDGEMENTS']

export const ENDORSEMENT_SECTION_LABELS: Record<EndorsementSection, string> = {
  GRADES: 'Calificaciones',
  CLOSURE: 'Cierre',
  JUDGEMENTS: 'Juicios',
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

/** Lo que el visado en lote tomaría: cerrado, sin visar y sin observaciones vivas. */
export function readyToEndorse(rows: readonly EndorsementRow[]): EndorsementRow[] {
  return rows.filter((row) => row.periodStatus === 'CLOSED' && row.overallStatus !== 'ENDORSED' && row.canFinalize)
}

export function sectionState(row: Pick<EndorsementRow, 'sections'>, section: EndorsementSection): EndorsementSectionState {
  return (
    row.sections.find((s) => s.section === section) ?? { section, status: 'PENDING', occurredAt: null, observations: null }
  )
}

/** "12/06/2026" a partir de un ISO; vacío si no hay fecha. */
export function formatEndorsementDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
